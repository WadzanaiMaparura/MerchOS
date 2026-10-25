/**
 * Zod request schemas for the Image Intelligence API.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.6
 */

import { z } from 'zod';

/** Supported source image content types (JPEG/PNG/WEBP/HEIC). */
export const SUPPORTED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

/** Maximum source image size (bytes) — 10 MB (requirement 1.3). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Request for a presigned upload URL.
 * The seller declares the filename, content type, and size; the handler
 * validates the type/size and returns a presigned S3 PUT URL.
 */
export const uploadUrlRequestSchema = z
  .object({
    productId: z.string().min(1),
    fileName: z.string().min(1).max(256),
    contentType: z.enum(SUPPORTED_CONTENT_TYPES),
    fileSizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
  })
  .strict();

export type UploadUrlRequest = z.infer<typeof uploadUrlRequestSchema>;

/**
 * Request to start processing one or more already-uploaded source images
 * for a product into channel-ready variants.
 */
export const startProcessRequestSchema = z
  .object({
    /** Raw-uploads S3 keys of the source images to process (from prior upload). */
    sourceKeys: z.array(z.string().min(1)).min(1).max(15),
  })
  .strict();

export type StartProcessRequest = z.infer<typeof startProcessRequestSchema>;
