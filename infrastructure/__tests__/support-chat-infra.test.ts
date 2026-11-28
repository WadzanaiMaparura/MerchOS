import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { SupportChatStack } from '../lib/support-chat-stack';

function synth(context: Record<string, unknown> = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  const envProps = { account: '123456789012', region: 'eu-west-1' };
  const deps = new cdk.Stack(app, 'TestDeps', { env: envProps });
  const platformKey = new kms.Key(deps, 'PlatformKey');
  const userPool = new cognito.UserPool(deps, 'Pool');
  const stack = new SupportChatStack(app, 'TestSupportChat', {
    env: envProps,
    environment: 'dev',
    userPool,
    platformKey,
    adminClientId: 'admin-client-id',
  });
  return Template.fromStack(stack);
}

const fn = (name: string) => `merch-os-support-chat-${name}-dev`;

describe('Support chat stack', () => {
  const t = synth();

  it('stores chats encrypted with the platform key, with PITR and a 12-month TTL attribute', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'merch-os-support-chat-dev',
      SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }),
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'GSI1' })],
    });
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  });

  it('protects every /support route with the admin-client JWT authorizer', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: { Audience: ['admin-client-id'], Issuer: Match.anyValue() },
    });
    const routes = t.findResources('AWS::ApiGatewayV2::Route');
    const http = Object.values(routes).map((r) => r['Properties'] as Record<string, unknown>);
    const support = http.filter((p) => String(p['RouteKey']).includes(' /support/'));
    expect(support.length).toBe(12);
    for (const p of support) expect(p['AuthorizationType']).toBe('JWT');
    // Visitor routes are public by design (origin/token/limits in the handler).
    const visitor = http.filter((p) => String(p['RouteKey']).includes(' /chat/'));
    expect(visitor.length).toBe(5);
    for (const p of visitor) expect(p['AuthorizationType'] ?? 'NONE').toBe('NONE');
  });

  it('has the WebSocket routes', () => {
    for (const key of ['$connect', '$disconnect', '$default']) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: key });
    }
  });

  it('only allows our own site and admin origins', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowOrigins: Match.arrayWith(['https://dev.merchos.co.za', 'https://admin.dev.merchos.co.za']),
      }),
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: fn('wsconnect'),
      Environment: {
        Variables: Match.objectLike({
          VISITOR_ORIGINS: Match.stringLikeRegexp('https://dev.merchos.co.za'),
          AGENT_ORIGINS: Match.stringLikeRegexp('https://admin.dev.merchos.co.za'),
        }),
      },
    });
  });

  it('emails the support mailbox from the verified domain', () => {
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: fn('publicapi'),
      Environment: {
        Variables: Match.objectLike({ SUPPORT_EMAIL: 'info@merchos.co.za', AGENT_DISPLAY_NAME: 'Imani' }),
      },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendEmail',
            Resource: 'arn:aws:ses:eu-west-1:123456789012:identity/merchos.co.za',
          }),
        ]),
      },
    });
  });

  it('lets only the scheduler service assume the timer role', () => {
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: { Service: 'scheduler.amazonaws.com' },
            Condition: { StringEquals: { 'aws:SourceAccount': '123456789012' } },
          }),
        ],
      },
    });
    t.hasResourceProperties('AWS::Scheduler::ScheduleGroup', { Name: 'merch-os-support-chat-dev' });
  });

  it('keeps the chat secret out of Lambda environment variables', () => {
    const fns = t.findResources('AWS::Lambda::Function');
    for (const f of Object.values(fns)) {
      const vars = (f['Properties']?.['Environment']?.['Variables'] ?? {}) as Record<string, unknown>;
      expect(Object.keys(vars).some((k) => /VAPID|TOKEN_SECRET|PRIVATE/i.test(k))).toBe(false);
    }
  });

  it('reads the email recipient from envConfig', () => {
    synth({ envConfig: { dev: { chatSupportEmail: 'help@example.com' } } }).hasResourceProperties(
      'AWS::Lambda::Function',
      { FunctionName: fn('publicapi'), Environment: { Variables: Match.objectLike({ SUPPORT_EMAIL: 'help@example.com' }) } },
    );
  });
});
