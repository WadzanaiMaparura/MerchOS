/**
 * Get Supplier Versions Lambda handler for GET /suppliers/{supplierId}/versions.
 *
 * Returns the chronologically ordered version history for a supplier profile.
 * Each version is a complete snapshot of the profile at that point in time.
 *
 * Requirements: 1.2, 1.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import { createTenantDynamoClient, tenantPK } from '../../shared/utils/dynamo-client';
import type { SupplierVersion } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPLIERS_TABLE = process.env['SUPPLIERS_TABLE'] ?? 'merch-os-suppliers';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic for retrieving supplier version history.
 *
 * 1. Extracts tenantId from the request context (set by tenantContextMiddleware)
 * 2. Queries DynamoDB for version items with SK prefix SUPPLIER#{supplierId}#VERSION#
 * 3. Returns chronologically ordered (by version number ascending) version list
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
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

  // Extract tenantId from the middleware-enriched authorizer context
  const requestContext = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantContext = authorizer?.['tenantContext'] as { tenantId: string } | undefined;
  const tenantId = tenantContext?.tenantId;

  if (!tenantId) {
    logger.error('Missing tenant context — middleware may not have run');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
      }),
    };
  }

  // Parse pagination parameters
  const limit = event.queryStringParameters?.['limit']
    ? Math.min(parseInt(event.queryStringParameters['limit'], 10), 100)
    : 50;

  const nextToken = event.queryStringParameters?.['nextToken'];

  logger.info('Fetching supplier version history', { tenantId, supplierId, limit });

  const dynamoClient = createTenantDynamoClient(tenantId);

  try {
    // Build exclusive start key from pagination token if provided
    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (nextToken) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(nextToken, 'base64url').toString('utf-8')
        );
      } catch {
        return {
          statusCode: 400,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: { code: 'INVALID_REQUEST', message: 'Invalid pagination token' },
          }),
        };
      }
    }

    const result = await dynamoClient.query({
      TableName: SUPPLIERS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': tenantPK(tenantId),
        ':skPrefix': `SUPPLIER#${supplierId}#VERSION#`,
      },
      // Sort ascending by SK to get chronological order (version numbers are part of SK)
      ScanIndexForward: true,
      Limit: limit,
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    });

    const versions: SupplierVersion[] = (result.Items ?? []).map((item) => ({
      supplierId: item['supplierId'] as string,
      tenantId: item['tenantId'] as string,
      version: item['version'] as number,
      snapshot: item['snapshot'] as SupplierVersion['snapshot'],
      createdAt: item['createdAt'] as string,
    }));

    // Build pagination token if there are more results
    let paginationToken: string | undefined;
    if (result.LastEvaluatedKey) {
      paginationToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
        'utf-8'
      ).toString('base64url');
    }

    logger.info('Supplier versions retrieved', {
      tenantId,
      supplierId,
      versionCount: versions.length,
      hasMore: !!paginationToken,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        versions,
        ...(paginationToken && { nextToken: paginationToken }),
      }),
    };
  } catch (error) {
    logger.error('Error fetching supplier versions', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      supplierId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve supplier version history' },
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
  .use(rateLimitMiddleware({ maxRequests: 100, windowSeconds: 60 }));
