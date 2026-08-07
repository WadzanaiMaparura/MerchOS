import { z } from 'zod';
import { generateRequestSchema } from './generate.schema.js';

/**
 * Schema for validating a batch generation request body.
 * Accepts an array of generation request items with an optional concurrency limit.
 * Validates: Requirements 16.3, 16.6
 */
export const batchGenerationRequestSchema = z.object({
  items: z
    .array(generateRequestSchema, { required_error: 'Items array is required' })
    .min(1, 'Items array must contain at least 1 item')
    .max(50, 'Items array must not exceed 50 items'),
  concurrencyLimit: z
    .number()
    .int('Concurrency limit must be an integer')
    .min(1, 'Concurrency limit must be at least 1')
    .max(20, 'Concurrency limit must not exceed 20')
    .default(5),
});

export type BatchGenerationRequestInput = z.infer<typeof batchGenerationRequestSchema>;
