/**
 * Runs a scheduled lifecycle step (EventBridge Scheduler, see lib/schedule.ts).
 * Every rule is checked again at send time, because a lot can change in a month:
 *
 *   tips, training   account still exists
 *   review           still exists, not opted out, has not reviewed, 5+ products
 *   referral         still exists, not opted out, still subscribed
 *   qualify          the referred seller is still subscribed 14 days after paying AND is
 *                    actively using MerchOS (10+ products): the referrer earns one free
 *                    month (recorded; applied by staff until checkout does it). Under 10
 *                    products: checked again weekly, up to 90 days after paying.
 */

import { z } from 'zod';
import { countProducts, getUser, isSubscribedNow } from '../lib/accounts';
import { config } from '../lib/config';
import {
  REVIEW_MIN_PRODUCTS,
  ensureReferralCode,
  referralLink,
  reviewLink,
  sendOnce,
  unsubscribeLinks,
} from '../lib/lifecycle';
import { getProfile, getReferral, hasReviewed, transitionReferral } from '../lib/store';
import { scheduleStep } from '../lib/schedule';
import { referralInvite, reviewRequest, tips, training } from '../lib/templates';

const eventSchema = z.object({
  step: z.enum(['tips', 'training', 'review', 'referral', 'qualify']),
  tenantId: z.string().uuid(),
  referrerTenantId: z.string().uuid().optional(),
  attempt: z.number().int().min(0).max(20).optional(),
});

export type StepResult = 'sent' | 'skipped' | 'duplicate' | 'opted-out' | 'qualified' | 'lapsed' | 'waiting';

/** A referred seller is "actively using" MerchOS once they have this many products. */
export const REFERRAL_MIN_PRODUCTS = 10;
/** How long after their first payment they have to get there. */
export const REFERRAL_ACTIVITY_WINDOW_DAYS = 90;

async function qualify(tenantId: string, referrerTenantId: string, attempt: number): Promise<StepResult> {
  const referral = await getReferral(referrerTenantId, tenantId);
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
    if (ok) console.info('Referral qualified: free month earned', { referrerTenantId, tenantId });
    return ok ? 'qualified' : 'skipped';
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
