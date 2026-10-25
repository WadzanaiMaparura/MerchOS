/**
 * Persist processor — writes the processed image variants onto the canonical
 * product and finalises the Image_Job.
 *
 * On success: builds `CanonicalImageRef[]` and updates the product's
 * `content.imageRefs` via a tenant-conditioned UpdateCommand on the Products
 * table (the unified G07 data model), transitions the Image_Job to COMPLETED,
 * and emits `ImageProcessingCompleted`.
 *
 * This Lambda is also the workflow's failure recorder (action RECORD_FAILURE,
 * mirroring the Supplier Intelligence pattern): it sets the job FAILED and
 * emits `ImageProcessingFailed`.
 *
 * Requirements: 4.5, 7.2, 7.3, 7.5
 */

import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CanonicalImageRef } from '@merch-os/types';
import type { ImageVariant } from '../types/image.types';
import { updateImageJobStatus } from '../utils/image-job-status';
import {
  emitImageProcessingCompleted,
  emitImageProcessingFailed,
} from '../utils/event-emitter';
import { countMetric, IMAGE_METRICS } from '../utils/metrics';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

let ddbDocClient: DynamoDBDocumentClient | null = null;
function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({ region });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

/** Allow test code to inject a mock DynamoDB document client. */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// Variant → CanonicalImageRef mapping
// ---------------------------------------------------------------------------

/**
 * Build `CanonicalImageRef[]` from the hero + per-channel variants. The hero is
 * position 0; variants follow. Dimensions come from each variant.
 */
export function buildImageRefs(
  heroKey: string,
  heroEdge: number,
  variants: ImageVariant[],
): CanonicalImageRef[] {
  const refs: CanonicalImageRef[] = [
    {
      imageId: randomUUID(),
      s3Key: heroKey,
      position: 0,
      altText: null,
      mimeType: 'image/jpeg',
      width: heroEdge,
      height: heroEdge,
      fileSize: 0,
      variantId: null,
    },
  ];

  variants.forEach((v, idx) => {
    refs.push({
      imageId: randomUUID(),
      s3Key: v.s3Key,
      position: idx + 1,
      altText: null,
      mimeType: 'image/jpeg',
      width: v.width,
      height: v.height,
      fileSize: 0,
      variantId: v.channel,
    });
  });

  return refs;
}

// ---------------------------------------------------------------------------
// Persist (success path)
// ---------------------------------------------------------------------------

export interface PersistImageRefsParams {
  tenantId: string;
  productId: string;
  imageJobId: string;
  heroKey: string;
  heroEdge: number;
  variants: ImageVariant[];
  /** Products table name (reads PRODUCTS_TABLE_NAME env var if omitted). */
  productsTableName?: string;
  /** Image jobs table name (reads IMAGE_JOBS_TABLE env var if omitted). */
  imageJobsTableName?: string;
}

/**
 * Write the processed image refs onto the canonical product and complete the job.
 */
export async function persistImageRefs(params: PersistImageRefsParams): Promise<{
  imageRefs: CanonicalImageRef[];
}> {
  const { tenantId, productId, imageJobId, heroKey, heroEdge, variants } = params;

  const productsTableName = params.productsTableName ?? process.env['PRODUCTS_TABLE_NAME'];
  if (!productsTableName) {
    throw new Error(
      'Products table name is required. Pass productsTableName or set PRODUCTS_TABLE_NAME.',
    );
  }

  const imageRefs = buildImageRefs(heroKey, heroEdge, variants);
  const now = new Date().toISOString();
  const client = getDynamoDocClient();

  // Tenant-conditioned update of the nested content.imageRefs on the canonical
  // product. attribute_exists(PK) guards that the product exists and belongs to
  // this tenant (PK is TENANT#{tenantId}).
  await client.send(
    new UpdateCommand({
      TableName: productsTableName,
      Key: { PK: `TENANT#${tenantId}`, SK: `PRODUCT#${productId}` },
      UpdateExpression: 'SET content.imageRefs = :refs, updatedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: {
        ':refs': imageRefs,
        ':now': now,
      },
    }),
  );

  // Flip the Image_Job to COMPLETED (from PROCESSING).
  await updateImageJobStatus({
    ...(params.imageJobsTableName ? { tableName: params.imageJobsTableName } : {}),
    tenantId,
    imageJobId,
    currentStatus: 'PROCESSING',
    newStatus: 'COMPLETED',
  });

  await emitImageProcessingCompleted({
    tenantId,
    productId,
    imageJobId,
    heroImageId: imageRefs[0]?.imageId ?? null,
    variants,
  });

  countMetric(IMAGE_METRICS.jobCompleted);

  return { imageRefs };
}

// ---------------------------------------------------------------------------
// Record failure (workflow HandleFailure path)
// ---------------------------------------------------------------------------

export interface RecordFailureParams {
  tenantId: string;
  productId: string;
  imageJobId: string;
  currentStatus: 'QUEUED' | 'PROCESSING';
  error: { code: string; message: string };
  imageJobsTableName?: string;
}

/** Record an Image_Job failure and emit the failed event. */
export async function recordFailure(params: RecordFailureParams): Promise<void> {
  const { tenantId, productId, imageJobId, currentStatus, error } = params;

  await updateImageJobStatus({
    ...(params.imageJobsTableName ? { tableName: params.imageJobsTableName } : {}),
    tenantId,
    imageJobId,
    currentStatus,
    newStatus: 'FAILED',
  });

  await emitImageProcessingFailed({ tenantId, productId, imageJobId, error });
  countMetric(IMAGE_METRICS.jobFailed);
}

// ---------------------------------------------------------------------------
// Lambda handler (Step Functions task — success path and failure recorder)
// ---------------------------------------------------------------------------

import type { ImageVariant as _ImageVariant } from '../types/image.types';

/** Union of the two payload shapes this Lambda is invoked with. */
type PersistEvent =
  | {
      action: 'RECORD_FAILURE';
      tenantId: string;
      productId: string;
      imageJobId: string;
      error: { code: string; message: string };
      currentStatus?: 'QUEUED' | 'PROCESSING';
    }
  | {
      tenantId: string;
      productId: string;
      imageJobId: string;
      heroKey: string;
      heroEdge: number;
      variants: _ImageVariant[];
    };

/**
 * Routes by `action`: RECORD_FAILURE marks the job FAILED and emits the failed
 * event; otherwise the success path persists imageRefs and completes the job.
 */
export async function handler(event: PersistEvent): Promise<{ status: string }> {
  if ('action' in event && event.action === 'RECORD_FAILURE') {
    await recordFailure({
      tenantId: event.tenantId,
      productId: event.productId,
      imageJobId: event.imageJobId,
      currentStatus: event.currentStatus ?? 'PROCESSING',
      error: event.error,
    });
    return { status: 'FAILED' };
  }

  await persistImageRefs({
    tenantId: event.tenantId,
    productId: event.productId,
    imageJobId: event.imageJobId,
    heroKey: event.heroKey,
    heroEdge: event.heroEdge,
    variants: event.variants,
  });
  return { status: 'COMPLETED' };
}
