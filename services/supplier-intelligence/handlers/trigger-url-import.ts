/**
 * Trigger URL Import Lambda handler for POST /suppliers/{supplierId}/imports/url.
 *
 * Accepts a URL and crawl configuration, stores the URL configuration in S3 at
 * `suppliers/{tenantId}/{supplierId}/url-configs/{importJobId}.json`, creates an
 * ImportJob record in DynamoDB with status QUEUED and source type URL,
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

import { triggerUrlImportSchema } from '../schemas/import.schema';
import type { ImportJob, ImportJobStatus, SourceType } from '../types';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TriggerUrlImportEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: {
    url: string;
    crawlDepth: number;
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
 * 2. Store URL crawl configuration in S3 at suppliers/{tenantId}/{supplierId}/url-configs/{importJobId}.json
 * 3. Create ImportJob record in DynamoDB with status QUEUED and sourceType URL
 * 4. Send SQS message to FIFO queue with MessageGroupId=tenantId
 * 5. Return 202 Accepted with importJobId
 */
async function baseHandler(event: TriggerUrlImportEvent): Promise<APIGatewayProxyResultV2> {
  const { url, crawlDepth } = event.body;
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
  const sourceType: SourceType = 'URL';
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 365 days

  // Store URL config as a JSON file in S3
  const s3Key = `suppliers/${tenantId}/${supplierId}/url-configs/${importJobId}.json`;

  logger.info('Triggering URL import', {
    tenantId,
    supplierId,
    importJobId,
    url,
    crawlDepth,
    s3Key,
  });

  try {
    // Step 1: Store URL crawl configuration in S3
    const crawlConfig = {
      url,
      crawlDepth,
      importJobId,
      tenantId,
      supplierId,
      createdAt: now,
    };

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: rawUploadsBucket,
        Key: s3Key,
        ContentType: 'application/json',
        Body: JSON.stringify(crawlConfig),
        Metadata: {
          tenantId,
          supplierId,
          importJobId,
          sourceUrl: url,
        },
      }),
    );

    logger.info('URL config stored in S3', { s3Key, bucket: rawUploadsBucket });

    // Step 2: Create ImportJob record in DynamoDB with status QUEUED
    const importJob: ImportJob = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: url,
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
          sourceReference: url,
          url,
          crawlDepth,
          configS3Key: s3Key,
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
        sourceReference: url,
      }),
    };
  } catch (error) {
    logger.error('Failed to trigger URL import', {
      error: error instanceof Error ? error.message : String(error),
      importJobId,
      tenantId,
      supplierId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'IMPORT_TRIGGER_FAILED', message: 'Failed to initiate URL import' },
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
      schema: triggerUrlImportSchema,
      source: 'body',
    }),
  );
