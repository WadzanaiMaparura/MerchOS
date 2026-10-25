import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import { RegistrationReconciliationStack } from '../lib/registration-reconciliation-stack';

/**
 * Infrastructure tests for RegistrationReconciliationStack.
 *
 * A host stack supplies a KMS key standing in for the Foundation platform key
 * so the stack can be synthesised in isolation (same pattern as the TenantStack
 * tests). Lambda asset bundling is skipped by this synthesis path.
 */
function synth(env = 'dev'): Template {
  // Skip esbuild asset bundling during unit synthesis: NodejsFunction otherwise
  // shells out to esbuild, which fails inside a vitest worker thread (invalid
  // 'stdio'). The CloudFormation template is identical either way; only the
  // S3 asset hash differs, which these property assertions do not depend on.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const host = new cdk.Stack(app, 'HostStack', {
    env: { account: '388096320605', region: 'eu-west-1' },
  });
  const platformKey = new kms.Key(host, 'PlatformKey');

  const stack = new RegistrationReconciliationStack(app, `MerchOS-RegistrationReconciliation-${env}`, {
    env: { account: '388096320605', region: 'eu-west-1' },
    environment: env,
    platformKey,
  });
  return Template.fromStack(stack);
}

describe('RegistrationReconciliationStack', () => {
  it('provisions exactly two SQS queues (reconciliation + DLQ)', () => {
    const t = synth();
    t.resourceCountIs('AWS::SQS::Queue', 2);
  });

  it('encrypts both queues with a customer-managed KMS key', () => {
    const t = synth();
    const queues = t.findResources('AWS::SQS::Queue');
    for (const q of Object.values(queues)) {
      expect(q.Properties?.KmsMasterKeyId).toBeDefined();
    }
  });

  it('names the queue and DLQ per convention', () => {
    const t = synth('dev');
    t.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'merch-os-registration-reconciliation-dev' });
    t.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'merch-os-registration-reconciliation-dlq-dev' });
  });

  it('wires a redrive policy from the main queue to the DLQ with maxReceiveCount=5', () => {
    const t = synth();
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'merch-os-registration-reconciliation-dev',
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
    });
  });

  it('retains the DLQ for 14 days', () => {
    const t = synth();
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'merch-os-registration-reconciliation-dlq-dev',
      MessageRetentionPeriod: 1209600, // 14 days in seconds
    });
  });

  it('enforces SSL on both queues', () => {
    const t = synth();
    const policies = t.findResources('AWS::SQS::QueuePolicy');
    // enforceSSL creates a queue policy denying non-TLS access for each queue.
    expect(Object.keys(policies).length).toBeGreaterThanOrEqual(2);
  });

  it('creates exactly one Lambda worker wired to the queue via an event source mapping', () => {
    const t = synth();
    t.resourceCountIs('AWS::Lambda::Function', 1);
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-registration-reconciliation-dev',
      Runtime: 'nodejs20.x',
    });
    t.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
    });
  });

  it('grants least-privilege DynamoDB: only GetItem, DeleteItem, TransactWriteItems (no Scan/Query/index)', () => {
    const t = synth();
    const policies = t.findResources('AWS::IAM::Policy');
    const actions = new Set<string>();
    for (const p of Object.values(policies)) {
      for (const stmt of p.Properties?.PolicyDocument?.Statement ?? []) {
        const acts = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        for (const a of acts) if (typeof a === 'string' && a.startsWith('dynamodb:')) actions.add(a);
      }
    }
    expect(actions).toEqual(new Set(['dynamodb:GetItem', 'dynamodb:DeleteItem', 'dynamodb:TransactWriteItems']));
    expect(actions.has('dynamodb:Scan')).toBe(false);
    expect(actions.has('dynamodb:Query')).toBe(false);
  });

  it('grants only cognito-idp:AdminGetUser on Cognito', () => {
    const t = synth();
    const policies = t.findResources('AWS::IAM::Policy');
    const cognitoActions = new Set<string>();
    for (const p of Object.values(policies)) {
      for (const stmt of p.Properties?.PolicyDocument?.Statement ?? []) {
        const acts = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        for (const a of acts) if (typeof a === 'string' && a.startsWith('cognito-idp:')) cognitoActions.add(a);
      }
    }
    expect(cognitoActions).toEqual(new Set(['cognito-idp:AdminGetUser']));
  });

  it('grants KMS decrypt + generate-data-key for the encrypted table and queues', () => {
    const t = synth();
    const policies = t.findResources('AWS::IAM::Policy');
    const kmsActions = new Set<string>();
    for (const p of Object.values(policies)) {
      for (const stmt of p.Properties?.PolicyDocument?.Statement ?? []) {
        const acts = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        for (const a of acts) if (typeof a === 'string' && a.startsWith('kms:')) kmsActions.add(a);
      }
    }
    expect(kmsActions.has('kms:Decrypt')).toBe(true);
    expect(kmsActions.has('kms:GenerateDataKey')).toBe(true);
  });

  it('defines the five reconciliation alarms', () => {
    const t = synth();
    // DLQ depth, backlog, message age, worker error rate, enqueue failure.
    t.resourceCountIs('AWS::CloudWatch::Alarm', 5);
    for (const name of [
      'merch-os-registration-reconciliation-dlq-depth-dev',
      'merch-os-registration-reconciliation-backlog-dev',
      'merch-os-registration-reconciliation-message-age-dev',
      'merch-os-registration-reconciliation-worker-error-rate-dev',
      'merch-os-registration-reconciliation-enqueue-failure-dev',
    ]) {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: name });
    }
  });

  it('the DLQ-depth alarm fires on any visible message (threshold 0)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'merch-os-registration-reconciliation-dlq-depth-dev',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
    });
  });

  it('exports queue/DLQ coordinates via SSM parameters', () => {
    const t = synth('dev');
    for (const name of [
      '/merch-os/dev/sqs/registration-reconciliation-url',
      '/merch-os/dev/sqs/registration-reconciliation-arn',
      '/merch-os/dev/sqs/registration-reconciliation-dlq-url',
      '/merch-os/dev/sqs/registration-reconciliation-dlq-arn',
    ]) {
      t.hasResourceProperties('AWS::SSM::Parameter', { Name: name });
    }
  });
});
