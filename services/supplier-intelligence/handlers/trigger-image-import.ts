/**
 * Trigger Image Import Lambda handler for POST /suppliers/{supplierId}/imports/images.
 *
 * Accepts image batch metadata, stores image references in S3 at
 * `suppliers/{tenantId}/{supplierId}/images/{fileName}`, creates an ImportJob
 * record in DynamoDB with status QUEUED and source type IMAGE_BATCH,
 * and sends an SQS message to the FIFO queue with MessageGroupId=tenantId
 * for per-tenant ordering.
 *
 * Returns 202 Accepted with the importJobId.
 *
 * Requirements: 3.1, 4.1, 5.1
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import { triggerImageImportSchema } from '../schemas/import.schema';
import type { ImportJob, ImportJobStatus, SourceType } from '../types';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

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

const region = process.env['AWS_REGION'] ?? 'af-south-1';

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

let sqsClient: SQSClient | null = null;
function getSqsClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({ region });
  }
  return sqsClient;
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
  const importQueueUrl = process.env['IMPORT_QUEUE_URL'];

  if (!importJobsTable || !rawUploadsBucket || !importQueueUrl) {
    logger.error('Missing required environment variables', {
      hasImportJobsTable: !!importJobsTable,
      hasRawUploadsBucket: !!rawUploadsBucket,
      hasImportQueueUrl: !!importQueueUrl,
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
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 365 days

  // Store images under a common prefix for this import job
  const s3Prefix = `suppliers/${tenantId}/${supplierId}/images/${importJobId}`;

  logger.info('Triggering image import', {
    tenantId,
    supplierId,
    importJobId,
    imageCount: images.length,
    s3Prefix,
  });

  try {
    // Step 1: Store each image reference in S3
    for (const image of images) {
      const s3Key = `${s3Prefix}/${image.fileName}`;

      await getS3Client().send(
        new PutObjectCommand({
          Bucket: rawUploadsBucket,
          Key: s3Key,
          ContentType: image.contentType,
          Body: Buffer.alloc(0), // Placeholder — actual binary uploaded via pre-signed URL
          Metadata: {
            tenantId,
            supplierId,
            importJobId,
            originalFileName: image.fileName,
          },
        }),
      );
    }

    logger.info('Image references stored in S3', {
      s3Prefix,
      bucket: rawUploadsBucket,
      imageCount: images.length,
    });

    // Step 2: Create ImportJob record in DynamoDB with status QUEUED
    const importJob: ImportJob = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: s3Prefix,
      status: 'QUEUED' as ImportJobStatus,
      errors: [],
      createdAt: now,
      ttl,
    };

    await getDynamoDocClient().send(
      new PutCommand({
        TableName: importJobsTable,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `IMPORT#${importJobId}`,
          GSI1PK: `TENANT#${tenantId}#SUPPLIER#${supplierId}`,
          GSI1SK: `IMPORT#CREATED#${now}`,
          GSI2PK: `TENANT#${tenantId}#STATUS#QUEUED`,
          GSI2SK: `IMPORT#CREATED#${now}`,
          ...importJob,
        },
      }),
    );

    logger.info('ImportJob record created in DynamoDB', { importJobId, status: 'QUEUED' });

    // Step 3: Send SQS message to FIFO queue with MessageGroupId=tenantId
    const messageDeduplicationId = importJobId; // UUID guarantees uniqueness
    await getSqsClient().send(
      new SendMessageCommand({
        QueueUrl: importQueueUrl,
        MessageGroupId: tenantId,
        MessageDeduplicationId: messageDeduplicationId,
        MessageBody: JSON.stringify({
          importJobId,
          tenantId,
          supplierId,
          sourceType,
          sourceReference: s3Prefix,
          images: images.map((img) => ({
            fileName: img.fileName,
            contentType: img.contentType,
            fileSizeBytes: img.fileSizeBytes,
            s3Key: `${s3Prefix}/${img.fileName}`,
          })),
        }),
      }),
    );

    logger.info('SQS message sent to import queue', {
      importJobId,
      messageGroupId: tenantId,
    });

    // Step 4: Return 202 Accepted with importJobId
    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        importJobId,
        status: 'QUEUED',
        sourceReference: s3Prefix,
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
      resource: 'supplier',
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
