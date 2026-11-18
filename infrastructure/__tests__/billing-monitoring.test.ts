import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { BillingApiStack } from '../lib/billing-api-stack';

/** Synthesises the Billing API stack (bundling stubbed) with optional context. */
function synth(context: Record<string, string> = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  const envProps = { account: '123456789012', region: 'eu-west-1' };
  const deps = new cdk.Stack(app, 'TestDeps', { env: envProps });
  const platformKey = new kms.Key(deps, 'PlatformKey');
  const userPool = new cognito.UserPool(deps, 'Pool');
  const sellerDashboardClient = userPool.addClient('Seller');
  const stack = new BillingApiStack(app, 'TestBilling', {
    env: envProps,
    environment: 'dev',
    userPool,
    sellerDashboardClient,
    platformKey,
  });
  return Template.fromStack(stack);
}

const ALARMS = ['ItnErrors', 'ItnRetrying', 'ItnRejected', 'ItnAnomaly', 'CheckoutErrors', 'InvoiceIssueFailed'];

describe('Billing payment monitoring', () => {
  it('creates the six billing alarms, each notifying the billing topic on ALARM and OK', () => {
    const t = synth();
    for (const name of ALARMS) {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: `merch-os-billing-${name}-dev`,
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        TreatMissingData: 'notBreaching',
        AlarmActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('BillingAlarmTopic') })],
        OKActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('BillingAlarmTopic') })],
      });
    }
    t.resourceCountIs('AWS::CloudWatch::Alarm', ALARMS.length);
  });

  it('builds log metric filters on the ITN log group from the handler messages', () => {
    const t = synth();
    // 3 ITN filters + 2 feeding the invoice-failure metric.
    t.resourceCountIs('AWS::Logs::MetricFilter', 5);
    t.hasResourceProperties('AWS::Logs::MetricFilter', {
      // Built from the ITN function's name (a CloudFormation reference), so the
      // filter always targets that function's log group.
      LogGroupName: { 'Fn::Join': ['', ['/aws/lambda/', Match.objectLike({ Ref: Match.stringLikeRegexp('PayfastItn') })]] },
      FilterPattern: Match.stringLikeRegexp('ITN rejected'),
      MetricTransformations: [
        Match.objectLike({ MetricNamespace: 'MerchOS/Billing/dev', MetricName: 'ItnRejected', DefaultValue: 0 }),
      ],
    });
    t.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: Match.stringLikeRegexp('ITN amount mismatch'),
    });
  });

  it('has no email subscription unless billingAlarmEmail is provided', () => {
    synth().resourceCountIs('AWS::SNS::Subscription', 0);
    const t = synth({ billingAlarmEmail: 'ops@example.com' });
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
  });

  it('keeps checkout closed by default (launch gate)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-changeplan-dev',
      Environment: { Variables: Match.objectLike({ CHECKOUT_ENABLED: 'false' }) },
    });
    synth({ checkoutEnabled: 'true' }).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-changeplan-dev',
      Environment: { Variables: Match.objectLike({ CHECKOUT_ENABLED: 'true' }) },
    });
  });
});
