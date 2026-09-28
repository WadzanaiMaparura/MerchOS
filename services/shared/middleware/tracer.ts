/**
 * AWS Lambda Powertools Tracer — standalone module.
 *
 * Provides X-Ray distributed tracing across Lambda invocations. This module
 * is imported only by handlers that genuinely need tracing, keeping the
 * aws-xray-sdk-core -> cls-hooked dependency chain out of logging-only bundles.
 *
 * Requirements: 16.7
 */

import { Tracer } from '@aws-lambda-powertools/tracer';

const serviceName = process.env['SERVICE_NAME'] ?? 'merch-os';

/**
 * X-Ray tracer for distributed tracing across Lambda invocations.
 * Captures response and error data automatically.
 */
export const tracer = new Tracer({
  serviceName,
  captureHTTPsRequests: true,
});
