/**
 * Custom CloudWatch metrics utility for the Supplier Intelligence Platform.
 *
 * Wraps AWS Powertools Metrics to emit structured CloudWatch metrics with
 * consistent dimensions (tenantId, sourceType) across all import operations.
 *
 * Metrics emitted:
 * - ImportsInitiated (counter) — when an import job is enqueued
 * - ImportsCompleted (counter) — when an import job finishes successfully
 * - ImportsFailed (counter) — when an import job fails
 * - ImportDuration (milliseconds) — total processing time for a completed import
 * - ProductsExtracted (counter) — number of products extracted from a source
 *
 * @see Requirements 13.1, 13.2, 13.3, 13.4
 */

import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetricDimensions {
  /** Tenant identifier */
  tenantId: string;
  /** The import source type (e.g., FILE_CSV, FILE_EXCEL, IMAGE, URL) */
  sourceType: string;
}

// ---------------------------------------------------------------------------
// Singleton Metrics Instance
// ---------------------------------------------------------------------------

const NAMESPACE = 'SupplierIntelligence';
const SERVICE_NAME = 'supplier-intelligence';

let metricsInstance: Metrics | null = null;

/**
 * Returns a singleton Metrics instance configured for the Supplier Intelligence
 * namespace. The instance is reused across invocations within the same Lambda
 * execution environment.
 */
export function getMetricsInstance(): Metrics {
  if (!metricsInstance) {
    metricsInstance = new Metrics({
      namespace: NAMESPACE,
      serviceName: SERVICE_NAME,
    });
  }
  return metricsInstance;
}

/**
 * Resets the singleton Metrics instance.
 * Used in tests to ensure a fresh instance between test cases.
 */
export function resetMetricsForTesting(): void {
  metricsInstance = null;
}

// ---------------------------------------------------------------------------
// Metric Recording Helpers
// ---------------------------------------------------------------------------

/**
 * Records that an import job has been initiated.
 *
 * Emits: ImportsInitiated = 1, dimensioned by tenantId and sourceType.
 *
 * @param dimensions - The tenantId and sourceType for the import.
 */
export function recordImportInitiated(dimensions: MetricDimensions): void {
  const m = getMetricsInstance();
  m.addDimension('tenantId', dimensions.tenantId);
  m.addDimension('sourceType', dimensions.sourceType);
  m.addMetric('ImportsInitiated', MetricUnit.Count, 1);
  m.publishStoredMetrics();
}

/**
 * Records that an import job has completed successfully.
 *
 * Emits: ImportsCompleted = 1, dimensioned by tenantId and sourceType.
 *
 * @param dimensions - The tenantId and sourceType for the import.
 */
export function recordImportCompleted(dimensions: MetricDimensions): void {
  const m = getMetricsInstance();
  m.addDimension('tenantId', dimensions.tenantId);
  m.addDimension('sourceType', dimensions.sourceType);
  m.addMetric('ImportsCompleted', MetricUnit.Count, 1);
  m.publishStoredMetrics();
}

/**
 * Records that an import job has failed.
 *
 * Emits: ImportsFailed = 1, dimensioned by tenantId and sourceType.
 *
 * @param dimensions - The tenantId and sourceType for the import.
 */
export function recordImportFailed(dimensions: MetricDimensions): void {
  const m = getMetricsInstance();
  m.addDimension('tenantId', dimensions.tenantId);
  m.addDimension('sourceType', dimensions.sourceType);
  m.addMetric('ImportsFailed', MetricUnit.Count, 1);
  m.publishStoredMetrics();
}

/**
 * Records the total duration of an import job in milliseconds.
 *
 * Emits: ImportDuration = durationMs, dimensioned by tenantId and sourceType.
 *
 * @param dimensions - The tenantId and sourceType for the import.
 * @param durationMs - Processing duration in milliseconds.
 */
export function recordImportDuration(dimensions: MetricDimensions, durationMs: number): void {
  const m = getMetricsInstance();
  m.addDimension('tenantId', dimensions.tenantId);
  m.addDimension('sourceType', dimensions.sourceType);
  m.addMetric('ImportDuration', MetricUnit.Milliseconds, durationMs);
  m.publishStoredMetrics();
}

/**
 * Records the number of products extracted from a single import source.
 *
 * Emits: ProductsExtracted = count, dimensioned by tenantId and sourceType.
 *
 * @param dimensions - The tenantId and sourceType for the import.
 * @param count - Number of products extracted.
 */
export function recordProductsExtracted(dimensions: MetricDimensions, count: number): void {
  const m = getMetricsInstance();
  m.addDimension('tenantId', dimensions.tenantId);
  m.addDimension('sourceType', dimensions.sourceType);
  m.addMetric('ProductsExtracted', MetricUnit.Count, count);
  m.publishStoredMetrics();
}
