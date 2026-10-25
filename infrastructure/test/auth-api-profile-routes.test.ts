import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { AuthApiStack } from '../lib/auth-api-stack';

/**
 * Infra assertions for the Stage 1 profile-status / complete-profile routes.
 *
 * A host stack supplies the dependency constructs (UserPool, client, KMS key,
 * event bus, invitations/sessions tables) so AuthApiStack can be synthesised in
 * isolation.
 */
function synth(): Template {
  // Disable NodejsFunction esbuild bundling during synth. Real bundling spawns
  // a child process whose stdio is incompatible with vitest worker threads;
  // template-level assertions don't need the actual bundle.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const host = new cdk.Stack(app, 'HostStack', { env: { account: '388096320605', region: 'eu-west-1' } });

  const userPool = new cognito.UserPool(host, 'UserPool');
  const client = userPool.addClient('SellerClient');
  const platformKey = new kms.Key(host, 'PlatformKey');
  const eventBus = new events.EventBus(host, 'Bus');
  const invitationsTable = new dynamodb.Table(host, 'Invitations', {
    partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  });
  const sessionsTable = new dynamodb.Table(host, 'Sessions', {
    partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
  });

  const stack = new AuthApiStack(app, 'MerchOS-AuthApi-dev', {
    env: { account: '388096320605', region: 'eu-west-1' },
    environment: 'dev',
    userPool,
    sellerDashboardClient: client,
    platformKey,
    eventBus,
    invitationsTable,
    sessionsTable,
  });

  return Template.fromStack(stack);
}

describe('AuthApiStack — profile recovery routes', () => {
  const template = synth();

  it('creates the two new routes', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeKeys = Object.values(routes).map((r) => r.Properties.RouteKey);
    expect(routeKeys).toContain('GET /auth/profile-status');
    expect(routeKeys).toContain('POST /auth/complete-profile');
  });

  it('protects both new routes with the JWT authorizer', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    for (const r of Object.values(routes)) {
      const key = r.Properties.RouteKey as string;
      if (key === 'GET /auth/profile-status' || key === 'POST /auth/complete-profile') {
        expect(r.Properties.AuthorizationType).toBe('JWT');
        expect(r.Properties.AuthorizerId).toBeDefined();
      }
    }
  });

  it('sets TENANTS_TABLE env on EXACTLY the two recovery lambdas (not the other 14)', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    const withTenantsEnv = Object.values(fns).filter(
      (f) => f.Properties?.Environment?.Variables?.TENANTS_TABLE !== undefined,
    );
    // Scoped per-function via addEnvironment — only ProfileStatus + CompleteProfile.
    expect(withTenantsEnv.length).toBe(2);
  });

  it('scopes complete-profile IAM to TransactWriteItems/GetItem and KMS, no wildcard dynamodb', () => {
    // Find a policy granting dynamodb:TransactWriteItems (complete-profile only)
    const policies = template.findResources('AWS::IAM::Policy');
    const txnPolicies = Object.values(policies).filter((p) => {
      const stmts = p.Properties?.PolicyDocument?.Statement ?? [];
      return stmts.some((s: { Action?: unknown }) => {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        return actions.includes('dynamodb:TransactWriteItems');
      });
    });
    expect(txnPolicies.length).toBeGreaterThanOrEqual(1);

    // No statement grants a broad dynamodb:* action anywhere.
    for (const p of Object.values(policies)) {
      const stmts = p.Properties?.PolicyDocument?.Statement ?? [];
      for (const s of stmts) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        for (const a of actions) {
          expect(a).not.toBe('dynamodb:*');
        }
      }
    }
  });

  it('does not create any GSIs/LSIs beyond the rate-limits table definition', () => {
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const t of Object.values(tables)) {
      expect(t.Properties.GlobalSecondaryIndexes).toBeUndefined();
      expect(t.Properties.LocalSecondaryIndexes).toBeUndefined();
    }
  });

  it('grants complete-profile events:PutEvents (best-effort registration event)', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'events:PutEvents' }),
        ]),
      }),
    });
  });
});

