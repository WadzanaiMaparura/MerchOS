/**
 * Runs a scheduled lifecycle step (EventBridge Scheduler, see lib/schedule.ts).
 * Every rule is checked again at send time, because a lot can change in a month:
 *
 *   tips, training   account still exists
 *   review           still exists, not opted out, has not reviewed, 5+ products
 *   referral         still exists, not opted out, still subscribed
 *   qualify          the referred seller is still subscribed 14 days after paying AND is
 *                    actively using MerchOS (10+ products): the referrer earns one free
 *                    month. With REFERRAL_FREE_MONTHS on, billing applies it straight
 *                    away (or after the referrer's next payment); otherwise staff do.
 *                    Under 10 products: checked again weekly, up to 90 days after paying.
 *   due7 ... wb180   payment cycle (lib/billing-cycle.ts): not paid for a later period
 *                    since, not free unlimited, account enabled; win-back offers respect
 *                    the unsubscribe. Off until BILLING_LIFECYCLE=true.
 */

import { z } from 'zod';
import { PLAN_CATALOGUE } from '../../billing/config/plans';
import { comebackOffer, isBillingLifecycleOn, stageDates } from '../../shared/entitlements/billing-stage';
import { countProducts, getPaidStatus, getUser, isSubscribedNow } from '../lib/accounts';
import {
  BILLING_STEPS,
  MARKETING_BILLING_STEPS,
  billingEmailKey,
  isBillingStep,
  type BillingStep,
} from '../lib/billing-cycle';
import {
  accountClosed,
  closingInSevenDays,
  comebackOfferEmail,
  dataKeptReminder,
  dueInSevenDays,
  dueTomorrow,
  planPaused,
  productsWaiting,
  whyDidYouLeave,
} from '../lib/billing-templates';
import { config } from '../lib/config';
import { emitRewardEarned, isReferralFreeMonthsOn } from '../lib/events';
import {
  REVIEW_MIN_PRODUCTS,
  ensureReferralCode,
  feedbackLink,
  referralLink,
  reviewLink,
  sendOnce,
  unsubscribeLinks,
} from '../lib/lifecycle';
import { getProfile, getReferral, hasReviewed, transitionReferral } from '../lib/store';
import { scheduleStep } from '../lib/schedule';
import { referralInvite, reviewRequest, tips, training } from '../lib/templates';

const eventSchema = z.object({
  step: z.enum(['tips', 'training', 'review', 'referral', 'qualify', ...BILLING_STEPS]),
  tenantId: z.string().uuid(),
  referrerTenantId: z.string().uuid().optional(),
  attempt: z.number().int().min(0).max(20).optional(),
  paidUntil: z.string().datetime().optional(),
  planId: z.string().min(1).max(40).optional(),
});

export type StepResult =
  | 'sent'
  | 'skipped'
  | 'duplicate'
  | 'opted-out'
  | 'qualified'
  | 'lapsed'
  | 'waiting'
  | 'renewed'
  | 'switched-off';

const plans = PLAN_CATALOGUE as Record<string, { name: string; priceZARCents: number | null } | undefined>;

/**
 * One payment-cycle email. Sent only if the seller has NOT paid for a later
 * period since it was booked (paid-until unchanged), is not a free unlimited
 * account, and still has an enabled account; marketing steps also respect the
 * unsubscribe. Off entirely until BILLING_LIFECYCLE=true.
 */
