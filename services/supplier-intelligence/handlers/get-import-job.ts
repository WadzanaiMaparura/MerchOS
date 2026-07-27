/**
 * Get Import Job Lambda handler for GET /imports/{importJobId}.
 *
 * Returns a single import job's full details scoped to the authenticated tenant.
 * Queries DynamoDB with PK=TENANT#{tenantId}, SK=IMPORT#{importJobId}.
 *
 * Requirements: 9.2, 10.1
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import type { ImportJob } from '../types';

// ---------------------------------------------------------------------------
// Clients (singletons)
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
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
 * 1. Extract tenantId from tenant context
 * 2. Read importJobId from path parameters
 * 3. Query DynamoDB with PK=TENANT#{tenantId}, SK=IMPORT#{importJobId}
 * 4. Return the import job record or 404
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tableName = process.env['IMPORT_JOBS_TABLE'];

  if (!tableName) {
    logger.error('Missing required environment variable IMPORT_JOBS_TABLE');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  const importJobId = event.pathParameters?.['importJobId'];

  if (!importJobId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INVALID_REQUEST', message: 'Missing importJobId path parameter' },
      }),
    };
  }

  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);

  if (!tenantId) {
    logger.error('Missing tenant context — tenantContextMiddleware may not have run');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
      }),
    };
  }

  try {
    const docClient = getDynamoDocClient();

    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `IMPORT#${importJobId}`,
        },
      }),
    );

    if (!result.Item) {
      logger.info('Import job not found', { importJobId, tenantId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: `Import job ${importJobId} not found` },
        }),
      };
    }

    // Strip DynamoDB key attributes and return typed ImportJob
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...jobData } = result.Item;
    const importJob = jobData as unknown as ImportJob;

    logger.info('Import job retrieved successfully', { importJobId, tenantId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importJob }),
    };
  } catch (error) {
    logger.error('Error retrieving import job', {
      error: error instanceof Error ? error.message : String(error),
      importJobId,
      tenantId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
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
      action: 'read',
    }),
  )
  .use(
    rateLimitMiddleware({
      maxRequests: 100,
      windowSeconds: 60,
    }),
  );
