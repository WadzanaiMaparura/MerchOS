/**
 * AWS Lambda Powertools Logger — standalone module.
 *
 * Provides structured JSON logging with correlation ID support. This module
 * intentionally depends ONLY on @aws-lambda-powertools/logger so that
 * logging-only consumers do not transitively pull in the Tracer/X-Ray
 * (aws-xray-sdk-core -> cls-hooked) dependency chain into their bundle.
 *
 * Requirements: 16.7
 */

import { Logger } from '@aws-lambda-powertools/logger';

const serviceName = process.env['SERVICE_NAME'] ?? 'merch-os';

/**
 * Structured JSON logger with correlation ID support.
 * Log level configurable via LOG_LEVEL env var (default: INFO).
 */
export const logger = new Logger({
  serviceName,
  logLevel: (process.env['LOG_LEVEL'] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
});
