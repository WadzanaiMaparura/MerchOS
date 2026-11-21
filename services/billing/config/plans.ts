/**
 * MerchOS plan catalogue (ZAR).
 *
 * Money is stored as integer CENTS everywhere to avoid floating-point money
 * bugs. All prices are in South African Rand (ZAR).
 *
 * The `limits` shape mirrors the frontend `PlanLimits` DTO (@merch-os/types)
 * so `GET /billing` can return a `BillingOverview` directly.
 *
 * Agreed launch prices (see the block comment above PLAN_CATALOGUE). Re-check
 * the margins against measured AI cost once Bedrock is live.
 */

import type { PlanId, PlanLimits } from '@merch-os/types';

/** A single plan entry in the catalogue. */
export interface PlanCatalogueEntry {
  planId: PlanId;
  name: string;
  /** Price in integer ZAR cents. null = custom/enterprise (quote-based). */
  priceZARCents: number | null;
  /** New products the seller may create per month (AI listing + corrections included). null = custom. */
  monthlyProducts: number | null;
  /**
   * Hidden AI safeguard: credits per month (1 credit = 4,000 cost-weighted tokens).
   * 6 per product (5 for the listing + 1 for corrections). Sellers see products, not credits.
   */
  monthlyCredits: number | null;
  limits: PlanLimits;
}

/**
 * Launch pricing (agreed Nov 2026). A plan sells NEW PRODUCTS PER MONTH: each
 * includes its AI-written listing, the corrections the seller needs, and export
 * to every marketplace. Exports and catalogue storage are not limited, and
 * team members are unlimited on every plan (they cost nothing to serve).
 *
 *   Starter  R499   500 products/mo   (R1.00 per product)
 *   Growth   R899   1,000 products/mo (R0.90, 10% off)
 *   Pro      R1,790 2,000 products/mo (R0.895)
 *
 * Margins assume descriptions on Haiku (~R0.20 AI per product, estimated):
 * ~71-73% if every product is used, ~27-33% even at 3x that AI cost. Re-check
 * against measured token usage once Bedrock is live.
 */

/** AI safeguard credits per included product (5 listing + 1 corrections). */
export const CREDITS_PER_PRODUCT = 6;

/** Overage price per extra credit, in ZAR cents (opt-in; not offered at launch). */
export const OVERAGE_PRICE_ZAR_CENTS = 100;

/**
 * Estimated AI cost per credit, in ZAR cents (4,000 cost-weighted tokens at
 * ~R17.50/USD). For margin reference only; never billed.
 */
export const CREDIT_COGS_ZAR_CENTS = 7;

const UNLIMITED_TEAM = null;

export const PLAN_CATALOGUE: Record<PlanId, PlanCatalogueEntry> = {
  starter: {
    planId: 'starter',
    name: 'Starter',
    priceZARCents: 49900,
    monthlyProducts: 500,
    monthlyCredits: 500 * CREDITS_PER_PRODUCT,
    limits: {
      maxProducts: null, // no catalogue cap: the monthly new-product count is the limit
      maxChannels: 999, // all marketplaces
      maxUsers: UNLIMITED_TEAM,
      maxAiCallsPerMonth: 500,
      maxImageCallsPerMonth: 500,
      maxCsvExportsPerMonth: null,
    },
  },
  growth: {
    planId: 'growth',
    name: 'Growth',
    priceZARCents: 89900,
    monthlyProducts: 1000,
    monthlyCredits: 1000 * CREDITS_PER_PRODUCT,
    limits: {
      maxProducts: null,
      maxChannels: 999,
      maxUsers: UNLIMITED_TEAM,
      maxAiCallsPerMonth: 1000,
      maxImageCallsPerMonth: 1000,
      maxCsvExportsPerMonth: null,
    },
  },
  professional: {
    planId: 'professional',
    name: 'Pro',
    priceZARCents: 179000,
    monthlyProducts: 2000,
    monthlyCredits: 2000 * CREDITS_PER_PRODUCT,
    limits: {
      maxProducts: null,
      maxChannels: 999,
      maxUsers: UNLIMITED_TEAM,
      maxAiCallsPerMonth: 2000,
      maxImageCallsPerMonth: 2000,
      maxCsvExportsPerMonth: null,
    },
  },
  enterprise: {
    planId: 'enterprise',
    name: 'Enterprise',
    priceZARCents: null, // quote-based
    monthlyProducts: null,
    monthlyCredits: null,
    limits: {
      maxProducts: null,
      maxChannels: 999,
      maxUsers: null,
      maxAiCallsPerMonth: null,
      maxImageCallsPerMonth: null,
      maxCsvExportsPerMonth: null,
    },
  },
};

/** Returns the catalogue entry for a plan id. */
export function getPlan(planId: PlanId): PlanCatalogueEntry {
  return PLAN_CATALOGUE[planId];
}

/**
 * Formats an integer ZAR cents amount as a PayFast-style decimal string with
 * exactly two decimal places (e.g. 49900 -> "499.00"). Throws for null prices
 * (custom plans cannot be checked out via the self-service flow).
 */
export function centsToDecimalString(priceZARCents: number): string {
  if (!Number.isInteger(priceZARCents) || priceZARCents < 0) {
    throw new Error(`Invalid price in cents: ${priceZARCents}`);
  }
  const rands = Math.floor(priceZARCents / 100);
  const cents = priceZARCents % 100;
  return `${rands}.${cents.toString().padStart(2, '0')}`;
}
