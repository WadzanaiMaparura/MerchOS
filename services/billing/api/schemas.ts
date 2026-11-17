import { z } from 'zod';

/**
 * POST /billing/plan — initiate a plan change / subscription checkout.
 *
 * `returnUrl` / `cancelUrl` are where PayFast sends the buyer back after the
 * hosted payment page. They are optional; the handler falls back to env
 * defaults (the seller-dashboard billing page) when omitted. `.strict()`
 * rejects any unexpected field (e.g. an attempt to inject amount/price).
 */
export const changePlanSchema = z
  .object({
    planId: z.enum(['starter', 'growth', 'professional', 'enterprise']),
    /** Optional discount voucher. The server prices it; clients never send an amount. */
    voucherCode: z.string().trim().min(1).max(40).optional(),
    returnUrl: z.string().url().optional(),
    cancelUrl: z.string().url().optional(),
  })
  .strict();

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/**
 * Page-number pagination for list endpoints, matching the contract the
 * seller-dashboard hooks already use (`page` / `pageSize`).
 */
export const paginationQuerySchema = z
  .object({
    page: z
      .preprocess(
        (v) => (v === undefined || v === '' ? undefined : Number(v)),
        z.number().int().positive().optional()
      )
      .optional(),
    pageSize: z
      .preprocess(
        (v) => (v === undefined || v === '' ? undefined : Number(v)),
        z.number().int().positive().max(100).optional()
      )
      .optional(),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
