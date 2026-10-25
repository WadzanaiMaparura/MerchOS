'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRole } from '@merch-os/auth';
import {
  useRequestUploadUrl,
  useStartImageProcessing,
  useImageJob,
  type ImageJob,
  type ImageVariant,
} from '@merch-os/api-client';
import { FileUpload, ModerationBadge, Badge, Alert } from '@merch-os/ui';
import type { ImageReference, ChannelId } from '@merch-os/types';
import { VariantThumbnail } from './VariantThumbnail';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_IMAGES = 15;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const CHANNEL_LABELS: Record<ChannelId, string> = {
  takealot: 'Takealot',
  amazon: 'Amazon',
  makro: 'Makro',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  custom: 'Custom',
};

/** Maps an Image_Job status to a human sentence for the ARIA live region. */
const STATUS_MESSAGE: Record<ImageJob['status'], string> = {
  QUEUED: 'Image queued for processing…',
  PROCESSING: 'Processing image (moderation, hero, variants)…',
  COMPLETED: 'Image processing complete.',
  FAILED: 'Image processing failed.',
  REJECTED: 'Image rejected by content moderation.',
};

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProductImageGalleryProps {
  /** The product ID these images belong to */
  productId: string;
  /** Existing processed images on the product (canonical content.imageRefs). */
  images: ImageReference[];
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ProductImageGallery — manages product images via the Image Intelligence Engine.
 *
 * Async flow (Phase 7, Option 1):
 *   1. request a presigned upload URL
 *   2. PUT the file bytes directly to S3
 *   3. start the processing workflow → imageJobId
 *   4. poll the Image_Job until terminal, surfacing status + moderation outcome
 *   5. render per-channel variants served via CloudFront signed URLs
 *
 * Validates: Requirements 1.*, 2.4, 3.4, 4.*, 7.1
 */
export function ProductImageGallery({ productId, images }: ProductImageGalleryProps) {
  const role = useRole();
  const canUpload = role === 'editor' || role === 'admin' || role === 'owner';
  const isAtLimit = images.length >= MAX_IMAGES;

  const requestUploadUrl = useRequestUploadUrl();
  const startProcessing = useStartImageProcessing();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | undefined>(undefined);
  const [isUploading, setIsUploading] = useState(false);

  const { data: job } = useImageJob(activeJobId);

  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) => {
      if (a.isHero && !b.isHero) return -1;
      if (!a.isHero && b.isHero) return 1;
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
  }, [images]);

  // ─── Upload → process (async pipeline) ─────────────────────────────────────

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      setUploadError(null);

      if (isAtLimit) {
        setUploadError(
          `Maximum of ${MAX_IMAGES} images reached. Remove an image before uploading more.`,
        );
        return;
      }

      const file = files[0];
      if (!file) return;

      setIsUploading(true);
      try {
        // 1. Presigned S3 PUT URL.
        const presign = await requestUploadUrl.mutateAsync({
          productId,
          fileName: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
        });

        // 2. PUT the file bytes directly to S3 (bypasses our API entirely).
        const put = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
        if (!put.ok) {
          throw new Error(`Upload to storage failed (${put.status})`);
        }

        // 3. Start the processing workflow for the uploaded source key.
        const started = await startProcessing.mutateAsync({
          productId,
          sourceKeys: [presign.s3Key],
        });

        // 4. Poll the job for status/moderation/variants.
        setActiveJobId(started.imageJobId);
      } catch (err: unknown) {
        const message =
          err && typeof err === 'object' && 'message' in err
            ? (err as { message: string }).message
            : 'Upload failed. Please try again.';
        setUploadError(message);
      } finally {
        setIsUploading(false);
      }
    },
    [productId, isAtLimit, requestUploadUrl, startProcessing],
  );

  const jobInFlight =
    isUploading || (job != null && (job.status === 'QUEUED' || job.status === 'PROCESSING'));

  return (
    <section aria-labelledby="image-gallery-heading" className="flex flex-col gap-4">
      <h2 id="image-gallery-heading" className="text-lg font-semibold text-gray-900">
        Images ({images.length}/{MAX_IMAGES})
      </h2>

      {uploadError && (
        <Alert variant="error" dismissible onDismiss={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}

      {/* Upload area (editor+ only) */}
      {canUpload && (
        <div className="max-w-md">
          <FileUpload
            label="Upload Image"
            acceptedTypes={ACCEPTED_TYPES}
            maxSizeBytes={MAX_FILE_SIZE_BYTES}
            multiple={false}
            onFilesSelected={handleFilesSelected}
            disabled={isAtLimit || jobInFlight}
            hint={
              isAtLimit
                ? `Limit of ${MAX_IMAGES} images reached`
                : 'JPEG, PNG, WebP, or HEIC up to 10 MB'
            }
            error={
              isAtLimit
                ? `Maximum of ${MAX_IMAGES} images reached. Remove an image before uploading more.`
                : undefined
            }
            aria-label="Upload product image"
          />
        </div>
      )}

      {/* Processing status — announced to assistive tech */}
      {job && (
        <div aria-live="polite">
          <ImageJobStatus job={job} />
        </div>
      )}
      {isUploading && !job && (
        <p className="text-sm text-gray-500" aria-live="polite">
          Uploading image…
        </p>
      )}

      {/* Existing processed images */}
      {sortedImages.length === 0 ? (
        <p className="text-sm text-gray-500">No images processed yet.</p>
      ) : (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          role="list"
          aria-label="Product images"
        >
          {sortedImages.map((image) => (
            <ExistingImageThumbnail key={image.imageId} image={image} />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── ImageJobStatus ──────────────────────────────────────────────────────────

/**
 * Renders the current Image_Job status, including moderation rejection reasons
 * and whether AI enhancement was applied.
 */
export function ImageJobStatus({ job }: { job: ImageJob }) {
  const message = STATUS_MESSAGE[job.status];

  if (job.status === 'REJECTED') {
    return (
      <Alert variant="error" title="Image rejected by moderation">
        {job.moderation?.rejectedLabels?.length
          ? `Rejected for: ${job.moderation.rejectedLabels.join(', ')}.`
          : 'This image violates marketplace content policies.'}
      </Alert>
    );
  }

  if (job.status === 'FAILED') {
    return (
      <Alert variant="error" title="Image processing failed">
        {job.error?.message ?? 'Processing failed. Please try again.'}
      </Alert>
    );
  }

  if (job.status === 'COMPLETED') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-green-700">{message}</p>
        {job.reviewRecommended && (
          <Alert variant="warning">
            This image was flagged for manual review (low background-removal confidence).
          </Alert>
        )}
        {job.enhancement?.applied && (
          <p className="text-xs text-gray-500">AI enhancement applied to improve a weak photo.</p>
        )}
        {job.variants.length > 0 && <VariantGallery variants={job.variants} />}
      </div>
    );
  }

  // QUEUED / PROCESSING
  return (
    <p className="flex items-center gap-2 text-sm text-gray-600">
      <span className="h-3 w-3 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
      {message}
    </p>
  );
}

// ─── VariantGallery ──────────────────────────────────────────────────────────

/** Renders freshly processed per-channel variants, each via a signed URL. */
function VariantGallery({ variants }: { variants: ImageVariant[] }) {
  return (
    <div className="mt-2">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
        Channel variants
      </p>
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        role="list"
        aria-label="Processed channel variants"
      >
        {variants.map((variant) => (
          <VariantThumbnail key={`${variant.channel}-${variant.s3Key}`} variant={variant} />
        ))}
      </div>
    </div>
  );
}

// ─── ExistingImageThumbnail ──────────────────────────────────────────────────

/** A previously-processed image already on the product's content.imageRefs. */
function ExistingImageThumbnail({ image }: { image: ImageReference }) {
  const upscaleChannels = image.isUpscaled
    ? (Object.keys(image.channelKeys) as ChannelId[])
    : [];

  return (
    <div
      role="listitem"
      className={[
        'relative flex flex-col overflow-hidden rounded-lg border bg-white shadow-sm',
        image.isHero ? 'border-blue-300 ring-2 ring-blue-500' : 'border-gray-200',
      ].join(' ')}
    >
      <div className="relative aspect-square bg-gray-100">
        {/* Images are served via signed URLs; the thumbnail resolves its own. */}
        <VariantThumbnail
          variant={{
            channel: 'custom',
            s3Key: image.s3Key,
            width: 0,
            height: 0,
            upscaled: image.isUpscaled,
          }}
          imageIdOverride={image.imageId}
          altText={image.isHero ? 'Hero product image' : 'Product image'}
        />
        <div className="absolute left-2 top-2">
          <ModerationBadge status={image.moderationStatus} />
        </div>
        {image.isHero && (
          <div className="absolute right-2 top-2">
            <Badge variant="info" className="text-[10px]">Hero</Badge>
          </div>
        )}
        {upscaleChannels.length > 0 && (
          <div className="absolute bottom-2 left-2">
            <Badge variant="neutral" className="text-[10px]">
              Upscaled: {upscaleChannels.map((ch) => CHANNEL_LABELS[ch]).join(', ')}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProductImageGallery;
