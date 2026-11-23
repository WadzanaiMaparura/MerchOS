/**
 * EventBridge consumer (bus merch-os-events-<env>).
 *
 *   auth.user.registered            (merch-os.auth)     trial welcome now; tips day 2, training day 5
 *   billing.subscription.activated  (merch-os.billing)  first payment only: subscription welcome now;
 *                                                       review day 30, referral day 35; and a
 *                                                       referred seller's 14-day referral check
 *
 * Both events can be delivered more than once (and auth.user.registered has two
 * emitters), so every step is idempotent: emails have a sent marker and
 * schedules have fixed names.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { z } from 'zod';
import { TRIAL_PRODUCT_LIMIT } from '../../shared/entitlements/trial-gate';
import { countProducts, ensureProfile, getUser } from '../lib/accounts';
import { config } from '../lib/config';
import { ensureReferralCode, sendOnce } from '../lib/lifecycle';
import { scheduleStep } from '../lib/schedule';
import { markFirstSubscription, transitionReferral, wasSent } from '../lib/store';
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
});

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
      billingDay: new Date(d.periodStart).getUTCDate(),
    }),
  );
  const from = new Date(d.periodStart);
  await scheduleStep({ step: 'review', tenantId: d.tenantId }, from);
  await scheduleStep({ step: 'referral', tenantId: d.tenantId }, from);
}

export async function handler(event: EventBridgeEvent<string, unknown>): Promise<void> {
  switch (event['detail-type']) {
    case 'auth.user.registered':
      return onRegistered(event.detail);
    case 'billing.subscription.activated':
      return onSubscriptionActivated(event.detail);
    default:
      console.info('Event ignored', { detailType: event['detail-type'] });
  }
}
