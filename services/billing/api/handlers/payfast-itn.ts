/**
 * PayFast ITN (Instant Transaction Notification) webhook — POST /billing/payfast/itn
 *
 * PayFast POSTs this server-to-server when a payment's state changes. There is
 * NO JWT authorizer on this route (PayFast cannot present one); instead the
 * handler verifies authenticity itself.
 *
 * Security controls, in order:
 *   1. Signature verification (provider.verifyItn) — proves PayFast origin.
 *   2. payment_status must be COMPLETE to activate anything.
 *   3. Server-side AMOUNT CHECK — a first payment must match the price we
 *      captured on the CHECKOUT intent; a monthly card charge must match the
 *      price of the seller's plan (or the downgrade waiting for that date).
 *      The posted amount is NEVER trusted on its own.
 *   4. Idempotency — every payment is claimed with a first-write-wins guard
 *      (m_payment_id for a first payment, "R-<pf_payment_id>" for each monthly
 *      card charge, because PayFast repeats the first m_payment_id on those).
 *
 * Card subscriptions (subscription_type=1) also send:
 *   COMPLETE with a token, after the first one   a monthly charge (renewal)
 *   CANCELLED with a token                       automatic charges ended
 *   FAILED with a token                          a monthly charge was declined
 *                                                (grace / pause / close follow)
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
import type { PlanId } from '@merch-os/types';

import { logger } from '../../../shared/middleware/logger';
import { getPlan, type PlanCatalogueEntry } from '../../config/plans';
import { PayFastProvider, loadPayFastConfig } from '../../providers/payfast';
import { createLiveItnChecks } from '../../providers/payfast-itn-checks';
import type { PaymentProvider } from '../../providers/payment-provider';
import { PayFastSubscriptionsApi, type SubscriptionsApi } from '../../providers/payfast-subscriptions';
import {
  getCheckoutIntent,
  getSubscription,
  type SubscriptionRecord,
  upsertSubscription,
  updateCardSubscription,
  recordPayment,
  getPayment,
  markPaymentApplied,
  upsertInvoice,
} from '../../services/subscription-store';
import { grantCredits } from '../../services/credit-ledger';
import { recordVoucherRedemption } from '../../services/vouchers';
import { planForRenewal, renewalPeriod } from '../../services/card-billing';
import { issueInvoiceDocument } from '../../invoices/issue-invoice';
import { markSubscribed, setAutoRenew } from '../../../shared/entitlements/trial-gate';
import { emitSubscriptionActivated } from '../../services/events';

let injectedProvider: PaymentProvider | undefined;
let injectedSubscriptionsApi: SubscriptionsApi | undefined;

/** Test seam: inject a payment provider. */
export function setPaymentProvider(provider: PaymentProvider): void {
  injectedProvider = provider;
}
/** Test seam: inject the PayFast subscriptions API. */
export function setItnSubscriptionsApi(api: SubscriptionsApi | undefined): void {
  injectedSubscriptionsApi = api;
}

async function resolveProvider(): Promise<PaymentProvider> {
  if (injectedProvider) return injectedProvider;
  const config = await loadPayFastConfig();
  return new PayFastProvider(config, createLiveItnChecks({ mode: config.mode }));
}

async function resolveSubscriptionsApi(): Promise<SubscriptionsApi> {
  return injectedSubscriptionsApi ?? new PayFastSubscriptionsApi(await loadPayFastConfig());
}

/** 200 acknowledgement (PayFast stops retrying on 200). */
function ack(note: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/plain' },
    body: note,
  };
}

export interface PaidPeriod {
  /** Start of the month this payment buys. */
  start: string;
  /** End of it (the new paid-until). */
  end: string;
  /** What the subscription shows as the current period start. */
  currentPeriodStart: string;
  /** Paid-until before this payment, if there was one. */
  previousPeriodEnd?: string;
}

const plusOneMonth = (iso: string): string => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

/** A resumed ITN (same payment already applied to the subscription) reuses what was recorded. */
function resumedPeriod(existing: SubscriptionRecord | null, key: string): PaidPeriod | null {
  if (!existing || existing.mPaymentId !== key || !existing.currentPeriodEnd) return null;
  const end = existing.currentPeriodEnd;
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return {
    start: start.toISOString(),
    end,
    currentPeriodStart: existing.currentPeriodStart ?? start.toISOString(),
    ...(existing.previousPeriodEnd ? { previousPeriodEnd: existing.previousPeriodEnd } : {}),
  };
}

/**
 * The month a payment buys.
 *  - Renewing the SAME plan before it runs out adds a month to the current end,
 *    so paying early (after the 7-day reminder) never loses days.
 *  - A new plan (upgrade/downgrade), or paying after the end, starts now.
 *  - A resumed ITN (same payment already applied to the subscription) reuses
 *    what was recorded, so a retry can never add a second month.
 */
