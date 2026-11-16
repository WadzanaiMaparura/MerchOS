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
 *      captured on the CHECKOUT intent for this m_payment_id. The posted amount
 *      is NEVER trusted on its own.
 *   4. Idempotency — the payment is claimed with a first-write-wins guard.
 *
 * Failure semantics (important for money):
 *   - A payment is only treated as a duplicate once it is fully APPLIED
 *     (subscription activated AND credits granted). The claim is written with
 *     applied=false and flipped to true last. If an earlier attempt failed part
 *     way, the PayFast retry finds applied=false and RESUMES — every step is
 *     idempotent (subscription put, credit grant sets the allowance without
 *     resetting consumption).
 *   - Verification / business-rule rejections return 200 (so PayFast stops
 *     retrying; there is nothing to retry). Unexpected errors while applying a
 *     VERIFIED payment are allowed to propagate as 5xx so PayFast retries.
 *
 * tenantId is not available from a JWT here. PayFast echoes our `custom_str1`
 * (set to the tenantId at checkout) inside the signed payload, so it cannot be
 * forged without the merchant key.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { logger } from '../../../shared/middleware/logger';
import { getPlan } from '../../config/plans';
import { PayFastProvider, loadPayFastConfig } from '../../providers/payfast';
import type { PaymentProvider } from '../../providers/payment-provider';
import {
  getCheckoutIntent,
  upsertSubscription,
  recordPayment,
  getPayment,
  markPaymentApplied,
  upsertInvoice,
} from '../../services/subscription-store';
import { grantCredits } from '../../services/credit-ledger';

let injectedProvider: PaymentProvider | undefined;

/** Test seam: inject a payment provider. */
export function setPaymentProvider(provider: PaymentProvider): void {
  injectedProvider = provider;
}

async function resolveProvider(): Promise<PaymentProvider> {
  if (injectedProvider) return injectedProvider;
  return new PayFastProvider(await loadPayFastConfig());
}

/** 200 acknowledgement (PayFast stops retrying on 200). */
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
  const http = (event.requestContext as unknown as Record<string, unknown>)?.['http'] as
    | Record<string, unknown>
    | undefined;
  const ip = typeof http?.['sourceIp'] === 'string' ? (http['sourceIp'] as string) : undefined;

  // (1) Authenticity. Anything that fails here is a final answer, not a retry.
  let verification;
  try {
    const provider = await resolveProvider();
    verification = await provider.verifyItn(rawBody, headers, ip);
  } catch (error) {
    logger.error('ITN verification threw', {
      error: error instanceof Error ? error.message : String(error),
    });
    return ack('error-verifying');
  }

  if (!verification.valid) {
    logger.warn('ITN rejected', { reason: verification.reason });
    return ack('invalid');
  }

  const { mPaymentId, amountGrossCents, paymentStatus, raw } = verification;

  // tenantId round-trips in custom_str1 (inside the signed payload).
  const tenantId = raw?.['custom_str1'];
  if (!tenantId || !mPaymentId) {
    logger.warn('ITN missing tenant or payment id', { hasTenant: !!tenantId, hasMpid: !!mPaymentId });
    return ack('missing-correlation');
  }

  // (2) Only completed payments activate anything.
  if (paymentStatus !== 'COMPLETE') {
    logger.info('ITN non-complete status; ignoring', { paymentStatus, mPaymentId });
    return ack('ignored-status');
  }

  // Correlate against the checkout intent captured when the seller started paying.
  const intent = await getCheckoutIntent(tenantId, mPaymentId);
  if (!intent) {
    logger.warn('ITN has no matching checkout intent', { tenantId, mPaymentId });
    return ack('no-intent');
  }

  const plan = getPlan(intent.planId);
  const expectedCents = intent.priceZARCents;

  // (3) Server-side amount check — reject tampering. Never trust posted amount.
  if (amountGrossCents == null || amountGrossCents !== expectedCents) {
    logger.warn('ITN amount mismatch', { tenantId, mPaymentId, expectedCents, amountGrossCents });
    return ack('amount-mismatch');
  }

  // (4) Idempotency. First ITN claims the payment. A later one is a duplicate
  // ONLY if the earlier attempt finished applying it; otherwise we resume.
  const claimed = await recordPayment(tenantId, {
    mPaymentId,
    planId: intent.planId,
    amountGrossCents,
    paymentStatus,
  });
  if (!claimed) {
    const existing = await getPayment(tenantId, mPaymentId);
    if (existing?.applied === true) {
      logger.info('Duplicate ITN ignored (already applied)', { tenantId, mPaymentId });
      return ack('duplicate');
    }
    logger.warn('Resuming partially-applied payment', { tenantId, mPaymentId });
  }

  // Apply. Each step is idempotent so a resume is safe. Errors propagate (5xx)
  // so PayFast retries and the resume path completes the job.
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

  await upsertSubscription(tenantId, {
    planId: intent.planId,
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

  // Billing-history record for the seller (idempotent on the payment id).
  await upsertInvoice(tenantId, {
    invoiceId: mPaymentId,
    planId: intent.planId,
    amountCents: expectedCents,
    periodStart: now.toISOString(),
    periodEnd: periodEnd.toISOString(),
    provider: 'payfast',
    providerRef: mPaymentId,
  });

  // Last step: only now is the payment considered fully applied.
  await markPaymentApplied(tenantId, mPaymentId);

  logger.info('Subscription activated via ITN', {
    tenantId,
    mPaymentId,
    planId: intent.planId,
  });
  return ack('ok');
}
