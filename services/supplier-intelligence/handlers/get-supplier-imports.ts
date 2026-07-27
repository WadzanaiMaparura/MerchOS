/**
 * Get Supplier Imports Lambda handler for GET /suppliers/{supplierId}/imports.
 *
 * Returns a paginated list of import jobs for a specific supplier, scoped to
 * the authenticated tenant. Queries GSI1 with
 * PK=TENANT#{tenantId}#SUPPLIER#{supplierId} for supplier-scoped history.
 * Results are sorted by createdAt descending (most recent first).
 *
 * Requirements: 9.1, 9.5, 10.1, 10.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import type { ImportJob } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GetSupplierImportsQueryParams {
  limit?: number;
  lastEvaluatedKey?: string;
  startDate?: string;
  endDate?: string;
}

interface GetSupplierImportsEvent extends Omit<APIGatewayProxyEventV2, 'queryStringParameters'> {
  queryStringParameters: GetSupplierImportsQueryParams;
}

interface GetSupplierImportsResponse {
  importJobs: ImportJob[];
  lastEvaluatedKey?: string;
}

// ---------------------------------------------------------------------------
// Clients (singletons)
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
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

/**
 * Strips DynamoDB key attributes from items and returns typed ImportJob objects.
 */
function mapItemToImportJob(item: Record<string, unknown>): ImportJob {
  const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, ...jobData } = item;
  return jobData as unknown as ImportJob;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic:
 * 1. Extract tenantId from tenant context
 * 2. Read supplierId from path parameters
 * 3. Query GSI1 with PK=TENANT#{tenantId}#SUPPLIER#{supplierId}, SK prefix IMPORT#CREATED#
 * 4. Support date range filtering via startDate/endDate query params
 * 5. Return paginated results sorted by createdAt descending
 */
async function baseHandler(event: GetSupplierImportsEvent): Promise<APIGatewayProxyResultV2> {
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

  const supplierId = event.pathParameters?.['supplierId'];

  if (!supplierId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INVALID_REQUEST', message: 'Missing supplierId path parameter' },
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

  const queryParams = event.queryStringParameters ?? {};
  const limit = queryParams.limit ?? 20;
  const { startDate, endDate, lastEvaluatedKey } = queryParams;

  // Decode pagination cursor if provided
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (lastEvaluatedKey) {
    try {
      const decoded = Buffer.from(lastEvaluatedKey, 'base64').toString('utf-8');
      exclusiveStartKey = JSON.parse(decoded);
    } catch {
      logger.warn('Invalid lastEvaluatedKey parameter', { lastEvaluatedKey });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid pagination cursor' },
        }),
      };
    }
  }

  const docClient = getDynamoDocClient();

  try {
    // Build key condition for GSI1
    const gsi1pk = `TENANT#${tenantId}#SUPPLIER#${supplierId}`;
    const skPrefix = 'IMPORT#CREATED#';

    const keyCondition = buildDateRangeKeyCondition(gsi1pk, skPrefix, startDate, endDate);

    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: keyCondition.expression,
      ExpressionAttributeValues: keyCondition.values,
      Limit: limit,
      ScanIndexForward: false, // Most recent first (descending by createdAt)
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    });

    const result = await docClient.send(command);

    const importJobs = (result.Items ?? []).map(
      (item) => mapItemToImportJob(item as Record<string, unknown>),
    );

    const response: GetSupplierImportsResponse = {
      importJobs,
    };

    if (result.LastEvaluatedKey) {
      response.lastEvaluatedKey = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString('base64');
    }

    logger.info('Supplier imports listed successfully', {
      tenantId,
      supplierId,
      count: importJobs.length,
      hasMore: !!result.LastEvaluatedKey,
      filters: { startDate, endDate },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Failed to list supplier imports', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      supplierId,
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
// Query Building Helpers
// ---------------------------------------------------------------------------

interface KeyConditionResult {
  expression: string;
  values: Record<string, string>;
}

/**
 * Builds a GSI1 key condition expression with optional date range on the sort key.
 * GSI1SK format: IMPORT#CREATED#{timestamp}
 */
function buildDateRangeKeyCondition(
  gsi1pk: string,
  skPrefix: string,
  startDate?: string,
  endDate?: string,
): KeyConditionResult {
  const values: Record<string, string> = {
    ':pk': gsi1pk,
  };

  if (startDate && endDate) {
    values[':skStart'] = `${skPrefix}${startDate}`;
    values[':skEnd'] = `${skPrefix}${endDate}\uffff`;
    return {
      expression: 'GSI1PK = :pk AND GSI1SK BETWEEN :skStart AND :skEnd',
      values,
    };
  } else if (startDate) {
    values[':skStart'] = `${skPrefix}${startDate}`;
    return {
      expression: 'GSI1PK = :pk AND GSI1SK >= :skStart',
      values,
    };
  } else if (endDate) {
    values[':skPrefix'] = skPrefix;
    values[':skEnd'] = `${skPrefix}${endDate}\uffff`;
    return {
      expression: 'GSI1PK = :pk AND GSI1SK BETWEEN :skPrefix AND :skEnd',
      values,
    };
  } else {
    values[':skPrefix'] = skPrefix;
    return {
      expression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      values,
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
