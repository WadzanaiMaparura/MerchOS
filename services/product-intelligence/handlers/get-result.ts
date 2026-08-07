/**
 * Get Result Lambda handler for GET /intelligence/results/{resultId}.
 *
 * Returns a single generation result scoped to the requesting user's tenant.
 * Queries DynamoDB with tenant-scoped PK and RESULT#{resultId} SK.
 * Returns 404 if the result is not found.
 *
 * Requirements: 16.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger, tracer } from '../../shared/middleware/powertools';
import type { GenerationResult } from '../types/generation.types';
import type { GenerationResultItem } from '../types/dynamo.types';

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
 * Maps a DynamoDB GenerationResultItem to the API-facing GenerationResult type.
 */
function mapItemToGenerationResult(item: GenerationResultItem): GenerationResult {
  return {
    resultId: item.resultId,
    type: item.generationType,
    status: item.status,
    content: item.result,
    confidenceScore: item.confidenceScore,
    reviewRecommended: item.reviewRecommended,
    metadata: {
      promptVersion: item.promptVersion,
      promptTemplateId: item.promptTemplateId,
      tokenUsage: item.tokenUsage,
      cached: item.cached,
      modelId: '', // Not stored on the item; populated at generation time
      latencyMs: 0, // Not stored on the item; populated at generation time
      ...(item.marketplace && { marketplace: item.marketplace }),
      ...(item.marketplaceCompliance && { marketplaceCompliance: item.marketplaceCompliance }),
    },
    createdAt: item.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic:
 * 1. Extract tenantId from tenant context
 * 2. Extract resultId from path parameters
 * 3. Query DynamoDB with PK=TENANT#{tenantId}, SK=RESULT#{resultId}
 * 4. If not found, return 404 with structured error
 * 5. Map the DynamoDB item to GenerationResult and return 200
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tableName = process.env['PRODUCT_INTELLIGENCE_TABLE'] ?? 'product-intelligence';

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

  const resultId = event.pathParameters?.['resultId'];

  if (!resultId) {
    logger.warn('Missing resultId path parameter');
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'resultId path parameter is required' },
      }),
    };
  }

  const docClient = getDynamoDocClient();

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: tableName,
        Key: {
          PK: `TENANT#${tenantId}`,
          SK: `RESULT#${resultId}`,
        },
      }),
    );

    if (!result.Item) {
      logger.info('Generation result not found', { tenantId, resultId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'NOT_FOUND', message: `Generation result '${resultId}' not found` },
        }),
      };
    }

    const generationResult = mapItemToGenerationResult(result.Item as unknown as GenerationResultItem);

    logger.info('Generation result retrieved', { tenantId, resultId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generationResult),
    };
  } catch (error) {
    logger.error('Failed to retrieve generation result', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      resultId,
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
