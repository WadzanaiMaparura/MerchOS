/**
 * Billing-related DTOs for the MerchOS frontend.
 */

import { PlanId } from './common';

/** Subscription status values. */
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid';

/** Billing cycle frequency. */
export type BillingCycle = 'monthly' | 'annual';

/** Per-plan usage limits. */
export interface PlanLimits {
  maxProducts: number | null;
  maxChannels: number;
  maxUsers: number | null;
  maxAiCallsPerMonth: number | null;
  maxImageCallsPerMonth: number | null;
  maxCsvExportsPerMonth: number | null;
}

/** Current billing month usage counters. */
export interface UsageMeters {
  products: number;
  channels: number;
  users: number;
  aiCalls: number;
  imageCalls: number;
  csvExports: number;
}

/**
 * Credit-based usage balance for the current billing month.
 *
 * MerchOS billing moved from per-feature call counters (UsageMeters) to a
 * single monthly credit allowance. `granted`/`remaining` are null for
 * unmetered (enterprise) plans.
 */
export interface CreditBalance {
  granted: number | null;
  consumed: number;
  overage: number;
  remaining: number | null;
}

/** Overview of the tenant's billing and subscription state. */
export interface BillingOverview {
  planName: string;
  planId: PlanId;
  billingCycle: BillingCycle;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodStart: string; // ISO 8601
  currentPeriodEnd: string; // ISO 8601
  usage: UsageMeters;
  limits: PlanLimits;
  /**
   * Credit model balance for the current month. Optional so existing consumers
   * that only read usage/limits keep working unchanged.
   */
  credits?: CreditBalance;
}

/** A plan entry exposed to the frontend plan picker / pricing table. */
export interface PlanCatalogueEntry {
  planId: PlanId;
  name: string;
  /** Price in integer ZAR cents. null for custom/enterprise pricing. */
  priceZARCents: number | null;
  /** Monthly included credits. null = unmetered. */
  monthlyCredits: number | null;
  limits: PlanLimits;
}

/** Invoice status values. */
export type InvoiceStatus = 'paid' | 'open' | 'void' | 'uncollectible';

/** Summary representation of an invoice for list views. */
export interface InvoiceSummary {
  invoiceId: string;
  date: string; // ISO 8601
  amount: number;
  currency: string;
  status: InvoiceStatus;
  billingPeriodStart: string; // ISO 8601
  billingPeriodEnd: string; // ISO 8601
  downloadUrl?: string;
}