export function paidPeriod(
  existing: SubscriptionRecord | null,
  planId: string,
  mPaymentId: string,
  now: Date,
): PaidPeriod {
  const resumed = resumedPeriod(existing, mPaymentId);
  if (resumed) return resumed;
  const nowIso = now.toISOString();
  const previousPeriodEnd = existing?.currentPeriodEnd;
  const extends_ =
    !!existing &&
    existing.status === 'active' &&
    existing.planId === planId &&
    !!previousPeriodEnd &&
    previousPeriodEnd > nowIso;
  const start = extends_ ? previousPeriodEnd! : nowIso;
  return {
    start,
    end: plusOneMonth(start),
    currentPeriodStart: extends_ ? (existing!.currentPeriodStart ?? nowIso) : nowIso,
    ...(previousPeriodEnd ? { previousPeriodEnd } : {}),
  };
}

/** A monthly card charge: always continues from the current end while it is ahead. */
export function renewalPaidPeriod(existing: SubscriptionRecord, key: string, now: Date): PaidPeriod {
  const resumed = resumedPeriod(existing, key);
  if (resumed) return resumed;
  const { start, end } = renewalPeriod(existing.currentPeriodEnd, now);
  return {
    start,
    end,
    currentPeriodStart: start,
    ...(existing.currentPeriodEnd ? { previousPeriodEnd: existing.currentPeriodEnd } : {}),
  };
}

