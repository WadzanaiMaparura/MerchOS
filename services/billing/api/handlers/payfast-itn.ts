/**
 * PayFast ITN (Instant Transaction Notification) webhook — POST /billing/payfast/itn
 *
 * PayFast POSTs this server-to-server when a payment's state changes. There is
 * NO JWT authorizer on this route (PayFast cannot present one); instead the
 * handler verifies authenticity itself, mirroring the WhatsApp HMAC webhook
 * pattern used by the Supplier service.
 *
 * Security controls, in order:
 *   1. Signature verification (provider.verifyItn) — proves PayFast origin.
 *   2. payment_status must be COMPLETE.
 *   3. Server-side AMOUNT CHECK — the gross amount must match the price we
 *      captured on the subscription intent for this m_payment_id. The posted
 *      amount is NEVER trusted on its own.
 *   4. Idempotency — the payment is recorded with a first-write-wins guard, so
 *      a replayed ITN cannot activate twice.
 *
 * Per PayFast's spec we return HTTP 200 for every received ITN (so they stop
 * retrying), regardless of whether we applied it — we simply do not activate on
 * a failed check.
 *
 * NOTE: tenantId is NOT available from a JWT here. PayFast echoes back our
 * `custom_str1` field, which change-plan sets to the tenantId, so the ITN can
 * locate the right tenant partition. (See change-plan checkout payload.)
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { logger } from '../../../shared/middleware/logger';
import { getPlan } from '../../config/plans';
import { PayFastProvider } from '../../providers/payfast';
import type { PaymentProvider } from '../../providers/payment-provider';
import {
  getSubscription,
  upsertSubscription,
  recordPayment,
} from '../../services/subscription-store';
import { grantCredits } from '../../services/credit-ledger';

let injectedProvider: PaymentProvider | undefined;

/** Test seam: inject a payment provider. */
export function setPaymentProvider(provider: PaymentProvider): void {
  injectedProvider = provider;
}

function resolveProvider(): PaymentProvider {
  return injectedProvider ?? new PayFastProvider();
}

/** Always-200 helper (PayFast expects 200 to stop retrying). */
function ack(note: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: note,
  };
}

/** Current billing month in YYYYMM (UTC). */
function currentBillingMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}${m}`;
}

/**
 * NOTE: no middy/auth middleware — this is a public server-to-server webhook,
 * authenticated by the PayFast signature verified inside the handler.
 */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const rawBody = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    : '';

  const headers = (event.headers ?? {}) as Record<string, string | undefined>;
  const sourceIp = (event.requestContext as unknown as Record<string, unknown>)?.['http'] as
    | Record<string, unknown>
    | undefined;
  const ip = typeof sourceIp?.['sourceIp'] === 'string' ? (sourceIp['sourceIp'] as string) : undefined;

  const provider = resolveProvider();

  let verification;
  try {
    verification = await provider.verifyItn(rawBody, headers, ip);
  } catch (error) {
    logger.error('ITN verification threw', {
      error: error instanceof Error ? error.message : String(error),
    });
    return ack('error-verifying'); // 200 so PayFast stops retrying; nothing applied
  }

  if (!verification.valid) {
    logger.warn('ITN rejected', { reason: verification.reason });
    return ack('invalid');
  }

  const { mPaymentId, amountGrossCents, paymentStatus, raw } = verification;

  // tenantId is echoed back by PayFast as custom_str1 (set by change-plan).
  const tenantId = raw?.['custom_str1'];
  if (!tenantId || !mPaymentId) {
    logger.warn('ITN missing tenant or payment id', { hasTenant: !!tenantId, hasMpid: !!mPaymentId });
    return ack('missing-correlation');
  }

  if (paymentStatus !== 'COMPLETE') {
    logger.info('ITN non-complete status; ignoring', { paymentStatus, mPaymentId });
    return ack('ignored-status');
  }

  // Correlate against the PENDING subscription intent created at checkout.
  const subscription = await getSubscription(tenantId);
  if (!subscription || subscription.mPaymentId !== mPaymentId) {
    logger.warn('ITN has no matching subscription intent', { tenantId, mPaymentId });
    return ack('no-intent');
  }

  const plan = getPlan(subscription.planId);
  const expectedCents = subscription.priceZARCents ?? plan.priceZARCents;

  // (3) Server-side amount check — reject tampering. Never trust posted amount.
  if (expectedCents == null || amountGrossCents == null || amountGrossCents !== expectedCents) {
    logger.warn('ITN amount mismatch', { tenantId, mPaymentId, expectedCents, amountGrossCents });
    return ack('amount-mismatch');
  }

  // (4) Idempotency — first ITN wins. A replay returns false and we skip.
  const firstTime = await recordPayment(tenantId, {
    mPaymentId,
    planId: subscription.planId,
    ...(amountGrossCents !== undefined ? { amountGrossCents } : {}),
    paymentStatus,
  });
  if (!firstTime) {
    logger.info('Duplicate ITN ignored', { tenantId, mPaymentId });
    return ack('duplicate');
  }

  // Activate the subscription for a 1-month period and grant the plan credits.
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  await upsertSubscription(tenantId, {
    planId: subscription.planId,
    status: 'active',
    provider: 'payfast',
    providerRef: mPaymentId,
    mPaymentId,
    priceZARCents: expectedCents,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: periodEnd.toISOString(),
  });

  if (plan.monthlyCredits !== null) {
    await grantCredits(tenantId, currentBillingMonth(now), plan.monthlyCredits);
  }

  logger.info('Subscription activated via ITN', {
    tenantId,
    mPaymentId,
    planId: subscription.planId,
  });
  return ack('ok');
}
