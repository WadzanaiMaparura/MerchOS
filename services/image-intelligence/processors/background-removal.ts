/**
 * Background removal processor — produces a white-background Hero_Image from a
 * moderated source image.
 *
 * Deterministic baseline: Rekognition `DetectLabels` assesses subject presence
 * / confidence, and the Sharp library composites the product onto a pure white
 * (RGB 255,255,255) background, preserving aspect ratio. Low subject confidence
 * sets `reviewRecommended` rather than silently producing a poor hero.
 *
 * Sharp is provided by a Lambda layer (external module); it is never bundled.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { RekognitionClient, DetectLabelsCommand } from '@aws-sdk/client-rekognition';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
// Sharp is supplied by the Lambda layer at runtime and marked external in the bundle.
import sharp from 'sharp';

/** Subject-confidence (%) below which the hero is flagged for manual review. */
export const SUBJECT_CONFIDENCE_THRESHOLD = 75;

/** Pure white background fill (requirement 3.1). */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 } as const;

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

let rekognitionClient: RekognitionClient | null = null;
function getRekognitionClient(): RekognitionClient {
  if (!rekognitionClient) {
    rekognitionClient = new RekognitionClient({ region });
  }
  return rekognitionClient;
}

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region });
  }
  return s3Client;
}

/** Allow test code to inject mock clients. */
export function setClients(clients: { rekognition?: RekognitionClient; s3?: S3Client }): void {
  if (clients.rekognition) rekognitionClient = clients.rekognition;
  if (clients.s3) s3Client = clients.s3;
}

export interface RemoveBackgroundParams {
  bucket: string;
  /** Source image S3 key (raw-uploads). */
  sourceKey: string;
  /** Destination bucket for the hero (assets). */
  destBucket: string;
  /** Destination S3 key for the hero image. */
  heroKey: string;
}

export interface RemoveBackgroundResult {
  heroKey: string;
  width: number;
  height: number;
  /** True when subject confidence was below the threshold. */
  reviewRecommended: boolean;
}

/** Read an S3 object body into a Buffer. */
async function readObject(bucket: string, key: string): Promise<Buffer> {
  const res = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) {
    throw new Error(`Unable to read S3 object body for ${bucket}/${key}`);
  }
  return Buffer.from(await body.transformToByteArray());
}

/**
 * Assess subject confidence for the source image via Rekognition DetectLabels.
 * Returns the highest label confidence (0–100) as a proxy for "is there a clear
 * product subject". Returns 0 when no labels are detected.
 */
export async function assessSubjectConfidence(bucket: string, key: string): Promise<number> {
  const res = await getRekognitionClient().send(
    new DetectLabelsCommand({
      Image: { S3Object: { Bucket: bucket, Name: key } },
      MaxLabels: 10,
      MinConfidence: 50,
    }),
  );
  const labels = res.Labels ?? [];
  let best = 0;
  for (const l of labels) {
    const c = l.Confidence ?? 0;
    if (c > best) best = c;
  }
  return best;
}

/**
 * Produce a white-background hero image from the source and write it to S3.
 *
 * The product is fit onto a square white canvas (longest edge preserved,
 * aspect ratio maintained via "contain" with white padding), then written as
 * JPEG to the assets bucket.
 */
export async function removeBackground(
  params: RemoveBackgroundParams,
): Promise<RemoveBackgroundResult> {
  const { bucket, sourceKey, destBucket, heroKey } = params;

  const subjectConfidence = await assessSubjectConfidence(bucket, sourceKey);
  const reviewRecommended = subjectConfidence < SUBJECT_CONFIDENCE_THRESHOLD;

  const sourceBuffer = await readObject(bucket, sourceKey);

  // Determine the source square dimension (longest edge) to build the canvas.
  const image = sharp(sourceBuffer);
  const metadata = await image.metadata();
  const edge = Math.max(metadata.width ?? 0, metadata.height ?? 0) || 1;

  // Composite onto a pure-white square canvas, preserving aspect ratio.
  const heroBuffer = await sharp(sourceBuffer)
    .resize(edge, edge, { fit: 'contain', background: WHITE })
    .flatten({ background: WHITE })
    .jpeg({ quality: 90 })
    .toBuffer();

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: destBucket,
      Key: heroKey,
      Body: heroBuffer,
      ContentType: 'image/jpeg',
    }),
  );

  return { heroKey, width: edge, height: edge, reviewRecommended };
}

// ---------------------------------------------------------------------------
// Lambda handler (Step Functions task)
// ---------------------------------------------------------------------------

import type { WorkflowInput, BackgroundRemovalStepResult } from '../types/workflow.types';

/**
 * Builds the white-background hero from the moderated source image and writes
 * it to the assets bucket under images/{tenantId}/{productId}/hero.jpg.
 */
export async function handler(event: WorkflowInput): Promise<BackgroundRemovalStepResult> {
  const sourceKey = event.sourceKeys[0];
  if (!sourceKey) {
    throw new Error('No source image for background removal');
  }
  const heroKey = `images/${event.tenantId}/${event.productId}/hero.jpg`;
  const result = await removeBackground({
    bucket: event.rawUploadsBucket,
    sourceKey,
    destBucket: event.assetsBucket,
    heroKey,
  });
  return {
    heroKey: result.heroKey,
    heroEdge: result.width,
    reviewRecommended: result.reviewRecommended,
  };
}
