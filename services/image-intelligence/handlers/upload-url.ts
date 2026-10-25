/**
 * Upload URL Lambda handler for POST /v1/images/upload.
 *
 * Validates the declared image (format + 10 MB cap), then returns a short-lived
 * presigned S3 PUT URL into the raw-uploads bucket under a tenant-scoped key
 * `images/{tenantId}/{productId}/source/{imageId}.{ext}`. The browser uploads
 * the binary directly to S3; the engine never proxies image bytes.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 8.1
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { uploadUrlRequestSchema, type UploadUrlRequest } from '../schemas/image.schema';
import { extractTenantId } from '../utils/extract-tenant';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

/** Presigned PUT URL validity (seconds). */
const PRESIGN_TTL_SECONDS = 300;

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

/** Allow test code to inject a mock S3 client. */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

const EXTENSION_BY_CONTENT_TYPE: Record<UploadUrlRequest['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

interface UploadUrlEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: UploadUrlRequest;
}

async function baseHandler(event: UploadUrlEvent): Promise<APIGatewayProxyResultV2> {
  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);
  if (!tenantId) {
    logger.error('Missing tenant context — tenantContextMiddleware may not have run');
    return jsonError(401, 'MISSING_TENANT', 'Tenant context required');
  }

  const rawUploadsBucket = process.env['RAW_UPLOADS_BUCKET'];
  if (!rawUploadsBucket) {
    logger.error('RAW_UPLOADS_BUCKET environment variable is not set');
    return jsonError(500, 'INTERNAL_ERROR', 'Service misconfigured');
  }

  const { productId, contentType, fileSizeBytes } = event.body;
  const imageId = crypto.randomUUID();
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
  const s3Key = `images/${tenantId}/${productId}/source/${imageId}.${extension}`;

  logger.appendKeys({ tenantId, productId, imageId });

  try {
    const presignedUrl = await getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: rawUploadsBucket,
        Key: s3Key,
        ContentType: contentType,
        ContentLength: fileSizeBytes,
        Metadata: { tenantId, productId, imageId },
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );

    logger.info('Issued presigned upload URL', { s3Key, ttlSeconds: PRESIGN_TTL_SECONDS });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageId,
        s3Key,
        uploadUrl: presignedUrl,
        expiresInSeconds: PRESIGN_TTL_SECONDS,
      }),
    };
  } catch (error) {
    logger.error('Failed to issue presigned upload URL', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(500, 'UPLOAD_URL_FAILED', 'Failed to create upload URL');
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
  .use(rbacMiddleware({ resource: 'images', action: 'create' }))
  .use(rateLimitMiddleware({ maxRequests: 30, windowSeconds: 60 }))
  .use(inputValidationMiddleware({ schema: uploadUrlRequestSchema, source: 'body' }));
