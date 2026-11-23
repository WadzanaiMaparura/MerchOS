/**
 * Runs a scheduled lifecycle step (EventBridge Scheduler, see lib/schedule.ts).
 * Every rule is checked again at send time, because a lot can change in a month:
 *
 *   tips, training   account still exists
 *   review           still exists, not opted out, has not reviewed, 5+ products
 *   referral         still exists, not opted out, still subscribed
 *   qualify          the referred seller is still subscribed 14 days after paying:
 *                    the referrer earns one free month (recorded; applied by billing later)
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
import { referralInvite, reviewRequest, tips, training } from '../lib/templates';

const eventSchema = z.object({
  step: z.enum(['tips', 'training', 'review', 'referral', 'qualify']),
  tenantId: z.string().uuid(),
  referrerTenantId: z.string().uuid().optional(),
});

export type StepResult = 'sent' | 'skipped' | 'duplicate' | 'opted-out' | 'qualified' | 'lapsed';

async function qualify(tenantId: string, referrerTenantId: string): Promise<StepResult> {
  const referral = await getReferral(referrerTenantId, tenantId);
  if (referral?.status !== 'SUBSCRIBED') return 'skipped';
  const now = new Date().toISOString();
  if (await isSubscribedNow(tenantId)) {
    const ok = await transitionReferral(referrerTenantId, tenantId, ['SUBSCRIBED'], 'QUALIFIED', {
      qualifiedAt: now,
      reward: 'EARNED',
    });
    if (ok) console.info('Referral qualified: free month earned', { referrerTenantId, tenantId });
    return ok ? 'qualified' : 'skipped';
  }
  const ok = await transitionReferral(referrerTenantId, tenantId, ['SUBSCRIBED'], 'LAPSED', { lapsedAt: now });
  return ok ? 'lapsed' : 'skipped';
}

export async function runStep(input: unknown): Promise<StepResult> {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) {
    console.warn('Scheduled step ignored: unexpected input');
    return 'skipped';
  }
  const { step, tenantId, referrerTenantId } = parsed.data;

  if (step === 'qualify') {
    return referrerTenantId ? qualify(tenantId, referrerTenantId) : 'skipped';
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
