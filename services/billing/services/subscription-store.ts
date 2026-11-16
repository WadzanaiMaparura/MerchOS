/**
 * Subscription + payment-idempotency persistence for the billing service.
 *
 * DynamoDB layout (BILLING_TABLE), all under PK = TENANT#<tenantId>:
 *   SK = SUBSCRIPTION#current   — the tenant's single current subscription
 *   SK = PAYMENT#<mPaymentId>   — idempotency record for a provider payment
 *   SK = INVOICE#<invoiceId>    — invoice records (listed by list-invoices)
 *
 * Writes go through TenantDynamoClient so cross-tenant writes are impossible at
 * the data layer. Money is stored in integer ZAR cents.
 */

import type { PlanId } from '@merch-os/types';
import type { SubscriptionStatus, PaymentProviderId } from '../../shared/types/billing.types';
import {
  BILLING_TABLE,
  createTenantDynamoClient,
  subscriptionSK,
  paymentSK,
  checkoutSK,
  tenantPK,
} from '../../shared/utils/dynamo-client';

/** How long an unpaid checkout intent is retained (DynamoDB TTL attribute). */
const CHECKOUT_INTENT_TTL_SECONDS = 30 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// Subscription record (persisted shape)
// ---------------------------------------------------------------------------

export interface SubscriptionRecord {
  tenantId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  provider: PaymentProviderId;
  /** Provider-side reference (PayFast m_payment_id / token). */
  providerRef?: string;
  /** The m_payment_id that most recently activated this subscription. */
  mPaymentId?: string;
  /** Plan price captured at checkout time, integer ZAR cents (null = custom). */
  priceZARCents?: number | null;
  currentPeriodStart?: string; // ISO 8601
  currentPeriodEnd?: string; // ISO 8601
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSubscriptionInput {
  planId: PlanId;
  status: SubscriptionStatus;
  provider: PaymentProviderId;
  providerRef?: string;
  mPaymentId?: string;
  priceZARCents?: number | null;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

/** Reads the tenant's current subscription, or null if none exists. */
export async function getSubscription(
  tenantId: string
): Promise<SubscriptionRecord | null> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: subscriptionSK() },
  });
  if (!res.Item) return null;
  return res.Item as unknown as SubscriptionRecord;
}

/**
 * Creates or replaces the tenant's current subscription. `createdAt` is set on
 * first write and preserved on subsequent updates.
 */
export async function upsertSubscription(
  tenantId: string,
  input: UpsertSubscriptionInput
): Promise<SubscriptionRecord> {
  const now = new Date().toISOString();
  const existing = await getSubscription(tenantId);

  const record: SubscriptionRecord = {
    tenantId,
    planId: input.planId,
    status: input.status,
    provider: input.provider,
    ...(input.providerRef !== undefined ? { providerRef: input.providerRef } : {}),
    ...(input.mPaymentId !== undefined ? { mPaymentId: input.mPaymentId } : {}),
    ...(input.priceZARCents !== undefined ? { priceZARCents: input.priceZARCents } : {}),
    ...(input.currentPeriodStart !== undefined
      ? { currentPeriodStart: input.currentPeriodStart }
      : {}),
    ...(input.currentPeriodEnd !== undefined
      ? { currentPeriodEnd: input.currentPeriodEnd }
      : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const client = createTenantDynamoClient(tenantId);
  await client.put({
    TableName: BILLING_TABLE,
    Item: {
      PK: tenantPK(tenantId),
      SK: subscriptionSK(),
      ...record,
    },
  });
  return record;
}

// ---------------------------------------------------------------------------
// Checkout intents (pending, unpaid)
// ---------------------------------------------------------------------------

/**
 * A pending checkout: the plan + expected price captured when the seller started
 * a PayFast checkout. Stored under CHECKOUT#<mPaymentId>, SEPARATE from
 * SUBSCRIPTION#current, so abandoning or cancelling a checkout can never alter
 * (or downgrade) a tenant's live subscription. The ITN verifies the posted
 * amount against this record and only then activates the plan.
 */
export interface CheckoutIntent {
  tenantId: string;
  mPaymentId: string;
  planId: PlanId;
  priceZARCents: number;
  createdAt: string;
}

export async function createCheckoutIntent(
  tenantId: string,
  input: { mPaymentId: string; planId: PlanId; priceZARCents: number }
): Promise<CheckoutIntent> {
  const now = new Date();
  const intent: CheckoutIntent = {
    tenantId,
    mPaymentId: input.mPaymentId,
    planId: input.planId,
    priceZARCents: input.priceZARCents,
    createdAt: now.toISOString(),
  };
  const client = createTenantDynamoClient(tenantId);
  await client.put({
    TableName: BILLING_TABLE,
    Item: {
      PK: tenantPK(tenantId),
      SK: checkoutSK(input.mPaymentId),
      ...intent,
      // DynamoDB TTL (epoch seconds) — unpaid intents expire on their own.
      ttl: Math.floor(now.getTime() / 1000) + CHECKOUT_INTENT_TTL_SECONDS,
    },
  });
  return intent;
}

export async function getCheckoutIntent(
  tenantId: string,
  mPaymentId: string
): Promise<CheckoutIntent | null> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: checkoutSK(mPaymentId) },
  });
  return res.Item ? (res.Item as unknown as CheckoutIntent) : null;
}

