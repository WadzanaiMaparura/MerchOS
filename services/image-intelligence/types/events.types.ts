/**
 * EventBridge event type definitions for the Image Intelligence Engine.
 *
 * Source: "merch-os.image-intelligence"
 *
 * Requirements: 2.3, 7.2, 7.3
 */

import type { ImageVariant } from './image.types';

/** EventBridge `source` for all Image Intelligence events. */
export const IMAGE_INTELLIGENCE_EVENT_SOURCE = 'merch-os.image-intelligence' as const;

/** Emitted when an Image_Job completes successfully. */
export interface ImageProcessingCompletedEvent {
  detail: {
    tenantId: string;
    productId: string;
    imageJobId: string;
    heroImageId: string | null;
    variants: ImageVariant[];
  };
}

/** Emitted when an Image_Job fails. */
export interface ImageProcessingFailedEvent {
  detail: {
    tenantId: string;
    productId: string;
    imageJobId: string;
    error: { code: string; message: string };
  };
}

/** Emitted when a source image is rejected by content moderation. */
export interface ImageModerationRejectedEvent {
  detail: {
    tenantId: string;
    productId: string;
    imageJobId: string;
    rejectedLabels: string[];
  };
}