async function billingStep(step: BillingStep, tenantId: string, paidUntil: string, planId: string | undefined): Promise<StepResult> {
  if (!isBillingLifecycleOn()) return 'switched-off';
  const profile = await getProfile(tenantId);
  if (!profile) return 'skipped';
  const paid = await getPaidStatus(tenantId);
  if (!paid || paid.status !== 'subscribed') return 'skipped'; // exempt, or no paid record
  if (paid.subscribedUntil !== paidUntil) return 'renewed';
  if (MARKETING_BILLING_STEPS.has(step) && profile.marketingOptOut) return 'opted-out';
  const user = await getUser(profile.userId);
  if (!user || !user.enabled) return 'skipped';

  const dates = stageDates(paidUntil);
  const plan = planId ? plans[planId] : undefined;
  const base = {
    siteUrl: config.siteUrl,
    firstName: profile.firstName,
    planName: plan?.name ?? 'MerchOS',
    paidUntil,
    graceEndsAt: dates.graceEndsAt,
    closesAt: dates.closesAt,
    dataKeptUntil: dates.dataKeptUntil,
    productCount: await countProducts(tenantId),
    autoRenew: paid.autoRenew === true,
  };
  const key = billingEmailKey(step, paidUntil);

  switch (step) {
    case 'due7':
      return sendOnce(profile, user.email, key, dueInSevenDays(base));
    case 'due1':
      // The card is charged automatically: one heads-up (7 days) is enough.
      if (base.autoRenew) return 'skipped';
      return sendOnce(profile, user.email, key, dueTomorrow(base));
    case 'paused':
      return sendOnce(profile, user.email, key, planPaused(base));
    case 'final':
      return sendOnce(profile, user.email, key, closingInSevenDays(base));
    case 'closed':
      return sendOnce(profile, user.email, key, accountClosed(base));
    case 'wb180':
      return sendOnce(profile, user.email, key, dataKeptReminder(base));
    case 'wb44': {
      const unsubscribe = await unsubscribeLinks(tenantId);
      return sendOnce(profile, user.email, key, productsWaiting({ ...base, unsubscribeUrl: unsubscribe.page }), unsubscribe.oneClick);
    }
    case 'wb60': {
      const unsubscribe = await unsubscribeLinks(tenantId);
      const email = whyDidYouLeave({
        firstName: profile.firstName,
        reasonUrl: await feedbackLink(tenantId),
        unsubscribeUrl: unsubscribe.page,
      });
      return sendOnce(profile, user.email, key, email, unsubscribe.oneClick);
    }
    case 'wb90': {
      const offer = comebackOffer(paidUntil, undefined, new Date());
      if (!offer) return 'skipped'; // the window has passed (a very late delivery)
      const unsubscribe = await unsubscribeLinks(tenantId);
      const email = comebackOfferEmail({
        ...base,
        percentOff: offer.percentOff,
        offerEndsAt: offer.endsAt,
        listPriceCents: plan?.priceZARCents ?? null,
        unsubscribeUrl: unsubscribe.page,
      });
      return sendOnce(profile, user.email, key, email, unsubscribe.oneClick);
    }
  }
}

/** A referred seller is "actively using" MerchOS once they have this many products. */
export const REFERRAL_MIN_PRODUCTS = 10;
/** How long after their first payment they have to get there. */
export const REFERRAL_ACTIVITY_WINDOW_DAYS = 90;

/** Ask billing to apply an owed free month (no-op unless REFERRAL_FREE_MONTHS is on). */
async function requestFreeMonth(referrerTenantId: string, referredTenantId: string): Promise<void> {
  if (!isReferralFreeMonthsOn()) return;
  await emitRewardEarned({ referrerTenantId, referredTenantId });
}