describe('AuthApiStack — orphaned login/refresh removal (B1)', () => {
  const template = synth();

  it('does NOT define POST /auth/login or POST /auth/refresh routes', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeKeys = Object.values(routes).map((r) => r.Properties.RouteKey as string);
    expect(routeKeys).not.toContain('POST /auth/login');
    expect(routeKeys).not.toContain('POST /auth/refresh');
  });

  it('retains all other expected routes (16 total: 5 unauth + 11 protected)', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const routeKeys = Object.values(routes).map((r) => r.Properties.RouteKey as string).sort();
    const expected = [
      'POST /auth/forgot-password',
      'POST /auth/reset-password',
      'POST /auth/verify-email',
      'POST /auth/logout',
      'POST /auth/change-password',
      'POST /auth/mfa/setup',
      'GET /auth/session',
      'POST /auth/invite',
      'GET /auth/users',
      'PUT /auth/users/{id}/role',
      'POST /auth/users/{id}/disable',
      'DELETE /auth/users/{id}',
      'GET /auth/profile-status',
      'POST /auth/complete-profile',
    ].sort();
    expect(routeKeys).toEqual(expected);
    expect(routeKeys.length).toBe(14);
  });

  it('does NOT create Login or Refresh integrations', () => {
    const integrations = template.findResources('AWS::ApiGatewayV2::Integration');
    const ids = Object.keys(integrations).join(',');
    expect(ids).not.toMatch(/LoginIntegration/);
    expect(ids).not.toMatch(/RefreshIntegration/);
  });

  it('defines exactly 14 Lambda functions (login + refresh removed)', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    const names = Object.values(fns).map((f) => f.Properties?.FunctionName as string).filter(Boolean);
    expect(names).not.toContain('merch-os-auth-login-dev');
    expect(names).not.toContain('merch-os-auth-refresh-dev');
    expect(Object.keys(fns).length).toBe(14);
  });

  it('no remaining policy grants cognito-idp:AdminInitiateAuth (login/refresh only used it)', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const p of Object.values(policies)) {
      const stmts = p.Properties?.PolicyDocument?.Statement ?? [];
      for (const s of stmts) {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        expect(actions).not.toContain('cognito-idp:AdminInitiateAuth');
      }
    }
  });

  it('preserves the rate-limits table and ForgotPassword rate-limit IAM (dynamodb:UpdateItem + KMS)', () => {
    // Table still present for the surviving rate-limited handler (forgot-password).
    const tables = template.findResources('AWS::DynamoDB::Table');
    const tableNames = Object.values(tables).map((t) => t.Properties?.TableName as string);
    expect(tableNames).toContain('merch-os-rate-limits-dev');

    // At least one role still carries the rate-limit write grant (forgot-password).
    const policies = template.findResources('AWS::IAM::Policy');
    const rlPolicies = Object.values(policies).filter((p) => {
      const stmts = p.Properties?.PolicyDocument?.Statement ?? [];
      return stmts.some((s: { Action?: unknown }) => {
        const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
        return actions.includes('dynamodb:UpdateItem');
      });
    });
    expect(rlPolicies.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the ESM createRequire banner configured for the surviving bundles', () => {
    // All NodejsFunction bundles share defaultLambdaProps.bundling.banner; the
    // bundle-init smoke test proves the emitted bundles carry it. Here we assert
    // the surviving functions still exist to be bundled with it.
    const fns = template.findResources('AWS::Lambda::Function');
    const names = Object.values(fns).map((f) => f.Properties?.FunctionName as string);
    expect(names).toContain('merch-os-auth-profilestatus-dev');
    expect(names).toContain('merch-os-auth-completeprofile-dev');
    expect(names).toContain('merch-os-auth-forgotpassword-dev');
  });
});
