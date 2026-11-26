import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { BillingApiStack } from '../lib/billing-api-stack';

/** Synthesises the Billing API stack (bundling stubbed) with optional context. */
function synth(context: Record<string, unknown> = {}) {
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

const ALARMS = ['ItnErrors', 'ItnRetrying', 'ItnRejected', 'ItnAnomaly', 'FreeMonthErrors', 'CheckoutErrors', 'InvoiceIssueFailed'];

describe('Billing payment monitoring', () => {
  it('creates the seven billing alarms, each notifying the billing topic on ALARM and OK', () => {
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
      // The stack-owned ITN log group (a Ref), so the filter can be created in a
      // fresh environment before the Lambda has ever run.
      LogGroupName: { Ref: Match.stringLikeRegexp('PayfastItnManagedLogGroup') },
      FilterPattern: Match.stringLikeRegexp('ITN rejected'),
      MetricTransformations: [
        Match.objectLike({ MetricNamespace: 'MerchOS/Billing/dev', MetricName: 'ItnRejected', DefaultValue: 0 }),
      ],
    });
    t.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: Match.stringLikeRegexp('ITN amount mismatch'),
    });
    // ...and the ITN Lambda actually writes to that group.
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-payfastitn-dev',
      LoggingConfig: { LogGroup: { Ref: Match.stringLikeRegexp('PayfastItnManagedLogGroup') } },
    });
    t.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/merch-os/dev/billing/payfast-itn',
      RetentionInDays: 365,
    });
  });

  it('reads per-environment settings from envConfig, with --context overriding them', () => {
    const fromConfig = synth({ envConfig: { dev: { payfastMode: 'live', billingAlarmEmail: 'ops@example.com' } } });
    fromConfig.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-payfastitn-dev',
      Environment: { Variables: Match.objectLike({ PAYFAST_MODE: 'live', CHECKOUT_ENABLED: 'false' }) },
    });
    fromConfig.hasResourceProperties('AWS::SNS::Subscription', { Endpoint: 'ops@example.com' });

    const overridden = synth({ envConfig: { dev: { payfastMode: 'live' } }, payfastMode: 'sandbox' });
    overridden.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-payfastitn-dev',
      Environment: { Variables: Match.objectLike({ PAYFAST_MODE: 'sandbox' }) },
    });
  });

  it('invoice PDFs are kept 6 years (SARS), then removed with their old versions', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'merch-os-invoices-dev-123456789012',
      LifecycleConfiguration: {
        Rules: [Match.objectLike({ Id: 'KeepInvoices6Years', ExpirationInDays: 2192, NoncurrentVersionExpiration: { NoncurrentDays: 30 }, Status: 'Enabled' })],
      },
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

describe('Billing payment cycle (reminders, pause, close)', () => {
  it('is off unless switched on, and GET /billing may only read the entitlement', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-getbilling-dev',
      Environment: {
        Variables: Match.objectLike({ BILLING_LIFECYCLE: 'false', PRODUCTS_TABLE: 'merch-os-products-dev' }),
      },
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'dynamodb:GetItem',
            Resource: 'arn:aws:dynamodb:eu-west-1:123456789012:table/merch-os-products-dev',
          }),
        ]),
      },
    });
    const on = synth({ billingLifecycle: 'true' });
    on.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-changeplan-dev',
      Environment: { Variables: Match.objectLike({ BILLING_LIFECYCLE: 'true' }) },
    });
  });
});

describe('Billing card subscriptions (automatic monthly charges)', () => {
  it('is off unless switched on; cancel has its own Lambda, route and narrow permissions', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-changeplan-dev',
      Environment: { Variables: Match.objectLike({ CARD_SUBSCRIPTIONS: 'false' }) },
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-cancelsubscription-dev',
      Environment: { Variables: Match.objectLike({ PRODUCTS_TABLE: 'merch-os-products-dev' }) },
    });
    t.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /billing/subscription/cancel',
      AuthorizationType: 'JWT',
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'dynamodb:UpdateItem', Resource: 'arn:aws:dynamodb:eu-west-1:123456789012:table/merch-os-products-dev' }),
        ]),
      },
    });
    synth({ cardSubscriptions: 'true' }).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-payfastitn-dev',
      Environment: { Variables: Match.objectLike({ CARD_SUBSCRIPTIONS: 'true' }) },
    });
  });
});

describe('Billing permanent address for PayFast (api.merchos.co.za)', () => {
  const withDomain = () =>
    synth({ billingApiDomain: 'api.merchos.co.za', hostedZoneId: 'Z04418812LQLSF1AUT0WU', hostedZoneName: 'merchos.co.za' });

  it('certificate (DNS validated), custom domain, mapping and DNS record; checkout notifies the permanent address', () => {
    const t = withDomain();
    t.hasResourceProperties('AWS::CertificateManager::Certificate', { DomainName: 'api.merchos.co.za', ValidationMethod: 'DNS' });
    t.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'api.merchos.co.za' });
    t.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
    t.hasResourceProperties('AWS::Route53::RecordSet', { Name: 'api.merchos.co.za.', Type: 'A', HostedZoneId: 'Z04418812LQLSF1AUT0WU' });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-changeplan-dev',
      Environment: { Variables: Match.objectLike({ PAYFAST_NOTIFY_URL: 'https://api.merchos.co.za/billing/payfast/itn' }) },
    });
  });

  it('nothing is created without the settings', () => {
    const t = synth();
    t.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
    t.resourceCountIs('AWS::CertificateManager::Certificate', 0);
  });
});

describe('Billing referral free months', () => {
  it('is off unless switched on; listens for engagement.referral.reward-earned and may answer on the bus', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-referralfreemonth-dev',
      Environment: {
        Variables: Match.objectLike({
          REFERRAL_FREE_MONTHS: 'false',
          PRODUCTS_TABLE: 'merch-os-products-dev',
          EVENT_BUS_NAME: 'merch-os-events-dev',
        }),
      },
    });
    t.hasResourceProperties('AWS::Events::Rule', {
      EventBusName: 'merch-os-events-dev',
      EventPattern: { source: ['merch-os.engagement'], 'detail-type': ['engagement.referral.reward-earned'] },
      Targets: [Match.objectLike({ RetryPolicy: Match.objectLike({ MaximumRetryAttempts: 8 }) })],
    });
    t.hasResourceProperties('AWS::IAM::Policy', {
      Roles: [{ Ref: Match.stringLikeRegexp('ReferralFreeMonthRole') }],
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'events:PutEvents', Resource: 'arn:aws:events:eu-west-1:123456789012:event-bus/merch-os-events-dev' }),
        ]),
      },
    });
    synth({ referralFreeMonths: 'true' }).hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-referralfreemonth-dev',
      Environment: { Variables: Match.objectLike({ REFERRAL_FREE_MONTHS: 'true' }) },
    });
  });
});
