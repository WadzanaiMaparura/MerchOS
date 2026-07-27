/**
 * Get Supplier Lambda handler for GET /suppliers/{supplierId}.
 *
 * Returns a single supplier profile scoped to the authenticated tenant.
 * The handler enforces tenant isolation by querying DynamoDB with the
 * caller's tenant partition key.
 *
 * Requirements: 1.2, 1.3, 12.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';
import type { SupplierProfile } from '../types/supplier.types';

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
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic for retrieving a single supplier profile.
 *
 * 1. Extract tenantId from authorizer context
 * 2. Read supplierId from path parameters
 * 3. Query DynamoDB with PK TENANT#{tenantId}, SK SUPPLIER#{supplierId}
 * 4. Return the supplier record or 404
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const suppliersTable = process.env['SUPPLIERS_TABLE'];

  if (!suppliersTable) {
    logger.error('Missing required environment variable SUPPLIERS_TABLE');
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

  // Extract tenantId from the tenant context middleware
  const requestContext = event.requestContext as unknown as Record<string, unknown>;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantContext = authorizer?.['tenantContext'] as
    | { tenantId: string }
    | undefined;

  const tenantId = tenantContext?.tenantId;

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
        TableName: suppliersTable,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `SUPPLIER#${supplierId}`,
        },
      }),
    );

    if (!result.Item) {
      logger.info('Supplier not found', { supplierId, tenantId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: `Supplier ${supplierId} not found` },
        }),
      };
    }

    // Extract the supplier profile fields (exclude DynamoDB key attributes)
    const { PK, SK, GSI1PK, GSI1SK, ...supplierData } = result.Item;
    const supplier = supplierData as unknown as SupplierProfile;

    logger.info('Supplier retrieved successfully', { supplierId, tenantId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supplier }),
    };
  } catch (error) {
    logger.error('Error retrieving supplier', {
      error: error instanceof Error ? error.message : String(error),
      supplierId,
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
  .use(
    rbacMiddleware({
      resource: 'supplier',
      action: 'read',
    }),
  )
  .use(tenantContextMiddleware())
  .use(
    rateLimitMiddleware({
      maxRequests: 100,
      windowSeconds: 60,
    }),
  );
