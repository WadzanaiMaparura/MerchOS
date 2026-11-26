/**
 * EventBridge consumer (bus merch-os-events-<env>).
 *
 *   auth.user.registered            (merch-os.auth)     trial welcome now; tips day 2, training day 5
 *   billing.subscription.activated  (merch-os.billing)  every payment: this period's payment-cycle
 *                                                       emails (billing-cycle.ts), and "welcome back"
 *                                                       after a pause. First payment only: subscription
 *                                                       welcome now; review day 30, referral day 35; and
 *                                                       a referred seller's 14-day referral check.
 *                                                       Free months still owed to this seller are
 *                                                       requested from billing (REFERRAL_FREE_MONTHS)
 *   billing.subscription.extended   (merch-os.billing)  a free month was added: reward applied,
 *                                                       reminders booked for the new paid-until
 *
 * Both events can be delivered more than once (and auth.user.registered has two
 * emitters), so every step is idempotent: emails have a sent marker and
 * schedules have fixed names.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { z } from 'zod';
import { GRACE_DAYS, isBillingLifecycleOn } from '../../shared/entitlements/billing-stage';
import { TRIAL_PRODUCT_LIMIT } from '../../shared/entitlements/trial-gate';
import { countProducts, ensureProfile, getPaidStatus, getUser } from '../lib/accounts';
import { welcomeBack } from '../lib/billing-templates';
import { config } from '../lib/config';
import { ensureReferralCode, sendOnce } from '../lib/lifecycle';
import { scheduleBillingSteps, scheduleStep } from '../lib/schedule';
import { emitRewardEarned, isReferralFreeMonthsOn } from '../lib/events';
import {
  getReferral,
  listReferralsBy,
  markFirstSubscription,
  markRewardApplied,
  transitionReferral,
  wasSent,
} from '../lib/store';
import { subscriptionWelcome, trialWelcome } from '../lib/templates';

const registeredSchema = z.object({
  userId: z.string().min(1).max(128),
  tenantId: z.string().uuid(),
});

const activatedSchema = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().min(1).max(40),
  planName: z.string().min(1).max(60),
  monthlyProducts: z.number().int().positive().nullable(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  previousPeriodEnd: z.string().datetime().optional(),
});

const extendedSchema = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().min(1).max(40),
  reason: z.literal('referral-free-month'),
  referredTenantId: z.string().uuid(),
  periodEnd: z.string().datetime(),
  previousPeriodEnd: z.string().datetime(),
});

/** rewardAppliedBy for free months applied by billing (staff ids otherwise). */
export const AUTOMATIC = 'automatic';

/** Paid again after the plan had been paused (or closed): past the grace period. */
export function isComeback(previousPeriodEnd: string | undefined, paidAt: Date): boolean {
  if (!previousPeriodEnd) return false;
  return paidAt.getTime() >= Date.parse(previousPeriodEnd) + GRACE_DAYS * 24 * 60 * 60 * 1000;
}

export async function onRegistered(detail: unknown): Promise<void> {
  const parsed = registeredSchema.safeParse(detail);
  if (!parsed.success) {
    console.warn('auth.user.registered ignored: unexpected detail');
    return;
  }
  const { tenantId, userId } = parsed.data;
  const profile = await ensureProfile(tenantId, userId);
  if (!profile) {
    console.warn('auth.user.registered: account not found', { tenantId });
    return;
  }
  const user = await getUser(profile.userId);
  if (!user) return;

  await ensureReferralCode(profile);
  await sendOnce(
    profile,
    user.email,
    'trial-welcome',
    trialWelcome({
      siteUrl: config.siteUrl,
      firstName: profile.firstName,
      businessName: profile.businessName,
      email: user.email,
      trialProducts: TRIAL_PRODUCT_LIMIT,
    }),
  );
  const now = new Date();
  await scheduleStep({ step: 'tips', tenantId }, now);
  await scheduleStep({ step: 'training', tenantId }, now);
}

