'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useRole } from '@merch-os/auth';
import { useImageUpload, useSetHeroImage } from '@merch-os/api-client';
import { FileUpload, ModerationBadge, Badge, Alert } from '@merch-os/ui';
import type { ImageReference, ModerationStatus, ChannelId } from '@merch-os/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_IMAGES = 15;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const CHANNEL_LABELS: Record<ChannelId, string> = {
  takealot: 'Takealot',
  amazon: 'Amazon',
  makro: 'Makro',
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  custom: 'Custom',
};

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProductImageGalleryProps {
  /** The product ID these images belong to */
  productId: string;
  /** The list of images on the product */
  images: ImageReference[];
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ProductImageGallery — Reusable component for managing product images.
 *
 * Features:
 * - Upload images (JPEG, PNG, WebP up to 10 MB) for editor+ roles
 * - Display moderation status badge (APPROVED, REJECTED, PENDING)
 * - Hero image designation (only APPROVED images)
 * - Upscale indicator showing triggering channel
 * - Enforces max 15 images per product
 * - Error messages for upload failures
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */
export function ProductImageGallery({ productId, images }: ProductImageGalleryProps) {
  const role = useRole();
  const canUpload = role === 'editor' || role === 'admin' || role === 'owner';
  const isAtLimit = images.length >= MAX_IMAGES;

  const imageUpload = useImageUpload();
  const setHeroImage = useSetHeroImage();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [heroError, setHeroError] = useState<string | null>(null);

  // Sort images: hero first, then by uploadedAt descending
  const sortedImages = useMemo(() => {
    return [...images].sort((a, b) => {
      if (a.isHero && !b.isHero) return -1;
      if (!a.isHero && b.isHero) return 1;
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
  }, [images]);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      setUploadError(null);

      if (isAtLimit) {
        setUploadError(`Maximum of ${MAX_IMAGES} images reached. Remove an image before uploading more.`);
        return;
      }

      const file = files[0];
      if (!file) return;

      imageUpload.mutate(
        { productId, file },
        {
          onError: (error) => {
            const message = error.message || 'Upload failed due to a network error. Please try again.';
            setUploadError(message);
          },
          onSuccess: () => {
            setUploadError(null);
          },
        }
      );
    },
    [productId, imageUpload, isAtLimit]
  );

  const handleSetHero = useCallback(
    (image: ImageReference) => {
      setHeroError(null);

      if (image.moderationStatus !== 'APPROVED') {
        setHeroError('Only images with APPROVED moderation status can be set as the hero image.');
        return;
      }

      setHeroImage.mutate(
        { productId, imageId: image.imageId },
        {
          onError: (error) => {
            setHeroError(error.message || 'Failed to set hero image. Please try again.');
          },
          onSuccess: () => {
            setHeroError(null);
          },
        }
      );
    },
    [productId, setHeroImage]
  );

  // Determine which channels triggered upscale for a given image
  const getUpscaleChannels = useCallback((image: ImageReference): ChannelId[] => {
    if (!image.isUpscaled) return [];
    return Object.keys(image.channelKeys) as ChannelId[];
  }, []);

  return (
    <section aria-labelledby="image-gallery-heading" className="flex flex-col gap-4">
      <h2 id="image-gallery-heading" className="text-lg font-semibold text-gray-900">
        Images ({images.length}/{MAX_IMAGES})
      </h2>

      {/* Upload error */}
      {uploadError && (
        <Alert variant="error" dismissible onDismiss={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}

      {/* Hero designation error */}
      {heroError && (
        <Alert variant="error" dismissible onDismiss={() => setHeroError(null)}>
          {heroError}
        </Alert>
      )}

      {/* File Upload area (editor+ only) */}
      {canUpload && (
        <div className="max-w-md">
          <FileUpload
            label="Upload Image"
            acceptedTypes={ACCEPTED_TYPES}
            maxSizeBytes={MAX_FILE_SIZE_BYTES}
            multiple={false}
            onFilesSelected={handleFilesSelected}
            disabled={isAtLimit || imageUpload.isPending}
            hint={
              isAtLimit
                ? `Limit of ${MAX_IMAGES} images reached`
                : 'JPEG, PNG, or WebP up to 10 MB'
            }
            error={
              isAtLimit
                ? `Maximum of ${MAX_IMAGES} images reached. Remove an image before uploading more.`
                : undefined
            }
            aria-label="Upload product image"
          />
          {imageUpload.isPending && (
            <p className="mt-2 text-sm text-gray-500" aria-live="polite">
              Uploading image…
            </p>
          )}
        </div>
      )}

      {/* Image Gallery Grid */}
      {sortedImages.length === 0 ? (
        <p className="text-sm text-gray-500">No images uploaded yet.</p>
      ) : (
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
          role="list"
          aria-label="Product images"
        >
          {sortedImages.map((image) => (
            <ImageThumbnail
              key={image.imageId}
              image={image}
              canUpload={canUpload}
              upscaleChannels={getUpscaleChannels(image)}
              onSetHero={handleSetHero}
              isSettingHero={setHeroImage.isPending}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── ImageThumbnail Sub-component ────────────────────────────────────────────

interface ImageThumbnailProps {
  image: ImageReference;
  canUpload: boolean;
  upscaleChannels: ChannelId[];
  onSetHero: (image: ImageReference) => void;
  isSettingHero: boolean;
}

function ImageThumbnail({
  image,
  canUpload,
  upscaleChannels,
  onSetHero,
  isSettingHero,
}: ImageThumbnailProps) {
  // Construct the image URL from the s3Key (assuming a CDN prefix)
  const imageUrl = `/api/assets/${image.s3Key}`;

  return (
    <div
      role="listitem"
      className={[
        'relative flex flex-col rounded-lg border bg-white shadow-sm overflow-hidden',
        image.isHero ? 'ring-2 ring-blue-500 border-blue-300' : 'border-gray-200',
      ].join(' ')}
    >
      {/* Image */}
      <div className="relative aspect-square bg-gray-100">
        <img
          src={imageUrl}
          alt={image.isHero ? 'Hero product image' : 'Product image'}
          className="h-full w-full object-cover"
          loading="lazy"
        />

        {/* Moderation Status Badge - overlaid */}
        <div className="absolute top-2 left-2">
          <ModerationBadge status={image.moderationStatus} />
        </div>

        {/* Hero indicator */}
        {image.isHero && (
          <div className="absolute top-2 right-2">
            <Badge variant="info" className="text-[10px]">
              Hero
            </Badge>
          </div>
        )}

        {/* Upscale indicator */}
        {upscaleChannels.length > 0 && (
          <div className="absolute bottom-2 left-2">
            <Badge variant="neutral" className="text-[10px]">
              <span className="flex items-center gap-1">
                <UpscaleIcon />
                {upscaleChannels.map((ch) => CHANNEL_LABELS[ch]).join(', ')}
              </span>
            </Badge>
          </div>
        )}
      </div>

      {/* Actions */}
      {canUpload && !image.isHero && (
        <div className="p-2">
          <button
            type="button"
            onClick={() => onSetHero(image)}
            disabled={isSettingHero}
            className="w-full rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Set as hero image${image.moderationStatus !== 'APPROVED' ? ' (only approved images allowed)' : ''}`}
          >
            Set as Hero
          </button>
        </div>
      )}

      {/* Hero label for current hero */}
      {image.isHero && (
        <div className="p-2 text-center">
          <span className="text-xs font-medium text-blue-700">Current Hero</span>
        </div>
      )}
    </div>
  );
}

// ─── Upscale Icon ────────────────────────────────────────────────────────────

function UpscaleIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3 w-3"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L6.707 7.707a1 1 0 01-1.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export default ProductImageGallery;
