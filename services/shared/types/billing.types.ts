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
 * Current subscription record for a tenant.
 * DynamoDB: PK TENANT#<tenantId>, SK SUBSCRIPTION#current
 */
export interface Subscription {
  tenantId: string;
  planId: PlanId;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
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
  stripeInvoiceId: string;
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
