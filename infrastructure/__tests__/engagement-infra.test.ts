import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { EngagementStack } from '../lib/engagement-stack';

function synth() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const envProps = { account: '123456789012', region: 'eu-west-1' };
  const deps = new cdk.Stack(app, 'TestDeps', { env: envProps });
  const platformKey = new kms.Key(deps, 'PlatformKey');
  const userPool = new cognito.UserPool(deps, 'Pool');
  const stack = new EngagementStack(app, 'TestEngagement', {
    env: envProps,
    environment: 'dev',
    userPool,
    platformKey,
    sellerClientId: 'seller-client-id',
    adminClientId: 'admin-client-id',
    tenantsTableArn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/merch-os-tenants-dev',
  });
  return Template.fromStack(stack);
}

const t = synth();
const routes = () =>
  Object.values(t.findResources('AWS::ApiGatewayV2::Route')).map((r) => r['Properties'] as Record<string, unknown>);
const policies = () => JSON.stringify(t.findResources('AWS::IAM::Policy'));

describe('Engagement stack', () => {
  it('stores data encrypted with the platform key, with PITR and a TTL attribute', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'merch-os-engagement-dev',
      SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }),
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'GSI1' })],
    });
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  });

  it('listens for sign-ups and payments on the platform bus', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      EventBusName: 'merch-os-events-dev',
      EventPattern: { source: ['merch-os.auth'], 'detail-type': ['auth.user.registered'] },
    });
    t.hasResourceProperties('AWS::Events::Rule', {
      EventBusName: 'merch-os-events-dev',
      EventPattern: { source: ['merch-os.billing'], 'detail-type': ['billing.subscription.activated'] },
    });
  });

  it('seller routes use the seller client, admin routes the admin client', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: { Audience: ['seller-client-id'], Issuer: Match.anyValue() },
    });
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: { Audience: ['admin-client-id'], Issuer: Match.anyValue() },
    });
    const all = routes();
    const admin = all.filter((p) => String(p['RouteKey']).includes(' /admin/'));
    const seller = all.filter((p) => String(p['RouteKey']).includes(' /referrals/'));
    const open = all.filter((p) => /^(GET|POST) \/(reviews|unsubscribe|feedback)/.test(String(p['RouteKey'])));
    expect(admin).toHaveLength(7);
    expect(seller).toHaveLength(2);
    for (const p of [...admin, ...seller]) expect(p['AuthorizationType']).toBe('JWT');
    // Public by design: signed links, origin check and rate limits in the handler.
    expect(open.map((p) => p['RouteKey']).sort()).toEqual([
      'GET /reviews',
      'GET /reviews/invite',
      'POST /feedback',
      'POST /reviews',
      'POST /unsubscribe',
    ]);
    for (const p of open) expect(p['AuthorizationType'] ?? 'NONE').toBe('NONE');
  });

  it('payment-cycle emails are off unless switched on', () => {
    for (const name of ['merch-os-engagement-scheduled-dev', 'merch-os-engagement-onevent-dev']) {
      t.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: name,
        Environment: { Variables: Match.objectLike({ BILLING_LIFECYCLE: 'false' }) },
      });
    }
  });

  it('referral free months: off unless switched on; asks billing on the bus and hears back', () => {
    for (const name of ['merch-os-engagement-scheduled-dev', 'merch-os-engagement-onevent-dev']) {
      t.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: name,
        Environment: { Variables: Match.objectLike({ REFERRAL_FREE_MONTHS: 'false', EVENT_BUS_NAME: 'merch-os-events-dev' }) },
      });
    }
    t.hasResourceProperties('AWS::Events::Rule', {
      EventBusName: 'merch-os-events-dev',
      EventPattern: { source: ['merch-os.billing'], 'detail-type': ['billing.subscription.extended'] },
    });
    expect(policies()).toContain('"events:PutEvents"');
    expect(policies()).toContain('event-bus/merch-os-events-dev');
  });

  it('only allows our own site and admin origins', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith(['https://merchos.co.za', 'https://admin.merchos.co.za']),
      }),
    });
  });

  it('sends from info@ through the verified domain only', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-engagement-scheduled-dev',
      Environment: { Variables: Match.objectLike({ FROM_EMAIL: 'MerchOS <info@merchos.co.za>' }) },
    });
    expect(policies()).toContain('identity/merchos.co.za');
  });

  it('reads other services read-only (no writes to tenants or products)', () => {
    const p = policies();
    expect(p).toContain('cognito-idp:AdminGetUser');
    expect(p).not.toMatch(/cognito-idp:Admin(Update|Delete|Create|Disable)/);
    const statements = Object.values(t.findResources('AWS::IAM::Policy')).flatMap(
      (r) => (r['Properties'] as { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } }).PolicyDocument.Statement,
    );
    for (const s of statements) {
      const res = JSON.stringify(s.Resource);
      if (res.includes('merch-os-tenants-dev') || res.includes('merch-os-products-dev')) {
        const actions = ([] as string[]).concat(s.Action);
        expect(actions.every((a) => a === 'dynamodb:GetItem' || a === 'dynamodb:Query')).toBe(true);
      }
    }
  });

  it('runs later steps through its own Scheduler group', () => {
    t.hasResourceProperties('AWS::Scheduler::ScheduleGroup', { Name: 'merch-os-engagement-dev' });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-engagement-onevent-dev',
      Environment: { Variables: Match.objectLike({ SCHEDULE_GROUP: 'merch-os-engagement-dev' }) },
    });
  });

  it('two admin functions with different RBAC entry points', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-engagement-adminreviews-dev',
      Handler: 'index.reviewsHandler',
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-engagement-adminreferrals-dev',
      Handler: 'index.referralsHandler',
    });
  });
});
