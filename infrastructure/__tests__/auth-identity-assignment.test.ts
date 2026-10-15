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

  it('grants PostConfirmation cognito-idp:AdminUpdateUserAttributes and tenants-table GetItem', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).toContain('cognito-idp:AdminUpdateUserAttributes');
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
});
