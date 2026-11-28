/**
 * Product images are SSE-KMS encrypted in the private assets bucket and served
 * only through the image CDN (signed URLs). CloudFront needs Origin Access
 * Control plus read + decrypt grants, scoped to this account's distributions.
 */
import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { FoundationStack } from '../lib/foundation-stack';
import { ImageIntelligenceStack } from '../lib/image-intelligence-stack';

const envProps = { account: '123456789012', region: 'eu-west-1' };
const OWN = 'arn:aws:cloudfront::123456789012:distribution/*';

type Statement = { Sid?: string; Effect: string; Principal?: unknown; Action: string | string[]; Resource: unknown; Condition?: unknown };

describe('image CDN access (Foundation grants)', () => {
  const t = Template.fromStack(new FoundationStack(new cdk.App(), 'F', { env: envProps, environment: 'dev' }));

  it('lets CloudFront read only images/* in the assets bucket, only for our own distributions', () => {
    const policies = Object.values(t.findResources('AWS::S3::BucketPolicy')) as Array<{ Properties: { Bucket: unknown; PolicyDocument: { Statement: Statement[] } } }>;
    const grants = policies.flatMap((p) => p.Properties.PolicyDocument.Statement).filter((s) => s.Sid === 'CloudFrontReadImages');
    expect(grants).toHaveLength(1);
    const g = grants[0]!;
    expect(g.Effect).toBe('Allow');
    expect(g.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(g.Action).toBe('s3:GetObject');
    expect(JSON.stringify(g.Resource)).toContain('/images/*');
    expect(g.Condition).toEqual({ StringLike: { 'AWS:SourceArn': OWN } });
    // Only on the assets bucket.
    const owner = policies.find((p) => p.Properties.PolicyDocument.Statement.some((s) => s.Sid === 'CloudFrontReadImages'))!;
    expect(JSON.stringify(owner.Properties.Bucket)).toContain('AssetsBucket');
  });

  it('lets CloudFront decrypt with the platform key, only for our own distributions, and nothing else', () => {
    const keys = t.findResources('AWS::KMS::Key') as Record<string, { Properties: { KeyPolicy: { Statement: Statement[] } } }>;
    const withGrant = Object.entries(keys).filter(([, k]) => k.Properties.KeyPolicy.Statement.some((s) => s.Sid === 'CloudFrontDecryptImages'));
    expect(withGrant.map(([id]) => id)).toEqual([expect.stringMatching(/^PlatformKey/)]);
    const g = withGrant[0]![1].Properties.KeyPolicy.Statement.find((s) => s.Sid === 'CloudFrontDecryptImages')!;
    expect(g.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(g.Action).toBe('kms:Decrypt');
    expect(g.Condition).toEqual({ StringLike: { 'AWS:SourceArn': OWN } });
  });
});

describe('image CDN origin', () => {
  const t = Template.fromStack(
    new ImageIntelligenceStack(new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } }), 'I', { env: envProps, environment: 'dev' })
  );

  it('uses Origin Access Control (no Origin Access Identity) and still requires signed URLs', () => {
    t.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    t.resourceCountIs('AWS::CloudFront::CloudFrontOriginAccessIdentity', 0);
    t.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
      OriginAccessControlConfig: { OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' },
    });
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: { DistributionConfig: { DefaultCacheBehavior: { TrustedKeyGroups?: unknown[] }; Origins: Array<{ OriginAccessControlId?: unknown; S3OriginConfig?: { OriginAccessIdentity?: string } }> } };
    };
    expect(dist.Properties.DistributionConfig.DefaultCacheBehavior.TrustedKeyGroups).toHaveLength(1);
    const origin = dist.Properties.DistributionConfig.Origins[0]!;
    expect(origin.OriginAccessControlId).toBeDefined();
    expect(origin.S3OriginConfig?.OriginAccessIdentity ?? '').toBe('');
  });
});
