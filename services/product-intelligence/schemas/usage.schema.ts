import { z } from 'zod';

/**
 * Schema for validating usage query parameters.
 * Supports filtering by period (daily or monthly).
 * Validates: Requirements 16.3, 16.6
 */
export const usageQuerySchema = z.object({
  period: z.enum(['daily', 'monthly'], {
    errorMap: () => ({ message: "Period must be 'daily' or 'monthly'" }),
  }).default('monthly'),
});

export type UsageQueryInput = z.infer<typeof usageQuerySchema>;
