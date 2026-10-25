/**
 * Image Intelligence Engine domain types — image jobs, variants, moderation,
 * and enhancement metadata.
 *
 * Requirements: 1.*, 2.*, 3.*, 4.*, 5.*, 7.*, 8.*
 */

import type { ChannelId } from '@merch-os/types';

// ---------------------------------------------------------------------------
// Enums / Union Types
// ---------------------------------------------------------------------------

/**
 * How a source image entered the engine.
 * - UPLOAD: direct seller upload via presigned S3 PUT
 * - SUPPLIER_URL: sourced from the supplier's own website via the URL crawler (G03)
 */
export type ImageSourceMode = 'UPLOAD' | 'SUPPLIER_URL';

/**
 * Lifecycle status of an Image_Job.
 * Valid transitions:
 *   QUEUED → PROCESSING → COMPLETED
 *   QUEUED | PROCESSING → FAILED
 *   PROCESSING → REJECTED (moderation)
 * Terminal: COMPLETED, FAILED, REJECTED.
 */
export type ImageJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'REJECTED';

/** Moderation outcome for a source image. */
export interface ModerationResult {
  /** True when the image passed moderation and may be processed. */
  passed: boolean;
  /** Disallowed labels (with the triggering category names) when rejected. */
  rejectedLabels?: string[];
}

/** Enhancement (Stable Image Inpaint) outcome for a source image. */
export interface EnhancementResult {
  /** True when enhancement was attempted (image flagged weak + feature enabled). */
  attempted: boolean;
  /** True when the enhanced result was used. */
  applied: boolean;
  /** Populated when enhancement was skipped or fell back to the deterministic hero. */
  skippedReason?: string;
}

/** A single per-channel rendition of a processed image. */
export interface ImageVariant {
  /** Target marketplace channel. */
  channel: ChannelId;
  /** S3 key in the assets bucket. */
  s3Key: string;
  /** Output width in pixels. */
  width: number;
  /** Output height in pixels. */
  height: number;
  /** True when the source was below the channel minimum and bicubic-upscaled. */
  upscaled: boolean;
}

// ---------------------------------------------------------------------------
// Image Job
// ---------------------------------------------------------------------------

/** Structured error recorded on a failed Image_Job. */
export interface ImageJobError {
  code: string;
  message: string;
}

/**
 * An Image_Job: one unit of image-processing work for a product and tenant.
 * Stored in DynamoDB: PK TENANT#{tenantId}, SK IMAGEJOB#{imageJobId}.
 */
export interface ImageJob {
  imageJobId: string;
  tenantId: string;
  productId: string;
  sourceMode: ImageSourceMode;
  status: ImageJobStatus;
  /** Raw-uploads S3 keys of the source image(s) for this job. */
  sourceKeys: string[];
  /** The imageId chosen as the hero, once background removal completes. */
  heroImageId?: string;
  /** Per-channel variants produced for the hero/gallery images. */
  variants: ImageVariant[];
  /** Moderation outcome (set after the moderation step). */
  moderation?: ModerationResult;
  /** Enhancement outcome (set when the enhance step runs or is skipped). */
  enhancement?: EnhancementResult;
  /** True when background-removal confidence was low and manual review is advised. */
  reviewRecommended: boolean;
  /** Structured failure detail when status is FAILED. */
  error?: ImageJobError;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Unix timestamp — DynamoDB TTL (365 days from creation). */
  ttl: number;
}
