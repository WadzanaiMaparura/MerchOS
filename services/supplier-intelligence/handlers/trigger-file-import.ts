/**
 * Trigger File Import Lambda handler for POST /suppliers/{supplierId}/imports/file.
 *
 * Stages a file import: validates the declared file (name, type, size), creates
 * the ImportJob as AWAITING_UPLOAD and returns a presigned S3 PUT URL. The browser
 * uploads the file directly to S3, then calls POST /imports/{importJobId}/start,
 * which verifies the upload and queues the import (see utils/upload-staging.ts).
 *
 * Returns 201 with { importJobId, uploads: [{ url, method, headers }], startUrl }.
 *
 * Requirements: 2.5, 5.1, 5.2
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';

import { triggerFileImportSchema } from '../schemas/import.schema';
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

interface TriggerFileImportEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: {
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
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
 * Maps content type to the appropriate SourceType enum value.
 */
function resolveSourceType(contentType: string): SourceType {
  switch (contentType) {
    case 'text/csv':
      return 'FILE_CSV';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'FILE_EXCEL';
    case 'application/pdf':
      return 'FILE_PDF';
    case 'application/zip':
      return 'FILE_ZIP';
    default:
      return 'FILE_CSV';
  }
}

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
 * 2. Upload raw file to S3 at suppliers/{tenantId}/{supplierId}/{filename}
 * 3. Create ImportJob record in DynamoDB with status QUEUED
 * 4. Send SQS message to FIFO queue with MessageGroupId=tenantId
 * 5. Return 202 Accepted with importJobId
 */
async function baseHandler(event: TriggerFileImportEvent): Promise<APIGatewayProxyResultV2> {
  const { fileName, contentType, fileSizeBytes } = event.body;
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
  const safeName = sanitizeFileName(fileName);
  const s3Key = `suppliers/${tenantId}/${supplierId}/files/${importJobId}/${safeName}`;
  const sourceType = resolveSourceType(contentType);
  const now = new Date();
  const nowIso = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + 365 * 24 * 60 * 60; // 365 days

  logger.info('Staging file import (awaiting browser upload)', {
    tenantId,
    supplierId,
    importJobId,
    contentType,
    fileSizeBytes,
  });

  try {
    const pendingUploads: PendingUpload[] = [
      { key: s3Key, contentType, sizeBytes: fileSizeBytes, originalFileName: fileName },
    ];

    // The exact message the queue consumer expects, sent by POST /imports/{id}/start
    // only after the upload is verified. Nothing is queued now.
    const queueMessage = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: s3Key,
      fileName: safeName,
      contentType,
      fileSizeBytes,
    };

    const importJob: ImportJob = {
      importJobId,
      tenantId,
      supplierId,
      sourceType,
      sourceReference: s3Key,
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

    const upload = await presignUpload(getS3Client(), rawUploadsBucket, pendingUploads[0]!, {
      tenantid: tenantId,
      supplierid: supplierId,
      importjobid: importJobId,
    }, now);

    // 201: the job exists but is not running yet; the client uploads, then calls start.
    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        importJobId,
        status: 'AWAITING_UPLOAD',
        uploads: [upload],
        startUrl: `/imports/${importJobId}/start`,
      }),
    };
  } catch (error) {
    logger.error('Failed to trigger file import', {
      error: error instanceof Error ? error.message : String(error),
      importJobId,
      tenantId,
      supplierId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'IMPORT_TRIGGER_FAILED', message: 'Failed to initiate file import' },
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
      schema: triggerFileImportSchema,
      source: 'body',
    }),
  );
