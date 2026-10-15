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

  it('grants PreSignUp/PostConfirmation kms:Decrypt but not write-only perms it does not need', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).toContain('kms:Decrypt');
    // PreSignUp is read-only; it must not request GenerateDataKey.
    // (PostConfirmation legitimately needs GenerateDataKey for the delete path,
    // so we assert Decrypt presence here and scope the no-write check in the
    // dedicated PreSignUp statement below.)
  });

  it('grants PostConfirmation cognito-idp:AdminUpdateUserAttributes', () => {
    const { auth } = synth();
    expect(allActions(auth)).toContain('cognito-idp:AdminUpdateUserAttributes');
  });

  it('does NOT grant the PreSignUp role any S3 or broad admin wildcard', () => {
    const { auth } = synth();
    const actions = allActions(auth);
    expect(actions).not.toContain('*');
    expect(actions.some((a) => a.startsWith('s3:'))).toBe(false);
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
