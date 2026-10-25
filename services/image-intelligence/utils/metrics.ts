/**
 * CloudWatch metrics helpers for the Image Intelligence Engine.
 *
 * Wraps the shared Powertools Metrics instance (namespace `MerchOS`) so the
 * pipeline's operational signals — moderation rejections, enhancement
 * invocations/failures, and job failures — are observable and alertable
 * (requirement 7.5), mirroring the approach used for G12 in Product Intelligence.
 */

import { metrics, MetricUnit } from '../../shared/middleware/powertools';

/** Increment a named Count metric by 1. */
export function countMetric(name: string): void {
  metrics.addMetric(name, MetricUnit.Count, 1);
}

/** Metric names emitted by the Image Intelligence pipeline. */
export const IMAGE_METRICS = {
  moderationRejected: 'ImageModerationRejected',
  heroLowConfidence: 'HeroLowConfidence',
  enhancementInvoked: 'ImageEnhancementInvoked',
  enhancementFailed: 'ImageEnhancementFailed',
  jobFailed: 'ImageJobFailed',
  jobCompleted: 'ImageJobCompleted',
} as const;
