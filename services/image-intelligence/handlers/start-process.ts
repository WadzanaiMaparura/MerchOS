/**
 * Start Process Lambda handler for POST /v1/images/{productId}/process.
 *
 * Creates an Image_Job (status QUEUED) for the given product's already-uploaded
 * source images and returns 202 Accepted with the imageJobId. In Phase 1 the
 * job is recorded only; the Step Functions workflow that moderates, builds the
 * hero image, and packages variants is wired in Phase 2.
 *
 * Requirements: 1.6, 1.7, 7.1, 8.1, 8.5
 */

import middy from '@middy/core';
import crypto from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

import { startProcessRequestSchema, type StartProcessRequest } from '../schemas/image.schema';
import { extractTenantId } from '../utils/extract-tenant';
import type { ImageJob } from '../types/image.types';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';
const TTL_SECONDS = 365 * 24 * 60 * 60;

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

/** Allow test code to inject a mock DynamoDB document client. */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

let sfnClient: SFNClient | null = null;
function getSfnClient(): SFNClient {
  if (!sfnClient) {
    sfnClient = new SFNClient({ region });
  }
  return sfnClient;
}

/** Allow test code to inject a mock Step Functions client. */
export function setSfnClient(client: SFNClient): void {
  sfnClient = client;
}

interface StartProcessEvent extends Omit<APIGatewayProxyEventV2, 'body'> {
  body: StartProcessRequest;
  pathParameters: { productId?: string };
}

async function baseHandler(event: StartProcessEvent): Promise<APIGatewayProxyResultV2> {
  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);
  if (!tenantId) {
    logger.error('Missing tenant context — tenantContextMiddleware may not have run');
    return jsonError(401, 'MISSING_TENANT', 'Tenant context required');
  }

  const productId = event.pathParameters?.productId;
  if (!productId) {
    return jsonError(400, 'VALIDATION_ERROR', 'productId path parameter is required');
  }

  const imageJobsTable = process.env['IMAGE_JOBS_TABLE'];
  const stateMachineArn = process.env['IMAGE_STATE_MACHINE_ARN'];
  const rawUploadsBucket = process.env['RAW_UPLOADS_BUCKET'];
  const assetsBucket = process.env['ASSETS_BUCKET'];
  if (!imageJobsTable || !stateMachineArn || !rawUploadsBucket || !assetsBucket) {
    logger.error('Missing required environment variables for start-process');
    return jsonError(500, 'INTERNAL_ERROR', 'Service misconfigured');
  }

  const { sourceKeys } = event.body;

  // Defense in depth: every source key must sit under this tenant+product prefix,
  // so a client cannot point processing at another tenant's objects.
  const expectedPrefix = `images/${tenantId}/${productId}/`;
  const invalidKey = sourceKeys.find((k) => !k.startsWith(expectedPrefix));
  if (invalidKey) {
    logger.warn('Rejected start-process with out-of-scope source key', { invalidKey });
    return jsonError(403, 'TENANT_ISOLATION_VIOLATION', 'Source key outside tenant/product scope');
  }

  const imageJobId = crypto.randomUUID();
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + TTL_SECONDS;

  logger.appendKeys({ tenantId, productId, imageJobId });

  const job: ImageJob = {
    imageJobId,
    tenantId,
    productId,
    sourceMode: 'UPLOAD',
    status: 'QUEUED',
    sourceKeys,
    variants: [],
    reviewRecommended: false,
    createdAt: now,
    updatedAt: now,
    ttl,
  };

  try {
    await getDynamoDocClient().send(
      new PutCommand({
        TableName: imageJobsTable,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: `IMAGEJOB#${imageJobId}`,
          GSI1PK: `TENANT#${tenantId}#PRODUCT#${productId}`,
          GSI1SK: `IMAGEJOB#CREATED#${now}`,
          ...job,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );

    logger.info('Image_Job created', { status: 'QUEUED', sourceCount: sourceKeys.length });

    // Start the ImageProcessingWorkflow. The workflow input carries the buckets
    // so task Lambdas don't each re-resolve them.
    await getSfnClient().send(
      new StartExecutionCommand({
        stateMachineArn,
        name: imageJobId,
        input: JSON.stringify({
          tenantId,
          productId,
          imageJobId,
          sourceKeys,
          rawUploadsBucket,
          assetsBucket,
        }),
      }),
    );

    logger.info('ImageProcessingWorkflow started', { imageJobId });

    return {
      statusCode: 202,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageJobId, status: 'QUEUED' }),
    };
  } catch (error) {
    logger.error('Failed to create Image_Job', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(500, 'IMAGE_JOB_CREATE_FAILED', 'Failed to start image processing');
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
  .use(inputValidationMiddleware({ schema: startProcessRequestSchema, source: 'body' }));
