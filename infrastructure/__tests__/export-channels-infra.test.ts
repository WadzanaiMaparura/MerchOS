import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { ExportApiStack } from '../lib/export-api-stack';
import { FoundationStack } from '../lib/foundation-stack';

const envProps = { account: '123456789012', region: 'eu-west-1' };

function exportStack(): Template {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const deps = new cdk.Stack(app, 'Deps', { env: envProps });
  const userPool = new cognito.UserPool(deps, 'Pool');
  return Template.fromStack(
    new ExportApiStack(app, 'ExportApi', {
      env: envProps,
      environment: 'dev',
      userPool,
      sellerDashboardClient: userPool.addClient('Seller'),
      platformKey: new kms.Key(deps, 'Key'),
    })
  );
}

type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };
type Fn = { Properties: { FunctionName?: string; MemorySize?: number; Timeout?: number; Role?: unknown; Environment?: { Variables?: Record<string, unknown> } } };

function roleStatements(t: Template, roleLogicalPrefix: string): Statement[] {
  const out: Statement[] = [];
  for (const [id, p] of Object.entries(t.findResources('AWS::IAM::Policy')) as Array<[string, { Properties: { PolicyDocument: { Statement: Statement[] }; Roles: unknown } }]>) {
    if (JSON.stringify(p.Properties.Roles).includes(roleLogicalPrefix) || id.startsWith(roleLogicalPrefix)) out.push(...p.Properties.PolicyDocument.Statement);
  }
  return out;
}
const actions = (s: Statement[]) => s.flatMap((x) => ([] as string[]).concat(x.Action));

describe('store exports (infrastructure)', () => {
  const t = exportStack();

  it('adds the six /exports routes behind the seller sign-in', () => {
    const routes = Object.values(t.findResources('AWS::ApiGatewayV2::Route')) as Array<{ Properties: { RouteKey: string; AuthorizationType: string } }>;
    const keys = routes.map((r) => r.Properties.RouteKey).sort();
    expect(keys).toEqual(
      [
        'GET /exports',
        'GET /exports/shopify-categories',
        'GET /exports/{exportId}/download',
        'POST /export',
        'POST /exports',
        'POST /exports/check',
        'POST /validate',
        'PUT /exports/products/{productId}/category',
      ].sort()
    );
    for (const r of routes) expect(r.Properties.AuthorizationType).toBe('JWT');
  });

  it('has its own function with room for 500 products', () => {
    const fn = (Object.values(t.findResources('AWS::Lambda::Function')) as Fn[]).find((f) => f.Properties.FunctionName === 'merch-os-export-channelexports-dev')!;
    expect(fn.Properties.MemorySize).toBe(1024);
    expect(fn.Properties.Timeout).toBe(29);
    expect(Object.keys(fn.Properties.Environment!.Variables!)).toEqual(
      expect.arrayContaining(['PRODUCTS_TABLE', 'INVENTORY_TABLE', 'EXPORTS_BUCKET', 'CLOUDFRONT_DOMAIN', 'CLOUDFRONT_KEY_PAIR_ID', 'CLOUDFRONT_PRIVATE_KEY_SECRET_ID'])
    );
  });

  it('may only read/update products (never scan, put or delete), query inventory, and list its own export prefix', () => {
    const s = roleStatements(t, 'ChannelExportsRole');
    const a = actions(s);
    for (const forbidden of ['dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem', 's3:DeleteObject', '*']) {
      expect(a, forbidden).not.toContain(forbidden);
    }
    const products = s.find((x) => actions([x]).includes('dynamodb:UpdateItem'))!;
    expect(JSON.stringify(products.Resource)).toContain('table/merch-os-products-dev');
    expect(JSON.stringify(products.Resource)).not.toContain('index');
    const inventory = s.find((x) => actions([x]).includes('dynamodb:Query'))!;
    expect(JSON.stringify(inventory.Resource)).toContain('table/merch-os-inventory-dev');
    const list = s.find((x) => actions([x]).includes('s3:ListBucket'))!;
    expect(list.Condition).toEqual({ StringLike: { 's3:prefix': ['tenants/*/exports/*'] } });
    const objects = s.find((x) => actions([x]).includes('s3:PutObject'))!;
    expect(JSON.stringify(objects.Resource)).toContain('/tenants/*/exports/*');
    expect(a).toContain('secretsmanager:GetSecretValue');
  });

  it('the older /export function gets no new rights', () => {
    const a = actions(roleStatements(t, 'ExportRole'));
    expect(a.filter((x) => x.startsWith('dynamodb:') || x.startsWith('secretsmanager:'))).toEqual([]);
  });
});

describe('exports bucket', () => {
  it('deletes export files after 90 days (they can be made again)', () => {
    const t = Template.fromStack(new FoundationStack(new cdk.App(), 'F', { env: envProps, environment: 'dev' }));
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'merch-os-exports-dev',
      LifecycleConfiguration: {
        Rules: [
          {
            Id: 'DeleteExportsAfter90Days',
            Status: 'Enabled',
            ExpirationInDays: 90,
            NoncurrentVersionExpiration: { NoncurrentDays: 1 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    });
  });
});
