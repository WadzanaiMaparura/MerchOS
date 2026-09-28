/**
 * AWS Lambda Powertools Metrics — standalone module.
 *
 * Provides CloudWatch custom metrics under the MerchOS namespace. Isolated
 * so that consumers can import metrics without pulling in the Tracer/X-Ray
 * dependency chain.
 *
 * Requirements: 16.7
 */

import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const serviceName = process.env['SERVICE_NAME'] ?? 'merch-os';

/**
 * CloudWatch Metrics publisher under the MerchOS namespace.
 */
export const metrics = new Metrics({
  namespace: 'MerchOS',
  serviceName,
});

// Re-export MetricUnit for convenience
export { MetricUnit };
