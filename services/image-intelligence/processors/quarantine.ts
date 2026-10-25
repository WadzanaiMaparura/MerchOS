/**
 * Quarantine processor — handles a moderation-rejected source image.
 *
 * Copies the rejected source object into the assets quarantine prefix
 * (`images/{tenantId}/quarantine/`), transitions the Image_Job to REJECTED,
 * and emits `ImageModerationRejected`. The 30-day retention of the quarantine
 * prefix is enforced by the S3 lifecycle rule (Foundation follow-up).
 *
 * Requirements: 2.3, 2.4
 */

import { S3Client, CopyObjectCommand } from '@aws-sdk/client-s3';
import { updateImageJobStatus } from '../utils/image-job-status';
import { emitImageModerationRejected } from '../utils/event-emitter';
import { countMetric, IMAGE_METRICS } from '../utils/metrics';
import type { WorkflowInput, ModerationStepResult } from '../types/workflow.types';

const region = process.env['AWS_REGION'] ?? 'eu-west-1';

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

export interface QuarantineParams {
  rawUploadsBucket: string;
  assetsBucket: string;
  sourceKey: string;
  tenantId: string;
  productId: string;
  imageJobId: string;
  rejectedLabels: string[];
}

/** Copy the rejected image to quarantine, mark the job REJECTED, emit event. */
export async function quarantineImage(params: QuarantineParams): Promise<void> {
  const {
    rawUploadsBucket,
    assetsBucket,
    sourceKey,
    tenantId,
    productId,
    imageJobId,
    rejectedLabels,
  } = params;

  const ts = Date.now();
  const fileName = sourceKey.split('/').pop() ?? `${imageJobId}.img`;
  const quarantineKey = `images/${tenantId}/quarantine/${ts}_${fileName}`;

  await getS3Client().send(
    new CopyObjectCommand({
      Bucket: assetsBucket,
      CopySource: `${rawUploadsBucket}/${sourceKey}`,
      Key: quarantineKey,
    }),
  );

  await updateImageJobStatus({
    tenantId,
    imageJobId,
    currentStatus: 'PROCESSING',
    newStatus: 'REJECTED',
  });

  await emitImageModerationRejected({ tenantId, productId, imageJobId, rejectedLabels });
  countMetric(IMAGE_METRICS.moderationRejected);
}

// ---------------------------------------------------------------------------
// Lambda handler (Step Functions task)
// ---------------------------------------------------------------------------

/** Quarantine task input: workflow input merged with the moderation result. */
interface QuarantineEvent extends WorkflowInput {
  moderation: ModerationStepResult;
}

export async function handler(event: QuarantineEvent): Promise<{ status: string }> {
  await quarantineImage({
    rawUploadsBucket: event.rawUploadsBucket,
    assetsBucket: event.assetsBucket,
    sourceKey: event.moderation.sourceKey,
    tenantId: event.tenantId,
    productId: event.productId,
    imageJobId: event.imageJobId,
    rejectedLabels: event.moderation.rejectedLabels ?? [],
  });
  return { status: 'REJECTED' };
}
