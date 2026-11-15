/**
 * Billing and subscription management interfaces for the MerchOS platform.
 * Requirements: 14.1, 14.2
 */

import { PlanId } from './common.types';

/** Status of a Stripe subscription. */
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid';

/** Billing cycle cadence. */
export type BillingCycle = 'monthly' | 'annual';

/**
 * Identifier for the payment provider backing a subscription. Provider-neutral
 * so the platform can support PayFast (ZA) today and others later.
 */
export type PaymentProviderId = 'payfast' | 'stripe' | 'manual';

/**
 * Current subscription record for a tenant.
 * DynamoDB: PK TENANT#<tenantId>, SK SUBSCRIPTION#current
 *
 * NOTE: `stripe*` fields are retained (now optional) for backward compatibility
 * with any existing code/data. New code uses the provider-neutral fields
 * `provider` / `providerRef` / `mPaymentId`.
 */
export interface Subscription {
  tenantId: string;
  planId: PlanId;
  /** @deprecated Use `provider`/`providerRef`. Kept optional for back-compat. */
  stripeCustomerId?: string;
  /** @deprecated Use `provider`/`providerRef`. Kept optional for back-compat. */
  stripeSubscriptionId?: string;
  /** Provider-neutral payment provider id (e.g. 'payfast'). */
  provider?: PaymentProviderId;
  /** Provider-side reference (e.g. PayFast m_payment_id / token). */
  providerRef?: string;
  /** PayFast m_payment_id that most recently activated this subscription. */
  mPaymentId?: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  /** ISO 8601 timestamp */
  currentPeriodStart: string;
  /** ISO 8601 timestamp */
  currentPeriodEnd: string;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
}

/**
 * Monthly usage counters for a tenant.
 * DynamoDB: PK TENANT#<tenantId>, SK USAGE#<yyyyMM>
 */
export interface UsageRecord {
  tenantId: string;
  /** Billing month in YYYYMM format */
  billingMonth: string;
  enrichmentCalls: number;
  imageCalls: number;
  csvExports: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

/**
 * Per-plan usage limits. Stored in DynamoDB Plans table, updatable by operators.
 */
export interface PlanLimits {
  planId: PlanId;
  maxProducts: number | null;
  maxChannels: number;
  maxUsers: number | null;
  maxAiCallsPerMonth: number | null;
  maxImageCallsPerMonth: number | null;
}

/**
 * Invoice record linking to a PDF stored in S3.
 * DynamoDB: PK TENANT#<tenantId>, SK INVOICE#<invoiceId>
 */
export interface Invoice {
  tenantId: string;
  invoiceId: string;
  /** @deprecated Provider-specific. Optional for back-compat. */
  stripeInvoiceId?: string;
  /** Provider-neutral provider id and reference. */
  provider?: PaymentProviderId;
  providerRef?: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: 'paid' | 'open' | 'void' | 'uncollectible';
  /** S3 key for the PDF invoice file */
  pdfS3Key?: string;
  /** ISO 8601 timestamp */
  periodStart: string;
  /** ISO 8601 timestamp */
  periodEnd: string;
  /** ISO 8601 timestamp */
  createdAt: string;
}
