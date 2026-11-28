'use client';

import React from 'react';
import { useImageSignedUrl, type ImageVariant } from '@merch-os/api-client';
import { Badge } from '@merch-os/ui';

export interface VariantThumbnailProps {
  /** The processed variant to display. */
  variant: ImageVariant;
  /**
   * Image id used to request a signed URL. For freshly-processed variants the
   * caller passes the owning image's id; for existing images it's the imageRef id.
   */
  imageIdOverride?: string;
  /** Accessible alt text; defaults to a channel-labelled description. */
  altText?: string;
}

/** Images imported from a supplier's web address are shown as they are. */
function isWebAddress(key: string | undefined): key is string {
  return !!key && /^https?:\/\//i.test(key);
}

/**
 * Renders a single processed image variant. Our own images are private, so the
 * thumbnail asks for a short-lived CloudFront signed URL for the image's stored
 * key (variant.s3Key); supplier web addresses are used directly.
 */
export function VariantThumbnail({ variant, imageIdOverride, altText }: VariantThumbnailProps) {
  const external = isWebAddress(variant.s3Key);
  // Any id works for the route; the stored key decides which image is signed.
  const imageId = external ? undefined : imageIdOverride ?? (variant.s3Key ? 'stored' : undefined);
  const { data, isLoading, isError } = useImageSignedUrl(imageId, variant.channel, external ? undefined : variant.s3Key);
  const src = external ? variant.s3Key : data?.url;

  const label = altText ?? `${variant.channel} variant`;

  if (!external && !imageId) {
    // Nothing to show (an incomplete variant).
    return (
      <div
        role="listitem"
        className="flex aspect-square items-center justify-center rounded-md bg-gray-100 text-xs text-gray-400"
      >
        {variant.channel}
      </div>
    );
  }

  return (
    <figure role="listitem" className="flex flex-col gap-1">
      <div className="relative aspect-square overflow-hidden rounded-md bg-gray-100">
        {!external && isLoading && (
          <div className="h-full w-full animate-pulse bg-gray-200" aria-hidden="true" />
        )}
        {!external && isError && (
          <div className="flex h-full w-full items-center justify-center text-xs text-red-500">
            Unavailable
          </div>
        )}
        {src && (
          <img
            src={src}
            alt={label}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
        {variant.upscaled && (
          <div className="absolute bottom-1 left-1">
            <Badge variant="neutral" className="text-[10px]">Upscaled</Badge>
          </div>
        )}
      </div>
      <figcaption className="text-center text-[10px] text-gray-500">
        {variant.channel}
        {variant.width > 0 ? ` · ${variant.width}×${variant.height}` : ''}
      </figcaption>
    </figure>
  );
}

export default VariantThumbnail;