// ---------------------------------------------------------------------------
// Payment idempotency
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  mPaymentId: string;
  planId: PlanId;
  amountGrossCents?: number;
  paymentStatus?: string;
}

/**
 * Records a provider payment under PAYMENT#<mPaymentId> with a
 * `attribute_not_exists` guard so a replayed ITN for the same m_payment_id
 * cannot be applied twice.
 *
 * Returns true if this is the first time we've seen the payment (write
 * succeeded), false if it was already recorded (duplicate ITN — caller should
 * skip re-applying).
 */
export async function recordPayment(
  tenantId: string,
  input: RecordPaymentInput
): Promise<boolean> {
  const now = new Date().toISOString();
  const client = createTenantDynamoClient(tenantId);
  try {
    await client.put({
      TableName: BILLING_TABLE,
      Item: {
        PK: tenantPK(tenantId),
        SK: paymentSK(input.mPaymentId),
        mPaymentId: input.mPaymentId,
        planId: input.planId,
        ...(input.amountGrossCents !== undefined
          ? { amountGrossCents: input.amountGrossCents }
          : {}),
        ...(input.paymentStatus !== undefined ? { paymentStatus: input.paymentStatus } : {}),
        // Two-phase: the claim is written first with applied=false and flipped to
        // true only after every side effect (activation + credit grant) has
        // succeeded. A retry that finds applied=false RESUMES the work instead of
        // being skipped as a duplicate (otherwise a mid-way failure loses credits).
        applied: false,
        createdAt: now,
      },
      // First-write-wins: the SK must not already exist. Combined with the
      // tenant-isolation condition injected by TenantDynamoClient.put, a
      // replayed ITN fails the condition and we treat it as a duplicate.
      ConditionExpression: 'attribute_not_exists(SK)',
    });
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      (error as { name?: string }).name === 'ConditionalCheckFailedException'
    ) {
      return false; // already recorded — duplicate
    }
    throw error;
  }
}

/** Reads a recorded payment, or null. */
export async function getPayment(
  tenantId: string,
  mPaymentId: string
): Promise<{ mPaymentId: string; applied?: boolean } | null> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: paymentSK(mPaymentId) },
  });
  return res.Item ? (res.Item as unknown as { mPaymentId: string; applied?: boolean }) : null;
}

/** Marks a payment fully applied (activation + credits done). Idempotent. */
export async function markPaymentApplied(tenantId: string, mPaymentId: string): Promise<void> {
  const client = createTenantDynamoClient(tenantId);
  await client.update({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: paymentSK(mPaymentId) },
    UpdateExpression: 'SET #a = :t, #at = :now',
    ExpressionAttributeNames: { '#a': 'applied', '#at': 'appliedAt' },
    ExpressionAttributeValues: { ':t': true, ':now': new Date().toISOString() },
  });
}
