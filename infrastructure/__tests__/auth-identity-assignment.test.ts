import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';

import { AuthStack } from '../lib/auth-stack';
import { AuthApiStack } from '../lib/auth-api-stack';

/**
 * Builds the Auth + AuthApi stacks against a throwaway foundation providing a
 * platform CMK and event bus, matching the real bin wiring.
 */
function synth() {
  // Disable asset bundling during synth. NodejsFunction would otherwise invoke
  // esbuild, which cannot run inside a vitest worker thread (invalid stdio).
  // Setting bundling-stacks to an empty list makes CDK stub assets instead.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const foundation = new cdk.Stack(app, 'TestFoundation', {
    env: { account: '123456789012', region: 'eu-west-1' },
  });
  const platformKey = new kms.Key(foundation, 'PlatformKey');
  const eventBus = new events.EventBus(foundation, 'EventBus');

  const authStack = new AuthStack(app, 'TestAuth', {
    env: { account: '123456789012', region: 'eu-west-1' },
    environment: 'dev',
    platformKey,
    eventBus,
  });

  const authApiStack = new AuthApiStack(app, 'TestAuthApi', {
    env: { account: '123456789012', region: 'eu-west-1' },
    environment: 'dev',
    userPool: authStack.userPool,
    sellerDashboardClient: authStack.sellerDashboardClient,
    platformKey,
    eventBus,
    invitationsTable: authStack.invitationsTable,
    sessionsTable: authStack.sessionsTable,
  });

  return {
    auth: Template.fromStack(authStack),
    authApi: Template.fromStack(authApiStack),
  };
}

/** Collects every IAM policy statement action across a template. */
function allActions(template: Template): string[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const actions: string[] = [];
  for (const policy of Object.values(policies)) {
    const statements = (policy as { Properties: { PolicyDocument: { Statement: unknown[] } } })
      .Properties.PolicyDocument.Statement;
    for (const stmt of statements) {
      const action = (stmt as { Action?: string | string[] }).Action;
      if (Array.isArray(action)) actions.push(...action);
      else if (typeof action === 'string') actions.push(action);
    }
  }
  return actions;
}

