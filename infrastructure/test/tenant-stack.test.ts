import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import { TenantStack } from '../lib/tenant-stack';

/**
 * Infrastructure tests for TenantStack.
 *
 * A small host stack provides a KMS key to stand in for the Foundation
 * platform key, so TenantStack can be synthesised in isolation.
 */
function synthTenantTemplate(env = 'dev'): { template: Template; app: cdk.App } {
  const app = new cdk.App();

  // Host stack supplying the platform KMS key (mirrors FoundationStack.platformKey).
  const host = new cdk.Stack(app, 'HostStack', {
    env: { account: '388096320605', region: 'eu-west-1' },
  });
  const platformKey = new kms.Key(host, 'PlatformKey');

  const stack = new TenantStack(app, `MerchOS-Tenant-${env}`, {
    env: { account: '388096320605', region: 'eu-west-1' },
    environment: env,
    platformKey,
  });

  return { template: Template.fromStack(stack), app };
}

describe('TenantStack', () => {
  it('provisions exactly one DynamoDB table', () => {
    const { template } = synthTenantTemplate();
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('uses PK and SK as the only key schema (string hash + range)', () => {
    const { template } = synthTenantTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ]),
    });
  });

  it('names the table merch-os-tenants-<env>', () => {
    const { template } = synthTenantTemplate('dev');
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'merch-os-tenants-dev',
    });
  });

  it('uses on-demand (PAY_PER_REQUEST) billing', () => {
    const { template } = synthTenantTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('configures customer-managed KMS encryption (SSEType KMS + imported key ref)', () => {
    const { template } = synthTenantTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: Match.objectLike({
        SSEEnabled: true,
        SSEType: 'KMS',
        // Customer-managed key: references the imported Foundation platform key
        // (a cross-stack reference), not an AWS-managed/default alias. Asserting
        // presence of KMSMasterKeyId distinguishes CUSTOMER_MANAGED from the
        // AWS_OWNED/AWS_MANAGED modes, which omit this property entirely.
        KMSMasterKeyId: Match.anyValue(),
      }),
    });
  });

  it('enables point-in-time recovery', () => {
    const { template } = synthTenantTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('enables TTL on expiresAt', () => {
    const { template } = synthTenantTemplate();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    });
  });

  it('applies RemovalPolicy.RETAIN to the table', () => {
    const { template } = synthTenantTemplate();
    template.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  it('creates no secondary indexes (no GSIs or LSIs)', () => {
    const { template } = synthTenantTemplate();
    const tables = template.findResources('AWS::DynamoDB::Table');
    const table = Object.values(tables)[0];
    expect(table).toBeDefined();
    expect(table?.Properties?.GlobalSecondaryIndexes).toBeUndefined();
    expect(table?.Properties?.LocalSecondaryIndexes).toBeUndefined();
  });

  it('exports the table name via SSM referencing the table resource', () => {
    const { template } = synthTenantTemplate('dev');
    // Name parameter: Value is a Ref to the table (its physical name).
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/merch-os/dev/dynamodb/tenants-table',
      Value: Match.objectLike({ Ref: Match.stringLikeRegexp('^TenantsTable') }),
    });
  });

  it('exports the table ARN via SSM referencing the table Arn attribute', () => {
    const { template } = synthTenantTemplate('dev');
    // Arn parameter: Value is Fn::GetAtt <table>.Arn.
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Name: '/merch-os/dev/dynamodb/tenants-table-arn',
      Value: Match.objectLike({
        'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^TenantsTable'), 'Arn']),
      }),
    });
  });

  it('declares exactly two SSM parameters', () => {
    const { template } = synthTenantTemplate();
    template.resourceCountIs('AWS::SSM::Parameter', 2);
  });

  it('emits CloudFormation outputs for the table name and ARN with export names', () => {
    const { template } = synthTenantTemplate('dev');
    template.hasOutput('TenantsTableName', {
      Value: Match.objectLike({ Ref: Match.stringLikeRegexp('^TenantsTable') }),
      Export: { Name: 'MerchOS-Tenant-dev-TenantsTableName' },
    });
    template.hasOutput('TenantsTableArn', {
      Value: Match.objectLike({
        'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^TenantsTable'), 'Arn']),
      }),
      Export: { Name: 'MerchOS-Tenant-dev-TenantsTableArn' },
    });
  });

  it('grants no IAM policies (table provisioning only; runtime wiring deferred)', () => {
    const { template } = synthTenantTemplate();
    // This gate provisions the table only — no Lambda/role/policy wiring yet.
    template.resourceCountIs('AWS::IAM::Policy', 0);
    template.resourceCountIs('AWS::IAM::Role', 0);
  });
});
