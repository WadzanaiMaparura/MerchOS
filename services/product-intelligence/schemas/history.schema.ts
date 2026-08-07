import { z } from 'zod';
import { generationTypeEnum } from './generate.schema.js';

/**
 * Schema for validating history query parameters.
 * Supports pagination via limit and lastEvaluatedKey cursor, with optional type filtering.
 * Validates: Requirements 16.3, 16.6
 */
export const historyQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit must not exceed 100')
    .default(20),
  lastEvaluatedKey: z.string().min(1, 'lastEvaluatedKey must not be empty').optional(),
  type: generationTypeEnum.optional(),
});

export type HistoryQueryInput = z.infer<typeof historyQuerySchema>;
