/**
 * Strict Zod schemas for the Inventory API. All object schemas use `.strict()`
 * so unexpected or system-managed fields (tenantId, available, reserved,
 * updatedAt, sku, etc.) are rejected rather than silently ignored.
 */

import { z } from 'zod';

/**
 * PUT /inventory/{sku} body.
 *
 * The path {sku} is authoritative; the body intentionally has NO `sku` field,
 * and `.strict()` rejects any attempt to supply one (or any other field).
 * `onHand` is an absolute, non-negative integer.
 */
export const updateInventorySchema = z
  .object({
    warehouseId: z.string().min(1, 'warehouseId is required'),
    onHand: z
      .number({ invalid_type_error: 'onHand must be a number' })
      .int('onHand must be an integer')
      .nonnegative('onHand must be non-negative'),
  })
  .strict();

export type UpdateInventoryBody = z.infer<typeof updateInventorySchema>;

/** Pagination query parameters shared by list endpoints. */
export const paginationQuerySchema = z
  .object({
    limit: z
      .preprocess(
        (v) => (v === undefined || v === '' ? undefined : Number(v)),
        z.number().int().positive().max(100).optional()
      )
      .optional(),
    nextToken: z.string().min(1).optional(),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
