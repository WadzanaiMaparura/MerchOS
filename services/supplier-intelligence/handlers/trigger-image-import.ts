/**
 * Trigger Image Import Lambda handler for POST /suppliers/{supplierId}/imports/images.
 *
 * Stages an image import: validates up to 50 declared images, creates the
 * ImportJob as AWAITING_UPLOAD and returns one presigned S3 PUT URL per image. The
 * browser uploads them directly, then calls POST /imports/{importJobId}/start,
 * which verifies every upload and queues the import (see utils/upload-staging.ts).
 *
 * Returns 201 with { importJobId, uploads: [...], startUrl }.
 *
 * Requirements: 3.1, 4.1, 5.1
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

import { triggerImageImportSchema } from '../schemas/import.schema';
import type { ImportJob, ImportJobStatus, SourceType } from '../types';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import { presignUpload, sanitizeFileName, type PendingUpload } from '../utils/upload-staging';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageEntry {
  fileName: string;
  contentType: string;
  fileSizeBytes: number;
}

interface TriggerImageImportEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: {
    images: ImageEntry[];
  };
  pathParameters: {
    supplierId: string;
  };
}

// ---------------------------------------------------------------------------
// AWS SDK Clients (singleton for connection reuse across invocations)
// ---------------------------------------------------------------------------

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

let ddbDocClient: DynamoDBDocumentClient | null = null;
function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({ region });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts tenantId from the authorizer context attached by the tenant middleware.
 */
function extractTenantId(event: Record<string, unknown>): string | undefined {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantContext = authorizer?.['tenantContext'] as Record<string, unknown> | undefined;
  return tenantContext?.['tenantId'] as string | undefined;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic:
 * 1. Extract tenantId and supplierId from context and path
 * 2. Upload image metadata/references to S3 at suppliers/{tenantId}/{supplierId}/images/{fileName}
 * 3. Create ImportJob record in DynamoDB with status QUEUED and sourceType IMAGE
 * 4. Send SQS message to FIFO queue with MessageGroupId=tenantId
 * 5. Return 202 Accepted with importJobId
 */
async function baseHandler(event: TriggerImageImportEvent): Promise<APIGatewayProxyResultV2> {
  const { images } = event.body;
  const { supplierId } = event.pathParameters;

  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);

  if (!tenantId) {
    logger.error('Missing tenantId in handler context');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
      }),
    };
  }

  // Validate environment variables
  const importJobsTable = process.env['IMPORT_JOBS_TABLE'];
  const rawUploadsBucket = process.env['RAW_UPLOADS_BUCKET'];
  if (!importJobsTable || !rawUploadsBucket) {
    logger.error('Missing required environment variables', {
      hasImportJobsTable: !!importJobsTable,
      hasRawUploadsBucket: !!rawUploadsBucket,
    });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  const importJobId = crypto.randomUUID();
  const sourceType: SourceType = 'IMAGE';
  const now = new Date();
  const nowIso = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60; // 365 days

  // All images for this job share one prefix. Each key is prefixed with the image's
  // position, so two files with the same name can never overwrite each other.
  const s3Prefix = `suppliers/${tenantId}/${supplierId}/images/${importJobId}`;

  logger.info('Staging image import (awaiting browser upload)', {
    tenantId,
    supplierId,
    importJobId,
    imageCount: images.length,
  });

  try {
    const pendingUploads: PendingUpload[] = images.map((image, index) => ({
      key: `${s3Prefix}/${String(index + 1).padStart(3, '0')}-${sanitizeFileName(image.fileName)}`,
      contentType: image.contentType,
      sizeBytes: image.fileSizeBytes,
      originalFileName: image.fileName,
    }));

    // The exact message the queue consumer expects, sent by POST /imports/{id}/start.
    const queueMessage = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: s3Prefix,
      images: pendingUploads.map((u) => ({
        fileName: u.key.slice(s3Prefix.length + 1),
        contentType: u.contentType,
        fileSizeBytes: u.sizeBytes,
        s3Key: u.key,
      })),
    };

    const importJob: ImportJob = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: s3Prefix,
      status: 'AWAITING_UPLOAD' as ImportJobStatus,
      errors: [],
      createdAt: nowIso,
      ttl,
      pendingUploads,
      queueMessage,
    };

    await getDynamoDocClient().send(
      new PutCommand({
        TableName: importJobsTable,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `IMPORT#${importJobId}`,
          GSI1PK: `TENANT#${tenantId}#SUPPLIER#${supplierId}`,
          GSI1SK: `IMPORT#CREATED#${nowIso}`,
          GSI2PK: `TENANT#${tenantId}#STATUS#AWAITING_UPLOAD`,
          GSI2SK: `IMPORT#CREATED#${nowIso}`,
          ...importJob,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );

    const s3 = getS3Client();
    const uploads = await Promise.all(
      pendingUploads.map((u) =>
        presignUpload(s3, rawUploadsBucket, u, {
          tenantid: tenantId,
          supplierid: supplierId,
          importjobid: importJobId,
        }, now),
      ),
    );

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        importJobId,
        status: 'AWAITING_UPLOAD',
        uploads,
        startUrl: `/imports/${importJobId}/start`,
      }),
    };
  } catch (error) {
    logger.error('Failed to trigger image import', {
      error: error instanceof Error ? error.message : String(error),
      importJobId,
      tenantId,
      supplierId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'IMPORT_TRIGGER_FAILED', message: 'Failed to initiate image import' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler)
  .use(tenantContextMiddleware())
  .use(
    rbacMiddleware({
      resource: 'suppliers',
      action: 'create',
    }),
  )
  .use(
    rateLimitMiddleware({
      maxRequests: 10,
      windowSeconds: 60,
    }),
  )
  .use(
    inputValidationMiddleware({
      schema: triggerImageImportSchema,
      source: 'body',
    }),
  );
