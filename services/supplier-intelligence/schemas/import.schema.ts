import { z } from 'zod';

/** Maximum file size: 50MB */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Supported file content types for file-based imports */
const SUPPORTED_FILE_CONTENT_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/zip',
] as const;

/** Supported image content types for image-based imports */
const SUPPORTED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
] as const;

/**
 * Schema for triggering a file-based import (CSV, Excel, PDF, ZIP).
 * Enforces max file size of 50MB and valid content types.
 * Validates: Requirements 2.7, 12.4
 */
export const triggerFileImportSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  contentType: z.enum(SUPPORTED_FILE_CONTENT_TYPES, {
    errorMap: () => ({
      message: `Content type must be one of: ${SUPPORTED_FILE_CONTENT_TYPES.join(', ')}`,
    }),
  }),
  fileSizeBytes: z
    .number({ required_error: 'File size is required' })
    .int('File size must be an integer')
    .positive('File size must be positive')
    .max(MAX_FILE_SIZE_BYTES, `File size must not exceed ${MAX_FILE_SIZE_BYTES} bytes (50MB)`),
});

export type TriggerFileImportInput = z.infer<typeof triggerFileImportSchema>;

/**
 * Schema for triggering an image-based import (OCR extraction).
 * Validates: Requirements 12.4
 */
export const triggerImageImportSchema = z.object({
  images: z
    .array(
      z.object({
        fileName: z.string().min(1, 'Image file name is required'),
        contentType: z.enum(SUPPORTED_IMAGE_CONTENT_TYPES, {
          errorMap: () => ({
            message: `Image content type must be one of: ${SUPPORTED_IMAGE_CONTENT_TYPES.join(', ')}`,
          }),
        }),
        fileSizeBytes: z
          .number({ required_error: 'File size is required' })
          .int('File size must be an integer')
          .positive('File size must be positive')
          .max(MAX_FILE_SIZE_BYTES, `File size must not exceed ${MAX_FILE_SIZE_BYTES} bytes (50MB)`),
      }),
    )
    .min(1, 'At least one image is required'),
});

export type TriggerImageImportInput = z.infer<typeof triggerImageImportSchema>;

/**
 * Schema for triggering a URL-based import (web crawling).
 * Enforces valid URL format and crawl depth between 1-5.
 * Validates: Requirements 4.3, 12.4
 */
export const triggerUrlImportSchema = z.object({
  url: z.string().url('Invalid URL format'),
  crawlDepth: z
    .number()
    .int('Crawl depth must be an integer')
    .min(1, 'Crawl depth must be at least 1')
    .max(5, 'Crawl depth must not exceed 5')
    .default(3),
});

export type TriggerUrlImportInput = z.infer<typeof triggerUrlImportSchema>;
