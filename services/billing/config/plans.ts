/**
 * MerchOS plan catalogue (ZAR).
 *
 * Money is stored as integer CENTS everywhere to avoid floating-point money
 * bugs. All prices are in South African Rand (ZAR).
 *
 * The `limits` shape mirrors the frontend `PlanLimits` DTO (@merch-os/types)
 * so `GET /billing` can return a `BillingOverview` directly.
 *
 * PLACEHOLDER — every price, credit allowance and limit below is a provisional
 * value and MUST be refined against real COGS before launch.
 */

import type { PlanId, PlanLimits } from '@merch-os/types';

/** A single plan entry in the catalogue. */
export interface PlanCatalogueEntry {
  planId: PlanId;
  name: string;
  /** Price in integer ZAR cents. null = custom/enterprise (quote-based). */
  priceZARCents: number | null;
  /** Monthly included credits. null = unmetered (no cap). */
  monthlyCredits: number | null;
  limits: PlanLimits;
}

/**
 * Overage price per credit consumed beyond the monthly allowance, in ZAR cents.
 * PLACEHOLDER — R3.50/credit, provisional retail price pending pricing review.
 */
export const OVERAGE_PRICE_ZAR_CENTS = 350;

/**
 * Estimated cost of goods sold per credit, in ZAR cents.
 * PLACEHOLDER — R1.25/credit, for margin reference only (never billed directly).
 */
export const CREDIT_COGS_ZAR_CENTS = 125;

/**
 * The plan catalogue keyed by PlanId.
 * PLACEHOLDER — prices, credits and limits are provisional (refine vs COGS).
 */
export const PLAN_CATALOGUE: Record<PlanId, PlanCatalogueEntry> = {
  starter: {
    planId: 'starter',
    name: 'Starter',
    priceZARCents: 49900, // PLACEHOLDER — R499/mo, provisional entry-tier price
    monthlyCredits: 150, // PLACEHOLDER — 150 credits/mo, provisional allowance
    limits: {
      maxProducts: 500, // PLACEHOLDER — provisional product cap
      maxChannels: 1, // PLACEHOLDER — single sales channel on entry tier
      maxUsers: 2, // PLACEHOLDER — provisional seat cap
      maxAiCallsPerMonth: 150, // PLACEHOLDER — aligns to monthlyCredits
      maxImageCallsPerMonth: 150, // PLACEHOLDER — aligns to monthlyCredits
      maxCsvExportsPerMonth: 20, // PLACEHOLDER — provisional export cap
    },
  },
  growth: {
    planId: 'growth',
    name: 'Growth',
    priceZARCents: 99900, // PLACEHOLDER — R999/mo, provisional mid-tier price
    monthlyCredits: 400, // PLACEHOLDER — 400 credits/mo, provisional allowance
    limits: {
      maxProducts: 2500, // PLACEHOLDER — provisional product cap
      maxChannels: 3, // PLACEHOLDER — provisional channel cap
      maxUsers: 5, // PLACEHOLDER — provisional seat cap
      maxAiCallsPerMonth: 400, // PLACEHOLDER — aligns to monthlyCredits
      maxImageCallsPerMonth: 400, // PLACEHOLDER — aligns to monthlyCredits
      maxCsvExportsPerMonth: 100, // PLACEHOLDER — provisional export cap
    },
  },
  professional: {
    planId: 'professional',
    name: 'Professional',
    priceZARCents: 199900, // PLACEHOLDER — R1999/mo, provisional pro-tier price
    monthlyCredits: 1000, // PLACEHOLDER — 1000 credits/mo, provisional allowance
    limits: {
      maxProducts: 10000, // PLACEHOLDER — provisional product cap
      maxChannels: 6, // PLACEHOLDER — provisional channel cap
      maxUsers: 15, // PLACEHOLDER — provisional seat cap
      maxAiCallsPerMonth: 1000, // PLACEHOLDER — aligns to monthlyCredits
      maxImageCallsPerMonth: 1000, // PLACEHOLDER — aligns to monthlyCredits
      maxCsvExportsPerMonth: 500, // PLACEHOLDER — provisional export cap
    },
  },
  enterprise: {
    planId: 'enterprise',
    name: 'Enterprise',
    priceZARCents: null, // PLACEHOLDER — custom/quote-based pricing
    monthlyCredits: null, // PLACEHOLDER — unmetered (no monthly credit cap)
    limits: {
      maxProducts: null, // unlimited
      maxChannels: 999, // PLACEHOLDER — effectively unlimited channels
      maxUsers: null, // unlimited
      maxAiCallsPerMonth: null, // unmetered
      maxImageCallsPerMonth: null, // unmetered
      maxCsvExportsPerMonth: null, // unmetered
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
