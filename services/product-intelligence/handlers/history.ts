/**
 * History Lambda handler for GET /intelligence/history.
 *
 * Returns a paginated list of generation results scoped to the requesting
 * user's tenant. Supports filtering by generation type.
 * Results are sorted by createdAt descending (most recent first) using GSI1.
 *
 * Requirements: 16.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger, tracer } from '../../shared/middleware/powertools';
import type { GenerationResult, GenerationType } from '../types/generation.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistoryQueryParams {
  limit?: string;
  lastEvaluatedKey?: string;
  type?: string;
}

interface HistoryResponse {
  results: GenerationResult[];
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
 * Valid generation types for filtering.
 */
const VALID_GENERATION_TYPES: ReadonlySet<string> = new Set([
  'title',
  'description',
  'bullets',
  'seo',
  'category',
  'brand',
  'attributes',
  'keywords',
  'compliance',
]);

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
 * Strips DynamoDB key attributes from items and maps to GenerationResult.
 */
function mapItemToGenerationResult(item: Record<string, unknown>): GenerationResult {
  const {
    PK,
    SK,
    GSI1PK,
    GSI1SK,
    GSI2PK,
    GSI2SK,
    resultId,
    generationType,
    status,
    result,
    request: _request,
    confidenceScore,
    reviewRecommended,
    tokenUsage,
    promptVersion,
    promptTemplateId,
    marketplace,
    marketplaceCompliance,
    cached,
    createdAt,
    ...rest
  } = item;

  return {
    resultId: resultId as string,
    type: generationType as GenerationType,
    status: status as 'completed' | 'failed',
    content: result as GenerationResult['content'],
    confidenceScore: confidenceScore as number,
    reviewRecommended: reviewRecommended as boolean,
    metadata: {
      promptVersion: promptVersion as number,
      promptTemplateId: promptTemplateId as string,
      tokenUsage: tokenUsage as { inputTokens: number; outputTokens: number },
      cached: cached as boolean,
      modelId: (rest['modelId'] as string) ?? '',
      latencyMs: (rest['latencyMs'] as number) ?? 0,
      ...(marketplace && { marketplace: marketplace as GenerationResult['metadata']['marketplace'] }),
      ...(marketplaceCompliance && {
        marketplaceCompliance: marketplaceCompliance as GenerationResult['metadata']['marketplaceCompliance'],
      }),
    },
    createdAt: createdAt as string,
  } as GenerationResult;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic:
 * 1. Extract tenantId from tenant context
 * 2. Parse query parameters (limit, lastEvaluatedKey, type)
 * 3. Query GSI1 with GSI1PK=TENANT#{tenantId}, GSI1SK begins_with RESULT#CREATED#
 * 4. If type filter is present, add FilterExpression for generationType
 * 5. Support pagination via decoded base64 lastEvaluatedKey
 * 6. Return paginated results sorted by createdAt descending
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tableName = process.env['PRODUCT_INTELLIGENCE_TABLE'];

  if (!tableName) {
    logger.error('Missing required environment variable PRODUCT_INTELLIGENCE_TABLE');
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

  const queryParams = (event.queryStringParameters ?? {}) as HistoryQueryParams;

  // Parse and validate limit
  const rawLimit = queryParams.limit;
  const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 20, 1), 100) : 20;

  // Parse and validate type filter
  const typeFilter = queryParams.type;
  if (typeFilter && !VALID_GENERATION_TYPES.has(typeFilter)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid type filter. Must be one of: ${[...VALID_GENERATION_TYPES].join(', ')}`,
        },
      }),
    };
  }

  // Decode pagination cursor if provided
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (queryParams.lastEvaluatedKey) {
    try {
      const decoded = Buffer.from(queryParams.lastEvaluatedKey, 'base64').toString('utf-8');
      exclusiveStartKey = JSON.parse(decoded);
    } catch {
      logger.warn('Invalid lastEvaluatedKey parameter', {
        lastEvaluatedKey: queryParams.lastEvaluatedKey,
      });
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
    // Build FilterExpression for type filter if present
    let filterExpression: string | undefined;
    let expressionAttributeValues: Record<string, unknown> = {
      ':gsi1pk': `TENANT#${tenantId}`,
      ':gsi1skPrefix': 'RESULT#CREATED#',
    };

    if (typeFilter) {
      filterExpression = 'generationType = :generationType';
      expressionAttributeValues[':generationType'] = typeFilter;
    }

    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk AND begins_with(GSI1SK, :gsi1skPrefix)',
      ExpressionAttributeValues: expressionAttributeValues,
      ...(filterExpression && { FilterExpression: filterExpression }),
      Limit: limit,
      ScanIndexForward: false, // Most recent first (descending)
      ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
    });

    const result = await docClient.send(command);

    const results = (result.Items ?? []).map((item) =>
      mapItemToGenerationResult(item as Record<string, unknown>),
    );

    const response: HistoryResponse = {
      results,
    };

    if (result.LastEvaluatedKey) {
      response.lastEvaluatedKey = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString('base64');
    }

    logger.info('Generation history listed successfully', {
      tenantId,
      count: results.length,
      hasMore: !!result.LastEvaluatedKey,
      typeFilter: typeFilter ?? 'none',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error('Failed to list generation history', {
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
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(tenantContextMiddleware())
  .use(
    rbacMiddleware({
      resource: 'intelligence',
      action: 'read',
    }),
  )
  .use(rateLimitMiddleware());
