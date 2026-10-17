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
    tenantsTable: authStack.tenantsTable,
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

  /** Collects every IAM action on the PostConfirmation role's policies. */
  function postConfirmationActions(template: Template): string[] {
    const policies = template.findResources('AWS::IAM::Policy');
    const actions: string[] = [];
    for (const [logicalId, policy] of Object.entries(policies)) {
      if (!logicalId.startsWith('PostConfirmationRole')) continue;
      for (const stmt of (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[] }> } } })
        .Properties.PolicyDocument.Statement) {
        const a = stmt.Action;
        if (Array.isArray(a)) actions.push(...a);
        else if (typeof a === 'string') actions.push(a);
      }
    }
    return actions;
  }

  it('grants PostConfirmation AdminUpdateUserAttributes, AdminAddUserToGroup and tenants-table GetItem', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).toContain('cognito-idp:AdminUpdateUserAttributes');
    // Invited self-registrants are added to the Seller group here.
    expect(actions).toContain('cognito-idp:AdminAddUserToGroup');
    expect(actions).toContain('dynamodb:GetItem');
  });

  it('grants PostConfirmation the durable-completion writes (PutItem, TransactWriteItems, DeleteItem) + CMK GenerateDataKey', () => {
    const { auth } = synth();
    const actions = postConfirmationActions(auth);
    // Durable registration completion: commit tenant/profile/consent...
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).toContain('dynamodb:TransactWriteItems');
    // ...then delete the pending record (ONLY after commit — enforced in code).
    expect(actions).toContain('dynamodb:DeleteItem');
    // Writing to the CMK-encrypted tenants table needs GenerateDataKey.
    expect(actions).toContain('kms:GenerateDataKey');
  });

  it('grants the PostConfirmation role events:PutEvents (registration event after durable commit)', () => {
    const { auth } = synth();
    // The trigger now emits auth.user.registered, but strictly AFTER the
    // durable records commit (ordering enforced in the handler). The grant must
    // therefore be present.
    expect(postConfirmationActions(auth)).toContain('events:PutEvents');
  });

  it('does NOT grant the RegisterPending (register-pending) role any delete or event permissions', () => {
    const { authApi } = synth();
    const policies = authApi.findResources('AWS::IAM::Policy');
    const registerPendingActions: string[] = [];
    for (const [logicalId, policy] of Object.entries(policies)) {
      if (!logicalId.startsWith('RegisterPendingRole')) continue;
      for (const stmt of (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[] }> } } })
        .Properties.PolicyDocument.Statement) {
        const a = stmt.Action;
        if (Array.isArray(a)) registerPendingActions.push(...a);
        else if (typeof a === 'string') registerPendingActions.push(a);
      }
    }
    // The pre-signup capture endpoint only writes the pending record; it must
    // never delete records or emit domain events.
    expect(registerPendingActions).toContain('dynamodb:PutItem');
    expect(registerPendingActions).not.toContain('dynamodb:DeleteItem');
    expect(registerPendingActions).not.toContain('events:PutEvents');
  });

  it('does NOT grant the trigger roles any S3 or broad admin wildcard', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).not.toContain('*');
    expect(actions.some((a) => a.startsWith('s3:'))).toBe(false);
  });

  it('does NOT declare a merch-os-tenants table in AuthStack (avoids owning the MerchOS-Tenant stack table)', () => {
    const { auth } = synth();
    // The tenants table is owned by the separate MerchOS-Tenant-<env> stack.
    // AuthStack must only REFERENCE it (imported from SSM), never declare a
    // second physical table with the same name — that would collide on deploy.
    const tables = auth.findResources('AWS::DynamoDB::Table');
    const tableNames = Object.values(tables).map(
      (t) => (t as { Properties: { TableName?: string } }).Properties.TableName,
    );
    expect(tableNames).not.toContain('merch-os-tenants-dev');
    // AuthStack still owns ONLY its own tables (invitations + sessions).
    expect(tableNames).toEqual(
      expect.arrayContaining(['merch-os-invitations-dev', 'merch-os-sessions-dev']),
    );
    // And it reads the tenants-table ARN from the TenantStack's env-specific
    // SSM export (not a hardcoded ARN).
    const authJson = JSON.stringify(auth.toJSON());
    expect(authJson).toContain('/merch-os/dev/dynamodb/tenants-table-arn');
  });

  it('keeps the registration Lambdas pointed at TENANTS_TABLE=merch-os-tenants-<env> (runtime contract unchanged)', () => {
    const { auth, authApi } = synth();

    // PostConfirmation (AuthStack) resolves pending/durable records by table
    // NAME — must remain the stable physical name regardless of the ownership
    // refactor.
    const authFns = auth.findResources('AWS::Lambda::Function');
    const postConfirmation = Object.values(authFns).find((f) =>
      ((f as { Properties: { FunctionName?: string } }).Properties.FunctionName ?? '')
        .includes('postconfirmation'),
    ) as { Properties: { Environment?: { Variables?: Record<string, unknown> } } } | undefined;
    expect(postConfirmation).toBeDefined();
    expect(postConfirmation!.Properties.Environment?.Variables?.['TENANTS_TABLE']).toBe(
      'merch-os-tenants-dev',
    );

    // RegisterPending (AuthApi stack) writes pending records by the same name.
    const apiFns = authApi.findResources('AWS::Lambda::Function');
    const registerPending = Object.values(apiFns).find((f) =>
      ((f as { Properties: { FunctionName?: string } }).Properties.FunctionName ?? '')
        .includes('registerpending'),
    ) as { Properties: { Environment?: { Variables?: Record<string, unknown> } } } | undefined;
    expect(registerPending).toBeDefined();
    expect(registerPending!.Properties.Environment?.Variables?.['TENANTS_TABLE']).toBe(
      'merch-os-tenants-dev',
    );
  });

  it('scopes RegisterPending and PostConfirmation DynamoDB access to the tenants table', () => {
    const { auth, authApi } = synth();

    // The tenants table is REFERENCED (not owned) by AuthStack. Its physical
    // name still appears in the template via the TENANTS_TABLE Lambda env var,
    // and the imported ARN is resolved from the TenantStack's SSM export.
    const authJson = JSON.stringify(auth.toJSON());
    expect(authJson).toContain('merch-os-tenants-dev');
    expect(authJson).toContain('/merch-os/dev/dynamodb/tenants-table-arn');

    // The register-pending handler (AuthApi stack) writes to that same table.
    // AuthApi references the table via a cross-stack reference rather than an
    // inline literal ARN, so assert the RegisterPending role has a PutItem
    // statement whose Resource is a non-wildcard reference (an object token,
    // not '*').
    const policies = authApi.findResources('AWS::IAM::Policy');
    let registerPendingPutScoped = false;
    for (const [logicalId, p] of Object.entries(policies)) {
      if (!logicalId.startsWith('RegisterPendingRole')) continue;
      for (const s of (p as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[]; Resource?: unknown }> } } })
        .Properties.PolicyDocument.Statement) {
        const actions = Array.isArray(s.Action) ? s.Action : s.Action ? [s.Action] : [];
        if (!actions.includes('dynamodb:PutItem')) continue;
        // A cross-stack table ARN renders as an object (Fn::ImportValue/GetAtt),
        // never the wildcard string '*'.
        expect(s.Resource).not.toBe('*');
        expect(typeof s.Resource).toBe('object');
        registerPendingPutScoped = true;
      }
    }
    expect(registerPendingPutScoped).toBe(true);

    // PostConfirmation (AuthStack) is scoped to the real table ARN too (GetAtt).
    let postConfirmationTableScoped = false;
    const authPolicies = auth.findResources('AWS::IAM::Policy');
    for (const [logicalId, p] of Object.entries(authPolicies)) {
      if (!logicalId.startsWith('PostConfirmationRole')) continue;
      for (const s of (p as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[]; Resource?: unknown }> } } })
        .Properties.PolicyDocument.Statement) {
        const actions = Array.isArray(s.Action) ? s.Action : s.Action ? [s.Action] : [];
        if (actions.includes('dynamodb:GetItem') || actions.includes('dynamodb:PutItem')) {
          expect(s.Resource).not.toBe('*');
          postConfirmationTableScoped = true;
        }
      }
    }
    expect(postConfirmationTableScoped).toBe(true);
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

  it('CORS allow-list includes the required explicit dev origins and never uses "*"', () => {
    const { authApi } = synth();
    const apis = authApi.findResources('AWS::ApiGatewayV2::Api');
    const api = Object.values(apis)[0] as {
      Properties: { CorsConfiguration?: { AllowOrigins?: string[] } };
    };
    const origins = api.Properties.CorsConfiguration?.AllowOrigins ?? [];

    // Required explicit origins for dev testing.
    expect(origins).toContain('https://dev.merchos.io');
    // The LIVE seller frontend origin (custom domain served via CloudFront) —
    // the exact Origin the deployed dev frontend's browser sends.
    expect(origins).toContain('https://merchos.co.za');
    expect(origins).toContain('https://main.d1jwaah0zt7pg5.amplifyapp.com');
    expect(origins).toContain('http://localhost:3000');
    // Never a wildcard.
    expect(origins).not.toContain('*');
    // allowCredentials must stay on (and is incompatible with '*').
    expect(api.Properties.CorsConfiguration?.['AllowCredentials' as never]).toBe(true);
  });

  it('CORS: production keeps only its custom-domain origin (no live/amplify/localhost leakage)', () => {
    // Guard that the live/dev-only origins never leak into production.
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
    const foundation = new cdk.Stack(app, 'ProdFoundation', {
      env: { account: '123456789012', region: 'eu-west-1' },
    });
    const platformKey = new kms.Key(foundation, 'PlatformKey');
    const eventBus = new events.EventBus(foundation, 'EventBus');
    const authStack = new AuthStack(app, 'ProdAuth', {
      env: { account: '123456789012', region: 'eu-west-1' },
      environment: 'production',
      platformKey,
      eventBus,
    });
    const authApiStack = new AuthApiStack(app, 'ProdAuthApi', {
      env: { account: '123456789012', region: 'eu-west-1' },
      environment: 'production',
      userPool: authStack.userPool,
      sellerDashboardClient: authStack.sellerDashboardClient,
      platformKey,
      eventBus,
      invitationsTable: authStack.invitationsTable,
      sessionsTable: authStack.sessionsTable,
      tenantsTable: authStack.tenantsTable,
    });
    const template = Template.fromStack(authApiStack);
    const apis = template.findResources('AWS::ApiGatewayV2::Api');
    const api = Object.values(apis)[0] as {
      Properties: { CorsConfiguration?: { AllowOrigins?: string[] } };
    };
    const origins = api.Properties.CorsConfiguration?.AllowOrigins ?? [];
    expect(origins).toContain('https://app.merchos.io');
    expect(origins).not.toContain('https://merchos.co.za');
    expect(origins).not.toContain('https://main.d1jwaah0zt7pg5.amplifyapp.com');
    expect(origins).not.toContain('http://localhost:3000');
    expect(origins).not.toContain('*');
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
