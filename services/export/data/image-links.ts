/**
 * Image links for export files. Product images are private (assets bucket,
 * served only through CloudFront with signed URLs). Stores download the images
 * from the links in the file while importing, so the export signs each image
 * for 7 days with the same key pair the dashboard uses. Images imported from a
 * supplier's web address are kept as that address.
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getSignedUrl } from '@aws-sdk/cloudfront-signer';

/** How long image links in an export file work. */
export const IMAGE_LINK_DAYS = 7;

export interface ImageLinkConfig {
  /** CloudFront distribution domain (d123.cloudfront.net). */
  domain: string;
  keyPairId: string;
  /** PEM private key. */
  privateKey: string;
  /** Link expiry. */
  expiresAt: Date;
}

/** Public path for an object key: each segment URL-encoded. */
export function objectUrl(domain: string, s3Key: string): string {
  const path = s3Key.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return `https://${domain}/${path}`;
}

/** Returns a function that turns an image s3Key into a downloadable link. */
export function imageLinker(config: ImageLinkConfig): (s3Key: string) => string {
  const dateLessThan = config.expiresAt.toISOString();
  return (s3Key: string) => {
    if (/^https?:\/\//i.test(s3Key)) return s3Key;
    return getSignedUrl({
      url: objectUrl(config.domain, s3Key),
      keyPairId: config.keyPairId,
      privateKey: config.privateKey,
      dateLessThan,
    });
  };
}

let cachedKey: { secretId: string; pem: string } | null = null;

/** Loads the signing key from Secrets Manager once per container. */
export async function loadSigningKey(secretId: string, client = new SecretsManagerClient({})): Promise<string> {
  if (cachedKey?.secretId === secretId) return cachedKey.pem;
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const pem = res.SecretString?.trim();
  if (!pem || !pem.includes('PRIVATE KEY')) throw new Error('Image signing key secret is empty or not a PEM key');
  cachedKey = { secretId, pem };
  return pem;
}
