/**
 * Signed URL Lambda handler for GET /v1/images/{imageId}/url/{channel}.
 *
 * Mints a short-lived (1-hour) CloudFront signed URL for a processed image
 * variant. The assets bucket is private (served only via CloudFront OAC); this
 * endpoint is the only way a client obtains a viewable URL.
 *
 * The signing private key is read from AWS Secrets Manager (secret id from
 * config, never hardcoded) so the key can be rotated without a code change
 * (requirement 8 item 8). The key-pair id and CloudFront domain come from env.
 *
 * Requirements: 4.6, 4.7, 8.1
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { getSignedUrl } from '@aws-sdk/cloudfront-signer';

import { extractTenantId } from '../utils/extract-tenant';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

/** Signed URL validity — 1 hour (requirement 4.7). */
const SIGNED_URL_TTL_SECONDS = 3600;

/** Channels a signed URL can be requested for. */
const VALID_CHANNELS = new Set([
  'takealot',
  'amazon',
  'makro',
  'shopify',
  'woocommerce',
  'custom',
]);

let secretsClient: SecretsManagerClient | null = null;
function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({ region });
  }
  return secretsClient;
}

/** Allow test code to inject a mock Secrets Manager client. */
export function setSecretsClient(client: SecretsManagerClient): void {
  secretsClient = client;
}

/** Cache the signing private key across invocations (it rarely changes). */
let cachedPrivateKey: string | null = null;

/** Reset cached private key (used in tests). */
export function resetPrivateKeyCache(): void {
  cachedPrivateKey = null;
}

async function getPrivateKey(secretId: string): Promise<string> {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }
  const res = await getSecretsClient().send(new GetSecretValueCommand({ SecretId: secretId }));
  const key = res.SecretString;
  if (!key) {
    throw new Error('CloudFront signing private key secret is empty');
  }
  cachedPrivateKey = key;
  return key;
}

interface SignedUrlEvent extends APIGatewayProxyEventV2 {
  pathParameters: { imageId?: string; channel?: string };
}

/** Exported for unit testing the handler logic directly (bypassing middleware). */
export async function baseHandler(event: SignedUrlEvent): Promise<APIGatewayProxyResultV2> {
  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);
  if (!tenantId) {
    return jsonError(401, 'MISSING_TENANT', 'Tenant context required');
  }

  const imageId = event.pathParameters?.imageId;
  const channel = event.pathParameters?.channel;
  if (!imageId || !channel) {
    return jsonError(400, 'VALIDATION_ERROR', 'imageId and channel path parameters are required');
  }
  if (!VALID_CHANNELS.has(channel)) {
    return jsonError(400, 'VALIDATION_ERROR', `Unsupported channel: ${channel}`);
  }

  const cfDomain = process.env['CLOUDFRONT_DOMAIN'];
  const keyPairId = process.env['CLOUDFRONT_KEY_PAIR_ID'];
  const secretId = process.env['CLOUDFRONT_PRIVATE_KEY_SECRET_ID'];
  if (!cfDomain || !keyPairId || !secretId) {
    logger.error('Missing CloudFront signing configuration');
    return jsonError(500, 'INTERNAL_ERROR', 'Service misconfigured');
  }

  // The object key is tenant-scoped; a seller can only ever sign URLs for their
  // own tenant's images because the path prefix embeds their tenantId.
  const objectPath = `images/${tenantId}/${imageId}/${channel}`;
  const url = `https://${cfDomain}/${objectPath}`;

  try {
    const privateKey = await getPrivateKey(secretId);
    const dateLessThan = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();

    const signedUrl = getSignedUrl({
      url,
      keyPairId,
      privateKey,
      dateLessThan,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS }),
    };
  } catch (error) {
    logger.error('Failed to mint signed URL', {
      error: error instanceof Error ? error.message : String(error),
      imageId,
      channel,
    });
    return jsonError(500, 'SIGNED_URL_FAILED', 'Failed to create signed URL');
  }
}

function jsonError(statusCode: number, code: string, message: string): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code, message } }),
  };
}

export const handler = middy(baseHandler)
  .use(tenantContextMiddleware())
  .use(rbacMiddleware({ resource: 'images', action: 'read' }))
  .use(rateLimitMiddleware({ maxRequests: 120, windowSeconds: 60 }));
