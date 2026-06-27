/**
 * Middy middleware factory that wires Powertools (Logger, Tracer, Metrics)
 * into any Lambda handler with a single function call.
 *
 * Usage:
 *   import { withPowertools } from '@merch-os/shared/middleware';
 *   export const handler = withPowertools(async (event, context) => { ... });
 *
 * Requirements: 16.7
 */

import middy from '@middy/core';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import { Context, Handler } from 'aws-lambda';
import { logger, tracer, metrics } from './powertools';

/**
 * Extracts the tenantId from API Gateway authorizer context (if present)
 * and adds it to logger persistent keys for all subsequent log entries.
 */
function extractTenantContext(): middy.MiddlewareObj {
  const before: middy.MiddlewareFn = async (request) => {
    const event = request.event as Record<string, unknown>;

    // API Gateway v2 injects authorizer context
    const requestContext = event['requestContext'] as
      | Record<string, unknown>
      | undefined;
    const authorizer = requestContext?.['authorizer'] as
      | Record<string, unknown>
      | undefined;
    const lambda = authorizer?.['lambda'] as
      | Record<string, unknown>
      | undefined;

    const tenantId = (lambda?.['tenantId'] as string) ?? undefined;

    if (tenantId) {
      logger.appendKeys({ tenantId });
    }
  };

  return { before };
}

/**
 * Error logging middleware that captures unhandled errors with correlation ID
 * before rethrowing for upstream handling.
 */
function errorLogger(): middy.MiddlewareObj {
  const onError: middy.MiddlewareFn = async (request) => {
    const error = request.error as Error | undefined;
    if (error) {
      logger.error('Unhandled Lambda error', {
        error: error.message,
        stack: error.stack,
        requestId: request.context.awsRequestId,
      });
    }
  };

  return { onError };
}

/**
 * Wraps a Lambda handler with the full MerchOS Powertools middleware stack:
 * - Structured logging with correlation IDs and tenant context
 * - X-Ray distributed tracing
 * - CloudWatch custom metrics
 * - Error logging with request ID
 *
 * @param handler - The raw Lambda handler function
 * @returns A Middy-wrapped handler with all middleware applied
 */
export function withPowertools<TEvent = unknown, TResult = unknown>(
  handler: Handler<TEvent, TResult>
): middy.MiddyfiedHandler<TEvent, TResult, Error, Context> {
  return middy(handler)
    .use(injectLambdaContext(logger, { clearState: true }))
    .use(captureLambdaHandler(tracer))
    .use(logMetrics(metrics, { captureColdStartMetric: true }))
    .use(extractTenantContext())
    .use(errorLogger());
}
