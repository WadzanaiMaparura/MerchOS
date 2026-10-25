/**
 * Get Image Job Lambda handler for GET /v1/images/{imageJobId}.
 *
 * Returns the Image_Job status and (once processed) its per-channel variant
 * keys/metadata, scoped to the authenticated tenant.
 *
 * Requirements: 1.7, 7.1, 8.1
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { extractTenantId } from '../utils/extract-tenant';
import type { ImageJob } from '../types/image.types';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

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

/** Allow test code to inject a mock DynamoDB document client. */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

interface GetImageEvent extends APIGatewayProxyEventV2 {
  pathParameters: { imageJobId?: string };
}

async function baseHandler(event: GetImageEvent): Promise<APIGatewayProxyResultV2> {
  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);
  if (!tenantId) {
    return jsonError(401, 'MISSING_TENANT', 'Tenant context required');
  }

  const imageJobId = event.pathParameters?.imageJobId;
  if (!imageJobId) {
    return jsonError(400, 'VALIDATION_ERROR', 'imageJobId path parameter is required');
  }

  const imageJobsTable = process.env['IMAGE_JOBS_TABLE'];
  if (!imageJobsTable) {
    logger.error('IMAGE_JOBS_TABLE environment variable is not set');
    return jsonError(500, 'INTERNAL_ERROR', 'Service misconfigured');
  }

  try {
    const result = await getDynamoDocClient().send(
      new GetCommand({
        TableName: imageJobsTable,
        // Key is tenant-scoped: a seller can never read another tenant's job.
        Key: { PK: `TENANT#${tenantId}`, SK: `IMAGEJOB#${imageJobId}` },
      }),
    );

    if (!result.Item) {
      return jsonError(404, 'NOT_FOUND', 'Image job not found');
    }

    const job = result.Item as unknown as ImageJob;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageJobId: job.imageJobId,
        productId: job.productId,
        status: job.status,
        variants: job.variants,
        moderation: job.moderation,
        enhancement: job.enhancement,
        reviewRecommended: job.reviewRecommended,
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }),
    };
  } catch (error) {
    logger.error('Failed to get Image_Job', {
      error: error instanceof Error ? error.message : String(error),
      imageJobId,
    });
    return jsonError(500, 'IMAGE_JOB_GET_FAILED', 'Failed to retrieve image job');
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
  .use(rateLimitMiddleware({ maxRequests: 60, windowSeconds: 60 }));