describe('Auth identity-assignment infrastructure', () => {
  it('synthesizes Auth and AuthApi without circular dependencies', () => {
    // If synth produced a circular dependency, Template.fromStack would throw.
    expect(() => synth()).not.toThrow();
  });

  it('grants kms:Decrypt for CMK-encrypted table reads', () => {
    const { auth } = synth();
    expect(allActions(auth)).toContain('kms:Decrypt');
  });

  it('grants PostConfirmation AdminUpdateUserAttributes, AdminAddUserToGroup and tenants-table GetItem', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).toContain('cognito-idp:AdminUpdateUserAttributes');
    // Invited self-registrants are added to the Seller group here.
    expect(actions).toContain('cognito-idp:AdminAddUserToGroup');
    expect(actions).toContain('dynamodb:GetItem');
  });

  it('does NOT grant the triggers DeleteItem (no premature pending deletion) or write-only KMS', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    // PostConfirmation only reads the pending record; it must not delete it,
    // and the read-only trigger paths must not request GenerateDataKey.
    expect(actions).not.toContain('dynamodb:DeleteItem');
    expect(actions).not.toContain('kms:GenerateDataKey');
  });

  it('does NOT grant the PostConfirmation role events:PutEvents (no premature registration event)', () => {
    const { auth } = synth();
    // Find the PostConfirmation role's default policy and assert it carries no
    // EventBridge PutEvents. The identity-assignment stage must not emit
    // auth.user.registered; that belongs to the downstream completion path.
    const policies = auth.findResources('AWS::IAM::Policy');
    const postConfirmationPolicies = Object.entries(policies).filter(([logicalId]) =>
      logicalId.startsWith('PostConfirmationRole'),
    );
    expect(postConfirmationPolicies.length).toBeGreaterThan(0);
    for (const [, policy] of postConfirmationPolicies) {
      const statements = (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[] }> } } })
        .Properties.PolicyDocument.Statement;
      const actions = statements.flatMap((s) =>
        Array.isArray(s.Action) ? s.Action : s.Action ? [s.Action] : [],
      );
      expect(actions).not.toContain('events:PutEvents');
    }
  });

  it('does NOT grant the trigger roles any S3 or broad admin wildcard', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).not.toContain('*');
    expect(actions.some((a) => a.startsWith('s3:'))).toBe(false);
  });

  it('scopes RegisterPending and PostConfirmation DynamoDB access to the tenants table', () => {
    const { auth, authApi } = synth();
    // The register-pending handler (AuthApi stack) writes to the tenants table.
    const apiActions = (() => {
      const policies = authApi.findResources('AWS::IAM::Policy');
      const resources: string[] = [];
      for (const p of Object.values(policies)) {
        for (const s of (p as { Properties: { PolicyDocument: { Statement: Array<{ Resource?: unknown }> } } })
          .Properties.PolicyDocument.Statement) {
          const r = JSON.stringify(s.Resource ?? '');
          if (r.includes('merch-os-tenants-dev')) resources.push(r);
        }
      }
      return resources;
    })();
    expect(apiActions.length).toBeGreaterThan(0);
    // And the AuthStack (PostConfirmation) references the tenants table too.
    const authJson = JSON.stringify(auth.toJSON());
    expect(authJson).toContain('merch-os-tenants-dev');
  });

  it('exposes an unauthenticated POST /auth/register-pending route', () => {
    const { authApi } = synth();

    // The route exists with the expected RouteKey.
    authApi.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /auth/register-pending',
    });

    // And it is unauthenticated: no AuthorizerId wired to the register-pending
    // route (authenticated routes set AuthorizerId to a Ref).
    const routes = authApi.findResources('AWS::ApiGatewayV2::Route');
    const registerPending = Object.values(routes).find(
      (r) =>
        (r as { Properties: { RouteKey?: string } }).Properties.RouteKey ===
        'POST /auth/register-pending',
    ) as { Properties: Record<string, unknown> } | undefined;
    expect(registerPending).toBeDefined();
    expect(registerPending!.Properties['AuthorizerId']).toBeUndefined();
  });

  it('creates a dedicated RegisterPending Lambda', () => {
    const { authApi } = synth();
    authApi.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: Match.stringLikeRegexp('merch-os-auth-registerpending-dev'),
    });
  });

  it('defines a mutable custom:tenantIdAssigned attribute alongside the immutable custom:tenantId', () => {
    const { auth } = synth();
    const pools = auth.findResources('AWS::Cognito::UserPool');
    const schema = (Object.values(pools)[0] as {
      Properties: { Schema: Array<{ Name: string; Mutable?: boolean }> };
    }).Properties.Schema;

    const immutable = schema.find((s) => s.Name === 'tenantId');
    const assigned = schema.find((s) => s.Name === 'tenantIdAssigned');

    expect(immutable).toBeDefined();
    expect(immutable!.Mutable).toBe(false);
    expect(assigned).toBeDefined();
    expect(assigned!.Mutable).toBe(true);
  });

  it('forbids every app client from writing the server-managed tenant/role attributes', () => {
    const { auth } = synth();
    const clients = auth.findResources('AWS::Cognito::UserPoolClient');
    const clientList = Object.values(clients) as Array<{
      Properties: { WriteAttributes?: string[]; ClientName?: string };
    }>;

    // All three app clients are present and each has an explicit write list.
    expect(clientList.length).toBeGreaterThanOrEqual(3);
    for (const client of clientList) {
      const writeAttrs = client.Properties.WriteAttributes ?? [];
      expect(writeAttrs.length).toBeGreaterThan(0); // explicit restriction set
      expect(writeAttrs).not.toContain('custom:tenantId');
      expect(writeAttrs).not.toContain('custom:tenantIdAssigned');
      expect(writeAttrs).not.toContain('custom:role');
    }
  });

  it('grants the invite-user handler compensation permissions (AdminRemoveUserFromGroup, AdminDeleteUser)', () => {
    const { authApi } = synth();
    const policies = authApi.findResources('AWS::IAM::Policy');
    const inviteActions: string[] = [];
    for (const [logicalId, policy] of Object.entries(policies)) {
      if (!logicalId.startsWith('InviteUserRole')) continue;
      for (const stmt of (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[] }> } } })
        .Properties.PolicyDocument.Statement) {
        const a = stmt.Action;
        if (Array.isArray(a)) inviteActions.push(...a);
        else if (typeof a === 'string') inviteActions.push(a);
      }
    }
    expect(inviteActions).toContain('cognito-idp:AdminCreateUser');
    expect(inviteActions).toContain('cognito-idp:AdminAddUserToGroup');
    expect(inviteActions).toContain('cognito-idp:AdminRemoveUserFromGroup');
    expect(inviteActions).toContain('cognito-idp:AdminDeleteUser');
    // Conditional invitation-record cleanup for ambiguous writes.
    expect(inviteActions).toContain('dynamodb:PutItem');
    expect(inviteActions).toContain('dynamodb:DeleteItem');
    // CMK access for the encrypted invitations table.
    expect(inviteActions).toContain('kms:GenerateDataKey');
    expect(inviteActions).toContain('kms:Decrypt');
    // The impossible post-creation immutable-attribute update is gone.
    expect(inviteActions).not.toContain('cognito-idp:AdminUpdateUserAttributes');
  });

  it('injects COGNITO_USER_POOL_ID (the variable the InviteUser handler reads) into the InviteUser Lambda', () => {
    const { authApi } = synth();
    const fns = authApi.findResources('AWS::Lambda::Function');
    const invite = Object.values(fns).find((f) =>
      ((f as { Properties: { FunctionName?: string } }).Properties.FunctionName ?? '')
        .includes('inviteuser'),
    ) as { Properties: { Environment?: { Variables?: Record<string, unknown> } } } | undefined;
    expect(invite).toBeDefined();
    const vars = invite!.Properties.Environment?.Variables ?? {};
    expect(Object.keys(vars)).toContain('COGNITO_USER_POOL_ID');
    // The old (never-supplied) name must not be what we rely on.
    expect(Object.keys(vars)).not.toContain('COGNITO_TENANT_POOL_ID');
  });

  it('grants PostConfirmation read access to the invitations table + email-index (invited identity resolution)', () => {
    const { auth } = synth();
    const policies = auth.findResources('AWS::IAM::Policy');
    let hasQuery = false;
    for (const [logicalId, policy] of Object.entries(policies)) {
      if (!logicalId.startsWith('PostConfirmationRole')) continue;
      for (const stmt of (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[] }> } } })
        .Properties.PolicyDocument.Statement) {
        const a = stmt.Action;
        const actions = Array.isArray(a) ? a : a ? [a] : [];
        if (actions.includes('dynamodb:Query')) hasQuery = true;
      }
    }
    expect(hasQuery).toBe(true);
  });

  it('allows app clients to read the tenant/role attributes (SPA context display)', () => {
    const { auth } = synth();
    const clients = auth.findResources('AWS::Cognito::UserPoolClient');
    const anyClient = Object.values(clients)[0] as {
      Properties: { ReadAttributes?: string[] };
    };
    const readAttrs = anyClient.Properties.ReadAttributes ?? [];
    expect(readAttrs).toContain('custom:tenantId');
    expect(readAttrs).toContain('custom:tenantIdAssigned');
    expect(readAttrs).toContain('custom:role');
  });
});
