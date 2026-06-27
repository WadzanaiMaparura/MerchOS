/**
 * AWS Lambda Powertools instances shared across all MerchOS Lambda functions.
 *
 * Provides structured logging, distributed tracing, and custom metrics.
 * Requirements: 16.7
 */

import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const serviceName = process.env['SERVICE_NAME'] ?? 'merch-os';

/**
 * Structured JSON logger with correlation ID support.
 * Log level configurable via LOG_LEVEL env var (default: INFO).
 */
export const logger = new Logger({
  serviceName,
  logLevel: (process.env['LOG_LEVEL'] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
});

/**
 * X-Ray tracer for distributed tracing across Lambda invocations.
 * Captures response and error data automatically.
 */
export const tracer = new Tracer({
  serviceName,
  captureHTTPsRequests: true,
});

/**
 * CloudWatch Metrics publisher under the MerchOS namespace.
 */
export const metrics = new Metrics({
  namespace: 'MerchOS',
  serviceName,
});

// Re-export MetricUnit for convenience
export { MetricUnit };