async function qualify(tenantId: string, referrerTenantId: string, attempt: number): Promise<StepResult> {
  const referral = await getReferral(referrerTenantId, tenantId);
  if (referral?.status === 'QUALIFIED' && referral.reward === 'EARNED') {
    // A retry after the request to billing failed: send it again (billing is idempotent).
    await requestFreeMonth(referrerTenantId, tenantId);
    return 'skipped';
  }
  if (referral?.status !== 'SUBSCRIBED') return 'skipped';
  const now = new Date();
  const nowIso = now.toISOString();

  if (!(await isSubscribedNow(tenantId))) {
    const ok = await transitionReferral(referrerTenantId, tenantId, ['SUBSCRIBED'], 'LAPSED', {
      lapsedAt: nowIso,
      lapseReason: 'stopped-paying',
    });
    return ok ? 'lapsed' : 'skipped';
  }

  // Still paying after 14 days. Activity: at least 10 products in the account.
  const products = await countProducts(tenantId, REFERRAL_MIN_PRODUCTS);
  if (products >= REFERRAL_MIN_PRODUCTS) {
    const ok = await transitionReferral(referrerTenantId, tenantId, ['SUBSCRIBED'], 'QUALIFIED', {
      qualifiedAt: nowIso,
      productsAtLastCheck: products,
      lastCheckedAt: nowIso,
      reward: 'EARNED',
    });
    if (!ok) return 'skipped';
    console.info('Referral qualified: free month earned', { referrerTenantId, tenantId });
    // Applied now if the referrer is paying; otherwise owed until their next payment.
    await requestFreeMonth(referrerTenantId, tenantId);
    return 'qualified';
  }

  const paidAt = new Date(referral.subscribedAt ?? nowIso).getTime();
  const deadline = paidAt + REFERRAL_ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() >= deadline) {
    const ok = await transitionReferral(referrerTenantId, tenantId, ['SUBSCRIBED'], 'LAPSED', {
      lapsedAt: nowIso,
      lapseReason: 'not-active',
      productsAtLastCheck: products,
      lastCheckedAt: nowIso,
    });
    return ok ? 'lapsed' : 'skipped';
  }

  // Not active enough yet: look again in a week (until the 90 days are up).
  await transitionReferral(referrerTenantId, tenantId, ['SUBSCRIBED'], 'SUBSCRIBED', {
    productsAtLastCheck: products,
    lastCheckedAt: nowIso,
  });
  await scheduleStep({ step: 'qualify', tenantId, referrerTenantId, attempt: attempt + 1 }, now);
  return 'waiting';
}

export async function runStep(input: unknown): Promise<StepResult> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    console.warn('Scheduled step ignored: unexpected input');
    return 'skipped';
  }
  const { step, tenantId, referrerTenantId, attempt = 0 } = parsed.data;

  if (isBillingStep(step)) {
    return parsed.data.paidUntil ? billingStep(step, tenantId, parsed.data.paidUntil, parsed.data.planId) : 'skipped';
  }

  if (step === 'qualify') {
    return referrerTenantId ? qualify(tenantId, referrerTenantId, attempt) : 'skipped';
  }

  const profile = await getProfile(tenantId);
  if (!profile) return 'skipped';
  const user = await getUser(profile.userId);
  if (!user || !user.enabled) return 'skipped';

  switch (step) {
    case 'tips':
      return sendOnce(profile, user.email, 'tips', tips({ siteUrl: config.siteUrl, firstName: profile.firstName }));
    case 'training':
      return sendOnce(profile, user.email, 'training', training({ siteUrl: config.siteUrl, firstName: profile.firstName }));
    case 'review': {
      if (profile.marketingOptOut) return 'opted-out';
      if (await hasReviewed(tenantId)) return 'skipped';
      const listings = await countProducts(tenantId);
      if (listings < REVIEW_MIN_PRODUCTS) return 'skipped';
      const unsubscribe = await unsubscribeLinks(tenantId);
      const email = reviewRequest({
        firstName: profile.firstName,
        listings,
        starUrl: await reviewLink(tenantId),
        unsubscribeUrl: unsubscribe.page,
      });
      return sendOnce(profile, user.email, 'review-request', email, unsubscribe.oneClick);
    }
    case 'referral': {
      if (profile.marketingOptOut) return 'opted-out';
      if (!(await isSubscribedNow(tenantId))) return 'skipped';
      const code = await ensureReferralCode(profile);
      const unsubscribe = await unsubscribeLinks(tenantId);
      const email = referralInvite({
        siteUrl: config.siteUrl,
        firstName: profile.firstName,
        linkLabel: referralLink(code).label,
        unsubscribeUrl: unsubscribe.page,
      });
      return sendOnce(profile, user.email, 'referral-invite', email, unsubscribe.oneClick);
    }
  }
}

export async function handler(event: unknown): Promise<{ result: StepResult }> {
  const result = await runStep(event);
  const e = event as { step?: string; tenantId?: string };
  console.info('Scheduled step', { step: e?.step, tenantId: e?.tenantId, result });
  return { result };
}