export async function onSubscriptionActivated(detail: unknown): Promise<void> {
  const parsed = activatedSchema.safeParse(detail);
  if (!parsed.success) {
    console.warn('billing.subscription.activated ignored: unexpected detail');
    return;
  }
  const d = parsed.data;
  const profile = await ensureProfile(d.tenantId);
  if (!profile) {
    console.warn('billing.subscription.activated: account not found', { tenantId: d.tenantId });
    return;
  }

  // A referred seller's first payment starts the 14-day check (PENDING only,
  // so renewals and repeat deliveries do nothing).
  if (profile.referredByTenantId) {
    const qualifyAt = new Date(new Date(d.periodStart).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const moved = await transitionReferral(profile.referredByTenantId, d.tenantId, ['PENDING'], 'SUBSCRIBED', {
      subscribedAt: d.periodStart,
      qualifyAt,
    });
    if (moved) {
      await scheduleStep({ step: 'qualify', tenantId: d.tenantId, referrerTenantId: profile.referredByTenantId }, new Date(d.periodStart));
    }
  }

  // Every payment books this paid period's reminders and, if it is not renewed,
  // the pause, closing and win-back emails. Each checks at send time.
  await scheduleBillingSteps(d.tenantId, d.periodEnd, d.planId);

  // Free months this seller earned while not paying are applied now, one month each.
  if (isReferralFreeMonthsOn()) {
    for (const r of await listReferralsBy(d.tenantId)) {
      if (r.reward === 'EARNED') await emitRewardEarned({ referrerTenantId: d.tenantId, referredTenantId: r.referredTenantId });
    }
  }

  // Back after a pause or closing: a "welcome back" (once per return).
  if (isComeback(d.previousPeriodEnd, new Date()) && isBillingLifecycleOn()) {
    const user = await getUser(profile.userId);
    if (user?.enabled) {
      await sendOnce(
        profile,
        user.email,
        `welcome-back#${d.periodEnd}`,
        welcomeBack({
          siteUrl: config.siteUrl,
          firstName: profile.firstName,
          planName: d.planName,
          monthlyProducts: d.monthlyProducts,
          productCount: await countProducts(d.tenantId),
          paidUntil: d.periodEnd,
        }),
      );
    }
  }

  // Only the first activation sends the welcome and starts the subscriber
  // track. A retry after a failed first attempt still finds the welcome unsent.
  const first = await markFirstSubscription(d.tenantId, d.planId, d.periodStart);
  if (!first && (await wasSent(d.tenantId, 'subscription-welcome'))) return;

  const user = await getUser(profile.userId);
  if (!user) return;
  const existingProducts = await countProducts(d.tenantId);
  await sendOnce(
    profile,
    user.email,
    'subscription-welcome',
    subscriptionWelcome({
      siteUrl: config.siteUrl,
      firstName: profile.firstName,
      planName: d.planName,
      monthlyProducts: d.monthlyProducts,
      existingProducts,
      paidUntil: d.periodEnd,
      autoRenew: (await getPaidStatus(d.tenantId).catch(() => null))?.autoRenew === true,
    }),
  );
  const from = new Date(d.periodStart);
  await scheduleStep({ step: 'review', tenantId: d.tenantId }, from);
  await scheduleStep({ step: 'referral', tenantId: d.tenantId }, from);
}

/**
 * A referral free month was added to paid-until: the reward is applied, and
 * this new paid-until gets its reminders (the old ones see a later paid-until
 * and stay quiet).
 */
export async function onSubscriptionExtended(detail: unknown): Promise<void> {
  const parsed = extendedSchema.safeParse(detail);
  if (!parsed.success) {
    console.warn('billing.subscription.extended ignored: unexpected detail');
    return;
  }
  const d = parsed.data;
  const marked = await markRewardApplied(d.tenantId, d.referredTenantId, AUTOMATIC);
  if (!marked) {
    const r = await getReferral(d.tenantId, d.referredTenantId);
    // Already applied: a repeat delivery. Anything else is worth a look.
    if (r?.reward !== 'APPLIED') console.warn('Free month added but the referral was not owed one', { tenantId: d.tenantId });
  }
  await scheduleBillingSteps(d.tenantId, d.periodEnd, d.planId);
  console.info('Referral free month applied', { tenantId: d.tenantId, periodEnd: d.periodEnd });
}

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  switch (event['detail-type']) {
    case 'auth.user.registered':
      return onRegistered(event.detail);
    case 'billing.subscription.activated':
      return onSubscriptionActivated(event.detail);
    case 'billing.subscription.extended':
      return onSubscriptionExtended(event.detail);
    default:
      console.info('Event ignored', { detailType: event['detail-type'] });
  }
}
