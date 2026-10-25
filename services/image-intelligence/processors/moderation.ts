/**
 * Moderation processor — screens a source image with Amazon Rekognition
 * `DetectModerationLabels` before any other processing. Disallowed content at
 * or above the confidence threshold rejects the image.
 *
 * Requirements: 2.1, 2.2, 2.4, 2.5
 */

import { RekognitionClient, DetectModerationLabelsCommand } from '@aws-sdk/client-rekognition';
import type { ModerationResult } from '../types/image.types';

/** Confidence threshold (%) at or above which a disallowed label rejects the image. */
export const MODERATION_CONFIDENCE_THRESHOLD = 80;

/**
 * Top-level Rekognition moderation categories that are disallowed for
 * marketplace product imagery. Rekognition returns a hierarchy; matching on the
 * top-level parent name covers its subcategories.
 */
export const DISALLOWED_MODERATION_CATEGORIES: ReadonlySet<string> = new Set([
  'Explicit Nudity',
  'Nudity',
  'Sexual Activity',
  'Violence',
  'Visually Disturbing',
  'Drugs & Tobacco',
  'Drugs',
  'Hate Symbols',
]);

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

let rekognitionClient: RekognitionClient | null = null;
function getRekognitionClient(): RekognitionClient {
  if (!rekognitionClient) {
    rekognitionClient = new RekognitionClient({ region });
  }
  return rekognitionClient;
}

/** Allow test code to inject a mock Rekognition client. */
export function setRekognitionClient(client: RekognitionClient): void {
  rekognitionClient = client;
}

export interface ModerateParams {
  /** S3 bucket holding the source image. */
  bucket: string;
  /** S3 key of the source image. */
  key: string;
}

/**
 * Run moderation on a single S3 image object.
 *
 * Returns `{ passed: true }` when no disallowed label meets the threshold, or
 * `{ passed: false, rejectedLabels }` listing the triggering labels.
 */
export async function moderateImage(params: ModerateParams): Promise<ModerationResult> {
  const { bucket, key } = params;

  const response = await getRekognitionClient().send(
    new DetectModerationLabelsCommand({
      Image: { S3Object: { Bucket: bucket, Name: key } },
      // Only return labels at/above our threshold to minimise noise.
      MinConfidence: MODERATION_CONFIDENCE_THRESHOLD,
    }),
  );

  const labels = response.ModerationLabels ?? [];
  const rejected: string[] = [];

  for (const label of labels) {
    const confidence = label.Confidence ?? 0;
    if (confidence < MODERATION_CONFIDENCE_THRESHOLD) {
      continue;
    }
    // The triggering category is the top-level parent when present, else the
    // label's own name.
    const category = label.ParentName && label.ParentName.length > 0 ? label.ParentName : label.Name;
    if (category && DISALLOWED_MODERATION_CATEGORIES.has(category)) {
      rejected.push(category);
    }
  }

  if (rejected.length > 0) {
    // De-duplicate category names for a clean rejection reason.
    return { passed: false, rejectedLabels: Array.from(new Set(rejected)) };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Lambda handler (Step Functions task)
// ---------------------------------------------------------------------------

import type { WorkflowInput, ModerationStepResult } from '../types/workflow.types';
import { updateImageJobStatus } from '../utils/image-job-status';

/**
 * First workflow task: transitions the Image_Job QUEUED → PROCESSING, then
 * moderates the hero-candidate source image (the first source key). Returns the
 * moderation result plus the moderated source key for downstream steps.
 */
export async function handler(event: WorkflowInput): Promise<ModerationStepResult> {
  const sourceKey = event.sourceKeys[0];
  if (!sourceKey) {
    throw new Error('No source image to moderate');
  }

  // Move the job into PROCESSING as the first action of the pipeline.
  await updateImageJobStatus({
    tenantId: event.tenantId,
    imageJobId: event.imageJobId,
    currentStatus: 'QUEUED',
    newStatus: 'PROCESSING',
  });

  const result = await moderateImage({ bucket: event.rawUploadsBucket, key: sourceKey });
  return { ...result, sourceKey };
}
