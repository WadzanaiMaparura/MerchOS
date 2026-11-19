/**
 * POST /imports/{importJobId}/start
 *
 * Second half of the direct-to-S3 upload flow (see utils/upload-staging.ts). The
 * browser calls this after uploading. It:
 *   1. loads the job (scoped to the caller's tenant: another tenant's id is a 404),
 *   2. confirms every expected upload exists in S3 with the declared size and type,
 *   3. moves the job AWAITING_UPLOAD -> QUEUED (conditional write: only ONE caller
 *      can win, so a double-click or retry can never queue the import twice),
 *   4. sends the import-queue message prepared when the job was created.
 *
 * Idempotent: calling it again for a job that already started just reports its
 * current status. If the queue send fails after the status moved, the status is
 * put back so the seller can retry rather than leaving a job that never runs.
 */
import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import type { ImportJob } from '../types';
import { verifyUploads } from '../utils/upload-staging';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

let ddb: DynamoDBDocumentClient | undefined;
let s3: S3Client | undefined;
let sqs: SQSClient | undefined;
const getDdb = () =>
  (ddb ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true },
  }));
const getS3 = () => (s3 ??= new S3Client({ region }));
const getSqs = () => (sqs ??= new SQSClient({ region }));

/** Test seam. */
export function setClients(c: { ddb?: DynamoDBDocumentClient; s3?: S3Client; sqs?: SQSClient }): void {
  if (c.ddb) ddb = c.ddb;
  if (c.s3) s3 = c.s3;
  if (c.sqs) sqs = c.sqs;
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,100}$/;

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
const fail = (statusCode: number, code: string, message: string) => json(statusCode, { error: { code, message } });

function extractTenantId(event: Record<string, unknown>): string | undefined {
  const rc = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = rc?.['authorizer'] as Record<string, unknown> | undefined;
  const ctx = authorizer?.['tenantContext'] as Record<string, unknown> | undefined;
  return ctx?.['tenantId'] as string | undefined;
}

const isConditionalFailure = (e: unknown) => (e as { name?: string }).name === 'ConditionalCheckFailedException';

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);
  if (!tenantId) return fail(401, 'MISSING_TENANT', 'Tenant context required');

  const importJobId = event.pathParameters?.['importJobId'];
  if (!importJobId || !ID_PATTERN.test(importJobId)) {
    return fail(400, 'VALIDATION_ERROR', 'Invalid import job id');
  }

  const table = process.env['IMPORT_JOBS_TABLE'];
  const bucket = process.env['RAW_UPLOADS_BUCKET'];
  const queueUrl = process.env['IMPORT_QUEUE_URL'];
  if (!table || !bucket || !queueUrl) {
    logger.error('Missing required environment variables');
    return fail(500, 'INTERNAL_ERROR', 'Service misconfigured');
  }

  const key = { PK: `TENANT#${tenantId}`, SK: `IMPORT#${importJobId}` };

  try {
    const res = await getDdb().send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }));
    const job = res.Item as (ImportJob & Record<string, unknown>) | undefined;
    if (!job) return fail(404, 'NOT_FOUND', 'Import job not found');

    // Already started (or a URL import, which never waits): report, do nothing.
    if (job.status !== 'AWAITING_UPLOAD') {
      return json(200, { importJobId, status: job.status, alreadyStarted: true });
    }

    const uploads = job.pendingUploads ?? [];
    if (uploads.length === 0 || !job.queueMessage) {
      logger.error('AWAITING_UPLOAD job has no pending uploads/message', { importJobId });
      return fail(500, 'INTERNAL_ERROR', 'Import job is incomplete');
    }

    const check = await verifyUploads(getS3(), bucket, uploads);
    if (!check.ok) {
      const messages = {
        missing: 'The file has not finished uploading. Please upload it and try again.',
        size_mismatch: 'The uploaded file does not match the size that was declared. Please upload it again.',
        type_mismatch: 'The uploaded file is not the type that was declared. Please upload it again.',
      } as const;
      logger.info('Import start refused: upload not verified', { importJobId, reason: check.reason });
      return fail(409, 'UPLOAD_INCOMPLETE', messages[check.reason]);
    }

    // Claim the start. Only one concurrent caller can succeed.
    const now = new Date().toISOString();
    try {
      await getDdb().send(
        new UpdateCommand({
          TableName: table,
          Key: key,
          UpdateExpression: 'SET #status = :queued, #gsi2 = :gsi2, #updatedAt = :now REMOVE #pending',
          ConditionExpression: '#status = :awaiting',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#gsi2': 'GSI2PK',
            '#updatedAt': 'updatedAt',
            '#pending': 'pendingUploads',
          },
          ExpressionAttributeValues: {
            ':queued': 'QUEUED',
            ':awaiting': 'AWAITING_UPLOAD',
            ':gsi2': `TENANT#${tenantId}#STATUS#QUEUED`,
            ':now': now,
          },
        })
      );
    } catch (error) {
      if (isConditionalFailure(error)) {
        // Someone else started it between our read and our write.
        return json(200, { importJobId, status: 'QUEUED', alreadyStarted: true });
      }
      throw error;
    }

    try {
      await getSqs().send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageGroupId: tenantId,
          MessageDeduplicationId: importJobId,
          MessageBody: JSON.stringify(job.queueMessage),
        })
      );
    } catch (error) {
      // Put the job back so it is not stuck as QUEUED with no message to process it.
      await getDdb()
        .send(
          new UpdateCommand({
            TableName: table,
            Key: key,
            UpdateExpression: 'SET #status = :awaiting, #gsi2 = :gsi2, #pending = :pending',
            ConditionExpression: '#status = :queued',
            ExpressionAttributeNames: { '#status': 'status', '#gsi2': 'GSI2PK', '#pending': 'pendingUploads' },
            ExpressionAttributeValues: {
              ':awaiting': 'AWAITING_UPLOAD',
              ':queued': 'QUEUED',
              ':gsi2': `TENANT#${tenantId}#STATUS#AWAITING_UPLOAD`,
              ':pending': uploads,
            },
          })
        )
        .catch((revertError) =>
          logger.error('Could not revert import job after queue failure', {
            importJobId,
            error: revertError instanceof Error ? revertError.message : String(revertError),
          })
        );
      throw error;
    }

    logger.info('Import started', { importJobId, tenantId, uploads: uploads.length });
    return json(202, { importJobId, status: 'QUEUED' });
  } catch (error) {
    logger.error('Failed to start import', {
      importJobId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fail(500, 'IMPORT_START_FAILED', 'Could not start the import. Please try again.');
  }
}

export const handler = middy(baseHandler)
  .use(tenantContextMiddleware())
  .use(rbacMiddleware({ resource: 'suppliers', action: 'create' }))
  .use(rateLimitMiddleware({ maxRequests: 30, windowSeconds: 60 }));
