/**
 * List Suppliers Lambda handler for GET /suppliers.
 *
 * Returns a paginated list of supplier profiles scoped to the requesting
 * user's tenant (extracted from JWT claims via the tenant context middleware).
 * Queries DynamoDB GSI1 with PK TENANT#{tenantId} and SK prefix SUPPLIER#CREATED#
 * to return results ordered by creation date.
 *
 * Supports pagination via `lastEvaluatedKey` query parameter (base64-encoded).
 *
 * Requirements: 1.4, 12.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { listSuppliersQuerySchema } from '../schemas/supplier.schema';
import type { SupplierProfile } from '../types/supplier.types';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListSuppliersEvent extends Omit<APIGatewayProxyEventV2, 'queryStringParameters'> {
  queryStringParameters: {
    limit?: number;
    lastEvaluatedKey?: string;
  };
}

interface ListSuppliersResponse {
  suppliers: SupplierProfile[];
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
// Handler
// ---------------------------------------------------------------------------

/**
 * Core list-suppliers handler logic.
 *
 * 1. Extracts tenantId from the tenant context middleware
 * 2. Queries GSI1 with PK=TENANT#{tenantId} and SK begins_with SUPPLIER#CREATED#
 * 3. Supports pagination via base64-encoded lastEvaluatedKey
 * 4. Returns paginated supplier list sorted by creation date (most recent first)
 */
async function baseHandler(event: ListSuppliersEvent): Promise<APIGatewayProxyResultV2> {
  const tableName = process.env['SUPPLIERS_TABLE'];

  if (!tableName) {
    logger.error('Missing required environment variable SUPPLIERS_TABLE');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
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

  const queryParams = event.queryStringParameters ?? {};
  const limit = queryParams.limit ?? 20;
  const lastEvaluatedKeyParam = queryParams.lastEvaluatedKey;

  // Decode pagination cursor if provided
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (lastEvaluatedKeyParam) {
    try {
      const decoded = Buffer.from(lastEvaluatedKeyParam, 'base64').toString('utf-8');
      exclusiveStartKey = JSON.parse(decoded);
    } catch {
      logger.warn('Invalid lastEvaluatedKey parameter', { lastEvaluatedKeyParam });
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
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}`,
        ':skPrefix': 'SUPPLIER#CREATED#',
      },
      Limit: limit,
      ScanIndexForward: false, // Most recent first
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    });

    const result = await docClient.send(command);

    const suppliers: SupplierProfile[] = (result.Items ?? []).map((item) => {
      const supplier: SupplierProfile = {
        supplierId: item['supplierId'] as string,
        tenantId: item['tenantId'] as string,
        name: item['name'] as string,
        duplicateStrategy: item['duplicateStrategy'] as SupplierProfile['duplicateStrategy'],
        version: item['version'] as number,
        createdAt: item['createdAt'] as string,
        updatedAt: item['updatedAt'] as string,
      };
      if (item['contactEmail'] != null) supplier.contactEmail = item['contactEmail'] as string;
      if (item['contactPhone'] != null) supplier.contactPhone = item['contactPhone'] as string;
      if (item['website'] != null) supplier.website = item['website'] as string;
      if (item['notes'] != null) supplier.notes = item['notes'] as string;
      return supplier;
    });

    const response: ListSuppliersResponse = {
      suppliers,
    };

    // Encode the lastEvaluatedKey as base64 for the client to use as pagination cursor
    if (result.LastEvaluatedKey) {
      response.lastEvaluatedKey = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString('base64');
    }

    logger.info('Suppliers listed successfully', {
      tenantId,
      count: suppliers.length,
      hasMore: !!result.LastEvaluatedKey,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Failed to list suppliers', {
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
  )
  .use(
    inputValidationMiddleware({
      schema: listSuppliersQuerySchema,
      source: 'queryStringParameters',
    }),
  );
