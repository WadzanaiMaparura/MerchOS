/**
 * Packager processor — resizes the Hero_Image into per-channel variants.
 *
 * For each channel spec: fit the hero onto the channel's square dimensions,
 * preserving aspect ratio with white padding. When the source is below a
 * channel's minimum resolution, upscale with bicubic interpolation and flag the
 * variant as `upscaled`. Variants are written to the assets bucket.
 *
 * Sharp is provided by a Lambda layer (external module).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { ALL_CHANNEL_SPECS, isUpscaleRequired, type ChannelSpec } from '../utils/channel-specs';
import type { ImageVariant } from '../types/image.types';

// Re-export for backward compatibility with callers/tests that imported it here.
export { isUpscaleRequired };

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 } as const;

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

export interface PackageVariantsParams {
  /** Assets bucket (hero source + variant destination). */
  bucket: string;
  /** S3 key of the hero image. */
  heroKey: string;
  /** Longest-edge dimension of the hero (from background-removal). */
  heroEdge: number;
  /** Destination key prefix: images/{tenantId}/{productId} */
  destPrefix: string;
  /** Channel specs to produce (defaults to ALL_CHANNEL_SPECS). */
  specs?: readonly ChannelSpec[];
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
 * Produce one variant per channel spec and write each to the assets bucket.
 * Returns the variant descriptors for persistence on the product.
 */
export async function packageVariants(
  params: PackageVariantsParams,
): Promise<ImageVariant[]> {
  const { bucket, heroKey, heroEdge, destPrefix } = params;
  const specs = params.specs ?? ALL_CHANNEL_SPECS;

  const heroBuffer = await readObject(bucket, heroKey);
  const variants: ImageVariant[] = [];

  for (const spec of specs) {
    const upscaled = isUpscaleRequired(heroEdge, spec);

    // fit: 'contain' preserves aspect ratio with white padding; kernel
    // 'cubic' provides bicubic interpolation for upscales (requirement 4.3).
    const variantBuffer = await sharp(heroBuffer)
      .resize(spec.width, spec.height, {
        fit: 'contain',
        background: WHITE,
        kernel: 'cubic',
        withoutEnlargement: false,
      })
      .flatten({ background: WHITE })
      .jpeg({ quality: 90 })
      .toBuffer();

    const s3Key = `${destPrefix}/${spec.channel}/${spec.width}x${spec.height}.jpg`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: variantBuffer,
        ContentType: 'image/jpeg',
      }),
    );

    variants.push({
      channel: spec.channel,
      s3Key,
      width: spec.width,
      height: spec.height,
      upscaled,
    });
  }

  return variants;
}

// ---------------------------------------------------------------------------
// Lambda handler (Step Functions task)
// ---------------------------------------------------------------------------

import type { WorkflowInput, PackagerStepResult } from '../types/workflow.types';

/**
 * Packager task input: the original workflow input plus the background-removal
 * result (hero key + edge), threaded by the state machine.
 */
interface PackagerEvent extends WorkflowInput {
  heroKey: string;
  heroEdge: number;
}

/**
 * Produces per-channel variants from the hero image and returns their
 * descriptors for persistence.
 */
export async function handler(event: PackagerEvent): Promise<PackagerStepResult> {
  const destPrefix = `images/${event.tenantId}/${event.productId}`;
  const variants = await packageVariants({
    bucket: event.assetsBucket,
    heroKey: event.heroKey,
    heroEdge: event.heroEdge,
    destPrefix,
  });
  return { variants };
}