/** Current billing month in YYYYMM (UTC). */
function currentBillingMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}${m}`;
}

interface ApplyPaymentInput {
  tenantId: string;
  /** Idempotency key (also the invoice id). */
  key: string;
  planId: PlanId;
  plan: PlanCatalogueEntry;
  amountCents: number;
  period: PaidPeriod;
  raw: Record<string, string> | undefined;
  /** Card subscription: keep charging this card every month. */
  card?: { token: string } | undefined;
  invoice?: { listPriceCents?: number; discountCents?: number; voucherCode?: string } | undefined;
  comebackUsed?: boolean;
  voucherCode?: string | undefined;
}

/**
 * Applies a verified, amount-checked, claimed payment. Every step is idempotent
 * so a resumed ITN completes the job. The payment is marked applied LAST.
 */
async function applyPayment(i: ApplyPaymentInput): Promise<void> {
  const { tenantId, key, plan, period } = i;
  const existing = await getSubscription(tenantId);
  const periodStart = new Date(period.start);
  const periodEnd = new Date(period.end);

  await upsertSubscription(tenantId, {
    planId: i.planId,
    status: 'active',
    provider: 'payfast',
    providerRef: key,
    mPaymentId: key,
    // List price of the plan; what was actually paid (after any voucher) is on
    // the invoice and the payment record.
    priceZARCents: plan.priceZARCents,
    currentPeriodStart: period.currentPeriodStart,
    currentPeriodEnd: period.end,
    ...(period.previousPeriodEnd ? { previousPeriodEnd: period.previousPeriodEnd } : {}),
    ...(i.comebackUsed ? { comebackUsedAt: existing?.comebackUsedAt ?? new Date().toISOString() } : {}),
    ...(i.card ? { autoRenew: true, payfastToken: i.card.token } : {}),
  });

  if (plan.monthlyCredits !== null) {
    await grantCredits(tenantId, currentBillingMonth(new Date()), plan.monthlyCredits);
  }

  // Lift the free-trial cap for the paid period (it lapses on its own at
  // periodEnd). Best effort: the payment and subscription are already recorded,
  // so this must not fail or retry the payment. Logged as an anomaly so the
  // billing alarm fires and the seller can be unblocked by hand.
  try {
    await markSubscribed(tenantId, periodEnd.toISOString(), {
      monthlyProductLimit: plan.monthlyProducts,
      ...(i.card ? { autoRenew: true } : {}),
    });
  } catch (error) {
    logger.error('ITN trial entitlement not updated', {
      tenantId,
      mPaymentId: key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Who paid, as PayFast reports it; used on the invoice if no billing profile is set.
  const payerName = [i.raw?.['name_first'], i.raw?.['name_last']].filter(Boolean).join(' ').trim();
  const payerEmail = i.raw?.['email_address']?.trim();

  // Billing-history record for the seller (idempotent on the payment key).
  await upsertInvoice(tenantId, {
    invoiceId: key,
    planId: i.planId,
    amountCents: i.amountCents,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    provider: 'payfast',
    providerRef: key,
    listPriceCents: i.invoice?.listPriceCents ?? plan.priceZARCents ?? i.amountCents,
    ...(i.invoice?.discountCents ? { discountCents: i.invoice.discountCents } : {}),
    ...(i.invoice?.voucherCode ? { voucherCode: i.invoice.voucherCode } : {}),
    ...(payerName ? { payerName } : {}),
    ...(payerEmail ? { payerEmail } : {}),
  });

  // Issue the invoice document (sequential number + PDF). Best effort: the money
  // has landed, so a failure here must NOT fail or retry the payment. The seller's
  // download request issues it on demand if this did not complete.
  try {
    await issueInvoiceDocument(tenantId, key);
  } catch (error) {
    logger.error('Invoice document not issued; will retry on download', {
      tenantId,
      mPaymentId: key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Count the voucher only now that the money has landed (idempotent per payment).
  if (i.voucherCode) {
    const recorded = await recordVoucherRedemption(i.voucherCode, tenantId, key);
    if (!recorded) {
      logger.warn('Voucher redemption not recorded (already counted)', {
        tenantId,
        mPaymentId: key,
        voucherCode: i.voucherCode,
      });
    }
  }

  // Last step: only now is the payment considered fully applied.
  await markPaymentApplied(tenantId, key);

  // Tell the rest of the platform (welcome email, payment-cycle emails,
  // referral rewards). Best effort: the payment is applied and must not be
  // retried because of this.
  try {
    await emitSubscriptionActivated({
      tenantId,
      planId: i.planId,
      planName: plan.name,
      monthlyProducts: plan.monthlyProducts,
      mPaymentId: key,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      ...(period.previousPeriodEnd ? { previousPeriodEnd: period.previousPeriodEnd } : {}),
    });
  } catch (error) {
    logger.error('Subscription event not published', {
      tenantId,
      mPaymentId: key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Claims a payment key; returns false when it was already fully applied. */
async function claim(tenantId: string, key: string, planId: PlanId, amountGrossCents: number, paymentStatus: string, pfPaymentId?: string): Promise<boolean> {
  const claimed = await recordPayment(tenantId, {
    mPaymentId: key,
    planId,
    amountGrossCents,
    paymentStatus,
    ...(pfPaymentId ? { pfPaymentId } : {}),
  });
  if (claimed) return true;
  const existing = await getPayment(tenantId, key);
  if (existing?.applied === true) {
    logger.info('Duplicate ITN ignored (already applied)', { tenantId, mPaymentId: key });
    return false;
  }
  logger.warn('Resuming partially-applied payment', { tenantId, mPaymentId: key });
  return true;
}

/** A monthly card charge landed. */
async function applyRenewal(
  tenantId: string,
  token: string,
  pfPaymentId: string,
  amountGrossCents: number | undefined,
  paymentStatus: string,
  raw: Record<string, string> | undefined,
): Promise<APIGatewayProxyResultV2> {
  const sub = await getSubscription(tenantId);
  if (!sub || sub.payfastToken !== token) {
    // A charge on a card we no longer use (e.g. the old card after an upgrade).
    logger.warn('ITN anomaly: monthly charge for a card that is not the current one', { tenantId });
    return ack('unknown-card');
  }
  const priceOf = (id: string) => getPlan(id as PlanId)?.priceZARCents ?? null;
  const planId = amountGrossCents == null ? null : planForRenewal(sub, amountGrossCents, priceOf);
  if (!planId) {
    logger.warn('ITN amount mismatch', { tenantId, mPaymentId: `R-${pfPaymentId}`, amountGrossCents, kind: 'renewal' });
    return ack('amount-mismatch');
  }
  const key = `R-${pfPaymentId}`;
  if (!(await claim(tenantId, key, planId as PlanId, amountGrossCents!, paymentStatus, pfPaymentId))) return ack('duplicate');
  const plan = getPlan(planId as PlanId);
  await applyPayment({
    tenantId,
    key,
    planId: planId as PlanId,
    plan,
    amountCents: amountGrossCents!,
    period: renewalPaidPeriod(sub, key, new Date()),
    raw,
    card: { token },
  });
  logger.info('Monthly card charge applied', { tenantId, mPaymentId: key, planId });
  return ack('ok');
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

  // (1) Authenticity. A notification that is checked and found invalid is a
  // final answer (ack 200). But a THROW here means our own side failed (e.g.
  // Secrets Manager unavailable while loading credentials), not that the ITN is
  // bad - so answer 503 and let PayFast retry rather than drop a real payment.
  // PayFast's retries are bounded, so this cannot loop forever.
  let verification;
  try {
    const provider = await resolveProvider();
    verification = await provider.verifyItn(rawBody, headers, ip);
  } catch (error) {
    logger.error('ITN verification threw', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { statusCode: 503, headers: { 'Content-Type': 'text/plain' }, body: 'retry' };
  }

  if (!verification.valid) {
    if (verification.retryable) {
      // Could not complete verification (PayFast/DNS unreachable). The payment may
      // be genuine, so do NOT ack: a 5xx makes PayFast retry the notification.
      logger.warn('ITN verification unavailable; requesting retry', { reason: verification.reason });
      return { statusCode: 503, headers: { 'Content-Type': 'text/plain' }, body: 'retry' };
    }
    // Field NAMES only (never values) to diagnose signature/format mismatches.
    const posted = verification.raw ?? {};
    logger.warn('ITN rejected', {
      reason: verification.reason,
      fields: Object.keys(posted),
      emptyFields: Object.entries(posted).filter(([, v]) => v === '').map(([k]) => k),
    });
    return ack('invalid');
  }

  const { mPaymentId, amountGrossCents, paymentStatus, raw, token, pfPaymentId } = verification;

  // tenantId round-trips in custom_str1 (inside the signed payload).
  const tenantId = raw?.['custom_str1'];
  if (!tenantId || !mPaymentId) {
    logger.warn('ITN missing tenant or payment id', { hasTenant: !!tenantId, hasMpid: !!mPaymentId });
    return ack('missing-correlation');
  }

  // (1b) Card subscription events that are not a payment.
  if (token && paymentStatus === 'CANCELLED') {
    const changed = await updateCardSubscription(tenantId, { autoRenew: false, cancelledAt: new Date().toISOString() }, token);
    if (changed) await setAutoRenew(tenantId, false).catch(() => undefined);
    logger.info('Card subscription cancelled', { tenantId, current: changed });
    return ack('subscription-cancelled');
  }
  if (token && paymentStatus === 'FAILED') {
    // The grace / pause / close cycle follows from the paid-until date as it is.
    const changed = await updateCardSubscription(tenantId, { lastChargeFailedAt: new Date().toISOString() }, token);
    logger.warn('Card charge failed', { tenantId, current: changed });
    return ack('charge-failed');
  }

  // (2) Only completed payments activate anything.
  if (paymentStatus !== 'COMPLETE') {
    logger.info('ITN non-complete status; ignoring', { paymentStatus, mPaymentId });
    return ack('ignored-status');
  }

  // (2b) A monthly card charge: PayFast repeats the first payment's m_payment_id,
  // with a new pf_payment_id. It is a renewal when that first payment is
  // already applied under a different pf_payment_id, or when there is no
  // checkout for it any more (the intent expires after 30 days).
  if (token && pfPaymentId) {
    const first = await getPayment(tenantId, mPaymentId);
    const renewal =
      (first?.applied === true && first.pfPaymentId !== undefined && first.pfPaymentId !== pfPaymentId) ||
      (!first && !(await getCheckoutIntent(tenantId, mPaymentId)));
    if (renewal) return applyRenewal(tenantId, token, pfPaymentId, amountGrossCents, paymentStatus, raw);
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
  // A card subscription must come back with its card token.
  if (intent.recurringAmountCents !== undefined && !token) {
    logger.warn('ITN anomaly: card subscription payment without a token', { tenantId, mPaymentId });
  }

  // (4) Idempotency. First ITN claims the payment. A later one is a duplicate
  // ONLY if the earlier attempt finished applying it; otherwise we resume.
  if (!(await claim(tenantId, mPaymentId, intent.planId, amountGrossCents, paymentStatus, pfPaymentId))) {
    return ack('duplicate');
  }

  // Apply. Each step is idempotent so a resume is safe. Errors propagate (5xx)
  // so PayFast retries and the resume path completes the job.
  const existing = await getSubscription(tenantId);
  await applyPayment({
    tenantId,
    key: mPaymentId,
    planId: intent.planId,
    plan,
    amountCents: expectedCents,
    period: paidPeriod(existing, intent.planId, mPaymentId, new Date()),
    raw,
    card: intent.recurringAmountCents !== undefined && token ? { token } : undefined,
    invoice: {
      listPriceCents: intent.listPriceCents ?? plan.priceZARCents ?? expectedCents,
      ...(intent.discountCents ? { discountCents: intent.discountCents } : {}),
      ...(intent.upgradeCreditCents ? { discountCents: intent.upgradeCreditCents } : {}),
      ...(intent.voucherCode ? { voucherCode: intent.voucherCode } : {}),
    },
    comebackUsed: intent.offer === 'comeback',
    voucherCode: intent.voucherCode,
  });

  // Upgrade: the old card subscription is replaced by this one; stop it so the
  // seller is never charged twice. Best effort, alarmed if it fails.
  if (intent.replacesToken && intent.replacesToken !== token) {
    try {
      await (await resolveSubscriptionsApi()).cancel(intent.replacesToken);
    } catch (error) {
      logger.error('ITN anomaly: old card subscription not cancelled after upgrade', {
        tenantId,
        mPaymentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('Subscription activated via ITN', {
    tenantId,
    mPaymentId,
    planId: intent.planId,
  });
  return ack('ok');
}
