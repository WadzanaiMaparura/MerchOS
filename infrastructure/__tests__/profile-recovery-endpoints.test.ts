import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';

import { AuthStack } from '../lib/auth-stack';
import { AuthApiStack } from '../lib/auth-api-stack';

/**
 * Builds the Auth + AuthApi stacks (bundling stubbed) matching the real bin
 * wiring, to assert the profile-recovery endpoints are preserved alongside the
 * PR #28 registration backend.
 */
function synth() {
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

/** All RouteKeys present in the AuthApi template. */
function routeKeys(template: Template): string[] {
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  return Object.values(routes).map(
    (r) => (r as { Properties: { RouteKey?: string } }).Properties.RouteKey ?? '',
  );
}

/** Returns the IAM actions for a role whose logical id starts with prefix. */
function actionsForRole(template: Template, prefix: string): string[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const actions: string[] = [];
  for (const [logicalId, p] of Object.entries(policies)) {
    if (!logicalId.startsWith(prefix)) continue;
    for (const s of (p as { Properties: { PolicyDocument: { Statement: Array<{ Action?: string | string[] }> } } })
      .Properties.PolicyDocument.Statement) {
      const a = s.Action;
      if (Array.isArray(a)) actions.push(...a);
      else if (typeof a === 'string') actions.push(a);
    }
  }
  return actions;
}

/** Returns the Resource entries for a role (as JSON strings). */
function resourcesForRole(template: Template, prefix: string): string[] {
  const policies = template.findResources('AWS::IAM::Policy');
  const out: string[] = [];
  for (const [logicalId, p] of Object.entries(policies)) {
    if (!logicalId.startsWith(prefix)) continue;
    for (const s of (p as { Properties: { PolicyDocument: { Statement: Array<{ Resource?: unknown }> } } })
      .Properties.PolicyDocument.Statement) {
      out.push(JSON.stringify(s.Resource ?? ''));
    }
  }
  return out;
}

describe('Profile-recovery endpoint preservation', () => {
  it('preserves profile-recovery routes AND the pre-existing login/refresh/register-pending routes', () => {
    const { authApi } = synth();
    const keys = routeKeys(authApi);
    // Recovered endpoints are present...
    expect(keys).toContain('GET /auth/profile-status');
    expect(keys).toContain('POST /auth/complete-profile');
    // ...and the routes a deploy must NOT delete remain present.
    expect(keys).toContain('POST /auth/login');
    expect(keys).toContain('POST /auth/refresh');
    expect(keys).toContain('POST /auth/register-pending');
  });

  it('creates dedicated ProfileStatus and CompleteProfile Lambdas', () => {
    const { authApi } = synth();
    const fns = authApi.findResources('AWS::Lambda::Function');
    const names = Object.values(fns).map(
      (f) => (f as { Properties: { FunctionName?: string } }).Properties.FunctionName ?? '',
    );
    expect(names.some((n) => n.includes('profilestatus'))).toBe(true);
    expect(names.some((n) => n.includes('completeprofile'))).toBe(true);
  });

  it('profile-recovery routes use the JWT authorizer (authenticated)', () => {
    const { authApi } = synth();
    const routes = authApi.findResources('AWS::ApiGatewayV2::Route');
    for (const key of ['GET /auth/profile-status', 'POST /auth/complete-profile']) {
      const route = Object.values(routes).find(
        (r) => (r as { Properties: { RouteKey?: string } }).Properties.RouteKey === key,
      ) as { Properties: Record<string, unknown> } | undefined;
      expect(route).toBeDefined();
      // Authenticated routes wire an AuthorizerId (a Ref), unlike register-pending.
      expect(route!.Properties['AuthorizerId']).toBeDefined();
    }
  });

  it('CompleteProfile IAM is scoped (TransactWriteItems on the tenants table ref, events, CMK) — no wildcard', () => {
    const { authApi } = synth();
    const actions = actionsForRole(authApi, 'CompleteProfileRole');
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('dynamodb:TransactWriteItems');
    expect(actions).toContain('kms:GenerateDataKey');
    expect(actions).toContain('events:PutEvents');
    // Never a wildcard action or wildcard DynamoDB resource.
    expect(actions).not.toContain('*');
    expect(actions).not.toContain('dynamodb:*');
    const resources = resourcesForRole(authApi, 'CompleteProfileRole');
    expect(resources.length).toBeGreaterThan(0);
    for (const r of resources) {
      expect(r).not.toBe('"*"');
    }
  });

  it('ProfileStatus IAM is read-only (GetItem + Decrypt), no writes, no wildcard', () => {
    const { authApi } = synth();
    const actions = actionsForRole(authApi, 'ProfileStatusRole');
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('kms:Decrypt');
    expect(actions).not.toContain('dynamodb:PutItem');
    expect(actions).not.toContain('dynamodb:TransactWriteItems');
    expect(actions).not.toContain('kms:GenerateDataKey');
    expect(actions).not.toContain('*');
    expect(actions).not.toContain('dynamodb:*');
  });

  it('does NOT declare a second merch-os-tenants table (still referenced via SSM)', () => {
    const { auth, authApi } = synth();
    for (const tpl of [auth, authApi]) {
      const tables = tpl.findResources('AWS::DynamoDB::Table');
      const names = Object.values(tables).map(
        (t) => (t as { Properties: { TableName?: string } }).Properties.TableName,
      );
      expect(names).not.toContain('merch-os-tenants-dev');
    }
  });

  it('synthesizes without throwing (no circular dependencies introduced)', () => {
    expect(() => synth()).not.toThrow();
  });
});
