/**
 * Usage Lambda handler for GET /intelligence/usage.
 *
 * Returns token usage summary for the requesting tenant, aggregated by
 * daily or monthly period, with breakdown by generation type.
 *
 * Requirements: 16.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger, tracer } from '../../shared/middleware/powertools';
import { tokenTracker } from '../services/token-tracker';

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
 * 2. Parse query parameter: period (default 'monthly', one of 'daily' | 'monthly')
 * 3. Call tokenTracker.getTenantUsage(tenantId, period)
 * 4. Return the TokenUsageSummary as HTTP 200
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
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

  // Parse period query parameter with default
  const queryParams = event.queryStringParameters ?? {};
  const rawPeriod = queryParams['period'] ?? 'monthly';

  if (rawPeriod !== 'daily' && rawPeriod !== 'monthly') {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: "Period must be 'daily' or 'monthly'",
          field: 'period',
        },
      }),
    };
  }

  const period: 'daily' | 'monthly' = rawPeriod;

  try {
    const usageSummary = await tokenTracker.getTenantUsage(tenantId, period);

    logger.info('Usage summary retrieved', {
      tenantId,
      period,
      totalInputTokens: usageSummary.totalInputTokens,
      totalOutputTokens: usageSummary.totalOutputTokens,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(usageSummary),
    };
  } catch (error) {
    logger.error('Failed to retrieve usage summary', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      period,
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
