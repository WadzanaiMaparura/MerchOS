/**
 * List Import Jobs Lambda handler for GET /imports.
 *
 * Returns a paginated list of import jobs scoped to the requesting user's tenant.
 * Supports filtering by status, supplier, source type, and date range using GSI2.
 * Results are sorted by createdAt descending (most recent first).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5, 10.1, 10.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import type { ImportJob, ImportJobStatus, SourceType } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListImportJobsQueryParams {
  limit?: number;
  lastEvaluatedKey?: string;
  status?: ImportJobStatus;
  supplierId?: string;
  sourceType?: SourceType;
  startDate?: string;
  endDate?: string;
}

interface ListImportJobsEvent extends Omit<APIGatewayProxyEventV2, 'queryStringParameters'> {
  queryStringParameters: ListImportJobsQueryParams;
}

interface ListImportJobsResponse {
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
 * 2. Parse filter parameters (status, supplierId, sourceType, date range)
 * 3. If status filter is present, query GSI2 with TENANT#{tenantId}#STATUS#{status}
 * 4. Otherwise, query main table with PK=TENANT#{tenantId} and SK prefix IMPORT#
 * 5. Apply post-query filtering for supplierId, sourceType, and date range
 * 6. Return paginated results sorted by createdAt descending
 */
async function baseHandler(event: ListImportJobsEvent): Promise<APIGatewayProxyResultV2> {
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
  const { status, supplierId, sourceType, startDate, endDate, lastEvaluatedKey } = queryParams;

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
    let command: QueryCommand;

    if (status) {
      // Use GSI2 for status-filtered queries
      // GSI2PK: TENANT#{tenantId}#STATUS#{status}, GSI2SK: IMPORT#CREATED#{timestamp}
      const keyCondition = buildDateRangeKeyCondition(
        'GSI2PK',
        'GSI2SK',
        `TENANT#${tenantId}#STATUS#${status}`,
        'IMPORT#CREATED#',
        startDate,
        endDate,
      );

      const filter = buildFilterExpression(supplierId, sourceType);

      command = new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: keyCondition.expression,
        ExpressionAttributeValues: {
          ...keyCondition.values,
          ...filter.ExpressionAttributeValues,
        },
        ...(filter.FilterExpression && { FilterExpression: filter.FilterExpression }),
        Limit: limit,
        ScanIndexForward: false, // Most recent first
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      });
    } else if (supplierId) {
      // Use GSI1 for supplier-scoped queries
      // GSI1PK: TENANT#{tenantId}#SUPPLIER#{supplierId}, GSI1SK: IMPORT#CREATED#{timestamp}
      const keyCondition = buildDateRangeKeyCondition(
        'GSI1PK',
        'GSI1SK',
        `TENANT#${tenantId}#SUPPLIER#${supplierId}`,
        'IMPORT#CREATED#',
        startDate,
        endDate,
      );

      const filter = buildFilterExpression(undefined, sourceType);

      command = new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: keyCondition.expression,
        ExpressionAttributeValues: {
          ...keyCondition.values,
          ...filter.ExpressionAttributeValues,
        },
        ...(filter.FilterExpression && { FilterExpression: filter.FilterExpression }),
        Limit: limit,
        ScanIndexForward: false,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      });
    } else {
      // Query main table with PK=TENANT#{tenantId} and SK prefix IMPORT#
      const keyCondition = buildDateRangeKeyCondition(
        'PK',
        'SK',
        `TENANT#${tenantId}`,
        'IMPORT#',
        undefined, // Date range filtering not supported on main table SK pattern
        undefined,
      );

      const filter = buildFilterExpression(undefined, sourceType, startDate, endDate);

      command = new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: keyCondition.expression,
        ExpressionAttributeValues: {
          ...keyCondition.values,
          ...filter.ExpressionAttributeValues,
        },
        ...(filter.FilterExpression && { FilterExpression: filter.FilterExpression }),
        Limit: limit,
        ScanIndexForward: false,
        ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
      });
    }

    const result = await docClient.send(command);

    const importJobs = (result.Items ?? []).map(
      (item) => mapItemToImportJob(item as Record<string, unknown>),
    );

    const response: ListImportJobsResponse = {
      importJobs,
    };

    if (result.LastEvaluatedKey) {
      response.lastEvaluatedKey = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString('base64');
    }

    logger.info('Import jobs listed successfully', {
      tenantId,
      count: importJobs.length,
      hasMore: !!result.LastEvaluatedKey,
      filters: { status, supplierId, sourceType, startDate, endDate },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Failed to list import jobs', {
      error: error instanceof Error ? error.message : String(error),
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
// Query Building Helpers
// ---------------------------------------------------------------------------

interface KeyConditionResult {
  expression: string;
  values: Record<string, string>;
}

/**
 * Builds a key condition expression with optional date range on the sort key.
 * When startDate and/or endDate are provided, uses BETWEEN or comparison operators
 * on the sort key for efficient server-side filtering.
 */
function buildDateRangeKeyCondition(
  pkAttr: string,
  skAttr: string,
  pkValue: string,
  skPrefix: string,
  startDate?: string,
  endDate?: string,
): KeyConditionResult {
  const values: Record<string, string> = {
    ':pk': pkValue,
  };

  if (startDate && endDate) {
    // Both bounds: BETWEEN
    values[':skStart'] = `${skPrefix}${startDate}`;
    values[':skEnd'] = `${skPrefix}${endDate}\uffff`; // \uffff ensures inclusive end
    return {
      expression: `${pkAttr} = :pk AND ${skAttr} BETWEEN :skStart AND :skEnd`,
      values,
    };
  } else if (startDate) {
    // Only start bound: >= startDate
    values[':skStart'] = `${skPrefix}${startDate}`;
    return {
      expression: `${pkAttr} = :pk AND ${skAttr} >= :skStart`,
      values,
    };
  } else if (endDate) {
    // Only end bound: begins_with prefix AND <= endDate
    values[':skPrefix'] = skPrefix;
    values[':skEnd'] = `${skPrefix}${endDate}\uffff`;
    return {
      expression: `${pkAttr} = :pk AND ${skAttr} BETWEEN :skPrefix AND :skEnd`,
      values,
    };
  } else {
    // No date filtering — use begins_with on sort key prefix
    values[':skPrefix'] = skPrefix;
    return {
      expression: `${pkAttr} = :pk AND begins_with(${skAttr}, :skPrefix)`,
      values,
    };
  }
}

/**
 * Builds a DynamoDB FilterExpression for post-query filtering on non-key attributes.
 * Used when the query key already narrows down on one dimension (status or supplier)
 * but additional filters need to be applied on remaining attributes.
 */
function buildFilterExpression(
  supplierId?: string,
  sourceType?: string,
  startDate?: string,
  endDate?: string,
): { FilterExpression?: string; ExpressionAttributeValues?: Record<string, string> } {
  const conditions: string[] = [];
  const values: Record<string, string> = {};

  if (supplierId) {
    conditions.push('supplierId = :filterSupplierId');
    values[':filterSupplierId'] = supplierId;
  }

  if (sourceType) {
    conditions.push('sourceType = :filterSourceType');
    values[':filterSourceType'] = sourceType;
  }

  if (startDate) {
    conditions.push('createdAt >= :filterStartDate');
    values[':filterStartDate'] = startDate;
  }

  if (endDate) {
    conditions.push('createdAt <= :filterEndDate');
    values[':filterEndDate'] = endDate;
  }

  if (conditions.length === 0) {
    return {};
  }

  return {
    FilterExpression: conditions.join(' AND '),
    ExpressionAttributeValues: values,
  };
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
