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
const statements = () =>
  Object.values(t.findResources('AWS::IAM::Policy')).flatMap(
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
    expect(routes).toHaveLength(10);
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
    expect(all.some((a) => a.startsWith('dynamodb:Delete'))).toBe(false);
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

  it('only the manage function can disable accounts', () => {
    const fns = t.findResources('AWS::IAM::Policy');
    const withDisable = Object.entries(fns).filter(([, r]) => JSON.stringify(r).includes('cognito-idp:AdminDisableUser'));
    expect(withDisable).toHaveLength(1);
    expect(withDisable[0]![0]).toMatch(/CustomersManage/);
  });
});
