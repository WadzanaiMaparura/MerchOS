import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { AdminApiStack } from '../lib/admin-api-stack';

const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
const envProps = { account: '123456789012', region: 'eu-west-1' };
const deps = new cdk.Stack(app, 'TestDeps', { env: envProps });
const stack = new AdminApiStack(app, 'TestAdminApi', {
  env: envProps,
  environment: 'dev',
  userPool: new cognito.UserPool(deps, 'Pool'),
  platformKey: new kms.Key(deps, 'PlatformKey'),
  sellerClientId: 'seller-client-id',
  adminClientId: 'admin-client-id',
  tenantsTableArn: 'arn:aws:dynamodb:eu-west-1:123456789012:table/merch-os-tenants-dev',
});
const t = Template.fromStack(stack);
/** IAM statements of every admin function except the data retention job (checked on its own below). */
const statements = () =>
  Object.entries(t.findResources('AWS::IAM::Policy'))
    .filter(([id]) => !id.startsWith('DataRetentionRole'))
    .map(([, r]) => r)
    .flatMap(
    (r) => (r['Properties'] as { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } }).PolicyDocument.Statement,
  );
const actionsOn = (resourcePart: string) =>
  statements()
    .filter((s) => JSON.stringify(s.Resource).includes(resourcePart))
    .flatMap((s) => ([] as string[]).concat(s.Action));

describe('Admin API stack', () => {
  it('own table: encrypted with the platform key, PITR, kept on delete', () => {
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'merch-os-admin-dev',
      SSESpecification: Match.objectLike({ SSEEnabled: true, SSEType: 'KMS' }),
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    t.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Retain' });
  });

  it('every route needs an admin dashboard sign-in', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: { Audience: ['admin-client-id'], Issuer: Match.anyValue() },
    });
    const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')).map((r) => r['Properties'] as Record<string, unknown>);
    expect(routes).toHaveLength(35);
    for (const r of routes) expect(r['AuthorizationType']).toBe('JWT');
  });

  it('only the admin dashboard origins may call it', () => {
    t.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: Match.arrayWith(['https://admin.merchos.co.za']) }),
    });
    const api = Object.values(t.findResources('AWS::ApiGatewayV2::Api'))[0]!['Properties'] as { CorsConfiguration: { AllowOrigins: string[] } };
    expect(api.CorsConfiguration.AllowOrigins).not.toContain('https://merchos.co.za');
  });

  it('other services: read-only, except the trial entitlement write', () => {
    for (const table of ['merch-os-tenants-dev', 'merch-os-engagement-dev']) {
      expect(actionsOn(table).every((a) => ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query'].includes(a))).toBe(true);
    }
    expect(actionsOn('merch-os-products-dev')).not.toContain('dynamodb:DeleteItem');
    const all = statements().flatMap((s) => ([] as string[]).concat(s.Action));
    expect(all).not.toContain('cognito-idp:AdminDeleteUser');
    // Deletes only on this service's own table (alert pointers), never on another service's data.
    for (const s of statements()) {
      if (([] as string[]).concat(s.Action).some((a) => a.startsWith('dynamodb:Delete'))) {
        expect(JSON.stringify(s.Resource)).toContain('AdminTable');
      }
    }
  });

  it('billing is read only: no writes to billing data or invoice files', () => {
    expect(actionsOn('merch-os-billing-dev').every((a) => ['dynamodb:GetItem', 'dynamodb:BatchGetItem', 'dynamodb:Query', 'dynamodb:Scan'].includes(a))).toBe(true);
    expect(actionsOn('merch-os-invoices-dev')).toEqual(['s3:GetObject']);
  });

  it('the audit log only reads', () => {
    const audit = Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) => id.startsWith('AuditReadRole'))!;
    const actions = JSON.stringify(audit[1]);
    expect(actions).not.toMatch(/PutItem|UpdateItem|DeleteItem|AdminDisable|AdminEnable/);
  });

  it('health check every 15 minutes, and existing alarms feed the same alerts', () => {
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'rate(15 minutes)' });
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: { source: ['aws.cloudwatch'], 'detail-type': ['CloudWatch Alarm State Change'], detail: { alarmName: [{ prefix: 'merch-os-' }] } },
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-admin-alertsmonitor-dev',
      Environment: { Variables: Match.objectLike({ ALERT_EMAIL: 'admin@merchos.co.za' }) },
    });
  });

  it('team goals only read the live chat data, and chat messages expire', () => {
    expect(actionsOn('merch-os-support-chat-dev')).toEqual(['dynamodb:Query']);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'merch-os-admin-dev',
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('data retention: daily, off unless switched on, the only role that may delete seller data (never by Scan)', () => {
    t.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(0 1 * * ? *)' });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-admin-dataretention-dev',
      Timeout: 900,
      Environment: { Variables: Match.objectLike({ DATA_RETENTION: 'off', RAW_UPLOADS_BUCKET: 'merch-os-raw-uploads-dev' }) },
    });
    const [, policy] = Object.entries(t.findResources('AWS::IAM::Policy')).find(([id]) => id.startsWith('DataRetentionRole'))!;
    const st = (policy['Properties'] as { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown; Condition?: unknown }> } })
      .PolicyDocument.Statement;
    const acts = st.flatMap((s) => ([] as string[]).concat(s.Action));
    expect(acts).toContain('cognito-idp:AdminDeleteUser');
    expect(acts).not.toContain('dynamodb:Scan');
    expect(acts).not.toContain('s3:DeleteBucket');
    // File deletes only under the seller prefixes; never the invoices bucket.
    const s3Deletes = st.filter((s) => ([] as string[]).concat(s.Action).includes('s3:DeleteObjectVersion'));
    expect(JSON.stringify(s3Deletes)).not.toContain('invoices');
    for (const r of ([] as string[]).concat(s3Deletes[0]!.Resource as string[])) {
      expect(r).toMatch(/^arn:aws:s3:::merch-os-(raw-uploads|assets|exports)-dev\/(suppliers|images|assets|tenants)\/\*$/);
    }
    // Listing versions only within those prefixes.
    for (const s of st.filter((x) => ([] as string[]).concat(x.Action).includes('s3:ListBucketVersions'))) {
      expect(JSON.stringify(s.Condition)).toContain('s3:prefix');
    }
  });
  it('only the manage function can disable accounts', () => {
    const fns = t.findResources('AWS::IAM::Policy');
    const withDisable = Object.entries(fns).filter(([, r]) => JSON.stringify(r).includes('cognito-idp:AdminDisableUser'));
    expect(withDisable).toHaveLength(1);
    expect(withDisable[0]![0]).toMatch(/CustomersManage/);
  });
});
