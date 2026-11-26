import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { BillingApiStack } from '../lib/billing-api-stack';

function synth(context: Record<string, string> = {}) {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [], ...context } });
  const envProps = { account: '123456789012', region: 'eu-west-1' };
  const deps = new cdk.Stack(app, 'TestDeps', { env: envProps });
  const platformKey = new kms.Key(deps, 'PlatformKey');
  const userPool = new cognito.UserPool(deps, 'Pool');
  const stack = new BillingApiStack(app, 'TestBilling', {
    env: envProps,
    environment: 'dev',
    userPool,
    sellerDashboardClient: userPool.addClient('Seller'),
    platformKey,
  });
  return Template.fromStack(stack);
}

const routeKeys = (t: Template) =>
  Object.values(t.findResources('AWS::ApiGatewayV2::Route')).map(
    (r) => (r as { Properties: { RouteKey: string } }).Properties.RouteKey
  );

describe('Billing invoice infrastructure', () => {
  it('stores invoices in a private, encrypted, versioned, retained bucket, kept 6 years', () => {
    const t = synth();
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'merch-os-invoices-dev-123456789012',
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: { ServerSideEncryptionConfiguration: [Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } })] },
      VersioningConfiguration: { Status: 'Enabled' },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    });
    t.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    // Accounting records: one rule only, and never earlier than 6 years (SARS: 5 years from the return).
    const bucket = Object.values(t.findResources('AWS::S3::Bucket'))[0] as {
      Properties: { LifecycleConfiguration: { Rules: Array<{ ExpirationInDays: number }> } };
    };
    expect(bucket.Properties.LifecycleConfiguration.Rules).toHaveLength(1);
    expect(bucket.Properties.LifecycleConfiguration.Rules[0]!.ExpirationInDays).toBeGreaterThanOrEqual(6 * 365);
    // TLS only.
    t.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } })]) },
    });
  });

  it('exposes the invoice download and profile routes behind the JWT authorizer', () => {
    const t = synth();
    const keys = routeKeys(t);
    expect(keys).toEqual(
      expect.arrayContaining([
        'GET /billing/invoices/{invoiceId}/pdf',
        'GET /billing/profile',
        'PUT /billing/profile',
      ])
    );
    const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')) as Array<{ Properties: Record<string, unknown> }>;
    for (const key of ['GET /billing/invoices/{invoiceId}/pdf', 'GET /billing/profile', 'PUT /billing/profile']) {
      const r = routes.find((x) => x.Properties['RouteKey'] === key)!;
      expect(r.Properties['AuthorizationType']).toBe('JWT');
    }
    // The webhook stays the only unauthenticated route.
    const open = routes.filter((x) => x.Properties['AuthorizationType'] === 'NONE').map((x) => x.Properties['RouteKey']);
    expect(open).toEqual(['POST /billing/payfast/itn']);
  });

  it('allows PUT in CORS so the profile form works from the browser', () => {
    synth().hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowMethods: Match.arrayWith(['PUT']) }),
    });
  });

  it('gives only the webhook and download Lambdas S3 access, scoped to invoices/*', () => {
    const t = synth();
    const policies = Object.values(t.findResources('AWS::IAM::Policy')) as Array<{
      Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } };
    }>;
    const s3Statements = policies.flatMap((p) =>
      p.Properties.PolicyDocument.Statement.filter((st) => String(JSON.stringify(st.Action)).includes('s3:'))
    );
    expect(s3Statements.length).toBeGreaterThan(0);
    for (const st of s3Statements) {
      // Only object-level Put/Get; never list, delete or bucket-wide access.
      const actions = ([] as string[]).concat(st.Action);
      expect(actions.every((a) => a === 's3:PutObject' || a === 's3:GetObject')).toBe(true);
      expect(JSON.stringify(st.Resource)).toContain('/invoices/*');
    }
    // Functions without invoice duties get no S3 statements at all.
    const withS3 = policies.filter((p) => JSON.stringify(p.Properties.PolicyDocument).includes('s3:')).length;
    expect(withS3).toBe(2); // PayfastItn + GetInvoicePdf
  });

  it('passes the bucket and optional issuer overrides to the Lambdas', () => {
    const t = synth({ invoiceIssuerLegalName: 'Acme Holdings (Pty) Ltd', invoiceIssuerRegNo: '2019/123456/07' });
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-getinvoicepdf-dev',
      Environment: {
        Variables: Match.objectLike({
          INVOICE_BUCKET: Match.anyValue(),
          INVOICE_ISSUER_LEGAL_NAME: 'Acme Holdings (Pty) Ltd',
          INVOICE_ISSUER_REG_NO: '2019/123456/07',
        }),
      },
    });
    // Not set unless provided.
    const bare = synth();
    const fn = Object.values(bare.findResources('AWS::Lambda::Function')).find(
      (f) => (f as { Properties: { FunctionName?: string } }).Properties.FunctionName === 'merch-os-billing-getinvoicepdf-dev'
    ) as { Properties: { Environment: { Variables: Record<string, unknown> } } };
    expect(fn.Properties.Environment.Variables).not.toHaveProperty('INVOICE_ISSUER_LEGAL_NAME');
  });

  it('creates the download Lambda log group explicitly, so its metric filter can be created at deploy time', () => {
    // Regression: a Lambda's log group only exists after its first invocation, so a
    // metric filter pointing at the auto-created name made CloudFormation fail with
    // "The specified log group does not exist" and roll the whole stack back.
    const t = synth();
    t.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/merch-os-billing-getinvoicepdf-dev',
      RetentionInDays: 365,
    });
    t.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Delete' });
    // The filter references the resource (a Ref), not a hard-coded name string.
    t.hasResourceProperties('AWS::Logs::MetricFilter', {
      LogGroupName: Match.objectLike({ Ref: Match.stringLikeRegexp('GetInvoicePdfLogGroup') }),
      FilterPattern: Match.stringLikeRegexp('Get invoice PDF failed'),
    });
    // And the function logs into that group.
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'merch-os-billing-getinvoicepdf-dev',
      LoggingConfig: Match.objectLike({ LogGroup: Match.objectLike({ Ref: Match.stringLikeRegexp('GetInvoicePdfLogGroup') }) }),
    });
  });

  it('raises an alarm when invoices cannot be issued', () => {
    synth().hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: 'merch-os-billing-InvoiceIssueFailed-dev',
      Namespace: 'MerchOS/Billing/dev',
      MetricName: 'InvoiceIssueFailed',
    });
  });
});
