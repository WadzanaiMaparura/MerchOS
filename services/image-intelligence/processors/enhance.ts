/**
 * Enhance processor — optional AI cleanup of a weak hero image via the Bedrock
 * enhancement model (Stable Image Inpaint), conditioned on the merchant's image.
 *
 * This step is a BOOSTER, never a dependency:
 *  - It only runs when the photo was flagged weak AND the feature is enabled.
 *  - On any failure/timeout, or when disabled, it falls back to the deterministic
 *    hero and records why — it never fails the Image_Job (requirement 5.5).
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 7.5
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  invokeEnhancementModel,
  isEnhancementEnabled,
} from '../services/enhancement-model';
import { countMetric, IMAGE_METRICS } from '../utils/metrics';
import type { EnhancementResult } from '../types/image.types';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

/** Prompt guiding background cleanup for a product photo. */
const ENHANCEMENT_PROMPT =
  'Clean, professional product photo on a plain white background, well lit, no clutter';

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

/** Allow test code to inject a mock S3 client. */
export function setS3Client(client: S3Client): void {
  s3Client = client;
}

async function readObjectBase64(bucket: string, key: string): Promise<string> {
  const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) {
    throw new Error(`Unable to read S3 object body for ${bucket}/${key}`);
  }
  return Buffer.from(await body.transformToByteArray()).toString('base64');
}

export interface EnhanceParams {
  bucket: string;
  /** Deterministic hero key (also the write target if enhancement is applied). */
  heroKey: string;
  /** Whether the photo was flagged weak by background removal. */
  weak: boolean;
}

/**
 * Decide whether enhancement should run: only for weak photos, and only when the
 * feature flag is enabled in this environment/region.
 */
export function shouldEnhance(weak: boolean): boolean {
  return weak && isEnhancementEnabled();
}

/**
 * Attempt enhancement. Returns an EnhancementResult describing what happened.
 * Never throws for a model failure — the caller keeps the deterministic hero.
 */
export async function enhanceHero(params: EnhanceParams): Promise<EnhancementResult> {
  const { bucket, heroKey, weak } = params;

  if (!shouldEnhance(weak)) {
    return {
      attempted: false,
      applied: false,
      skippedReason: !weak ? 'photo-not-weak' : 'enhancement-disabled',
    };
  }

  countMetric(IMAGE_METRICS.enhancementInvoked);

  try {
    const sourceImageBase64 = await readObjectBase64(bucket, heroKey);
    const { imageBase64 } = await invokeEnhancementModel({
      sourceImageBase64,
      prompt: ENHANCEMENT_PROMPT,
    });

    // Overwrite the hero with the enhanced result (original source is preserved
    // separately in raw-uploads — requirement 5.6).
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: heroKey,
        Body: Buffer.from(imageBase64, 'base64'),
        ContentType: 'image/jpeg',
      }),
    );

    return { attempted: true, applied: true };
  } catch (error) {
    // Fallback: keep the deterministic hero, record why, do NOT fail the job.
    countMetric(IMAGE_METRICS.enhancementFailed);
    return {
      attempted: true,
      applied: false,
      skippedReason: `enhancement-failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Lambda handler (Step Functions task)
// ---------------------------------------------------------------------------

import type { WorkflowInput } from '../types/workflow.types';

/** Enhance task input: workflow input merged with the background-removal result. */
interface EnhanceEvent extends WorkflowInput {
  heroKey: string;
  heroEdge: number;
  reviewRecommended: boolean;
}

/**
 * Runs (or skips) enhancement, then returns the hero key/edge unchanged so the
 * packager step consumes the same hero regardless of whether enhancement ran.
 */
export async function handler(event: EnhanceEvent): Promise<{
  heroKey: string;
  heroEdge: number;
  enhancement: EnhancementResult;
}> {
  const enhancement = await enhanceHero({
    bucket: event.assetsBucket,
    heroKey: event.heroKey,
    weak: event.reviewRecommended,
  });
  return { heroKey: event.heroKey, heroEdge: event.heroEdge, enhancement };
}
