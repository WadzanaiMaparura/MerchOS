/**
 * Step Functions workflow I/O contract for the Image Processing workflow.
 *
 * The state machine threads a single JSON object through the states. Each task
 * Lambda receives the accumulated state and returns a partial result that the
 * state machine merges under a `resultPath`.
 *
 * Requirements: 7.1
 */

import type { ImageVariant, ModerationResult } from './image.types';

/** Initial input provided when the workflow starts (from start-process). */
export interface WorkflowInput {
  tenantId: string;
  productId: string;
  imageJobId: string;
  /** Raw-uploads S3 keys of the source image(s). */
  sourceKeys: string[];
  /** Buckets resolved from env by start-process and passed through. */
  rawUploadsBucket: string;
  assetsBucket: string;
}

/** Moderation task output. */
export interface ModerationStepResult extends ModerationResult {
  /** The source key that was moderated (the hero candidate). */
  sourceKey: string;
}

/** Background-removal task output. */
export interface BackgroundRemovalStepResult {
  heroKey: string;
  heroEdge: number;
  reviewRecommended: boolean;
}

/** Packager task output. */
export interface PackagerStepResult {
  variants: ImageVariant[];
}

/** Failure payload passed to the HandleFailure task. */
export interface FailurePayload {
  action: 'RECORD_FAILURE';
  tenantId: string;
  productId: string;
  imageJobId: string;
  error: { code: string; message: string };
}
