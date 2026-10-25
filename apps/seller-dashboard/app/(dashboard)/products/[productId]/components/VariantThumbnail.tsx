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

/**
 * Renders a single processed image variant, resolving a short-lived CloudFront
 * signed URL via the Image Intelligence Engine. The assets bucket is private, so
 * a signed URL is the only way to display the image.
 */
export function VariantThumbnail({ variant, imageIdOverride, altText }: VariantThumbnailProps) {
  // Derive the image id for signing. Prefer the explicit override; otherwise use
  // the last path segment of the s3 key (…/{channel}/{WxH}.jpg → unavailable),
  // so an override is required for signing to be attempted.
  const imageId = imageIdOverride;
  const { data, isLoading, isError } = useImageSignedUrl(imageId, variant.channel);

  const label = altText ?? `${variant.channel} variant`;

  if (!imageId) {
    // No id to sign with — render a neutral placeholder (shouldn't happen in
    // normal flows; guards against an incomplete variant).
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
        {isLoading && (
          <div className="h-full w-full animate-pulse bg-gray-200" aria-hidden="true" />
        )}
        {isError && (
          <div className="flex h-full w-full items-center justify-center text-xs text-red-500">
            Unavailable
          </div>
        )}
        {data?.url && (
          <img
            src={data.url}
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
