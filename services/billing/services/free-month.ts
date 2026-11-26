/**
 * Referral free month, applied automatically. Off unless REFERRAL_FREE_MONTHS=true.
 *
 * The seller promise: "your next monthly payment is skipped". A free month
 * moves the referrer's paid-until one month later:
 *   - paying by EFT or once-off: reminders, grace and pause all follow
 *     paid-until, so the next reminder simply comes a month later
 *   - card on file: PayFast's next charge date moves to the new paid-until as
 *     well, so the card is not charged for the free month
 *
 * Only while a paid month is running. A referrer on the free trial, or whose
 * month has run out, keeps the free month owed; engagement asks again after
 * each of their payments, so it lands straight after the next one.
 *
 * Idempotent per referral (credit id REF-<referredTenantId>):
 *   1. CREDIT#<id> records where paid-until is going (before anything changes)
 *   2. PayFast's next charge date moves (card on file only; safe to repeat)
 *   3. paid-until moves, in one conditional write that also adds the credit id
 *      to the subscription, so a repeat or a race can never add a second month
 *   4. the product allowance follows (markSubscribed never shortens)
 *   5. the credit is marked applied
 * A retry resumes at whichever step did not finish.
 */

import { getPlan } from '../config/plans';
import type { PlanId } from '@merch-os/types';
import { markSubscribed } from '../../shared/entitlements/trial-gate';
import type { SubscriptionsApi } from '../providers/payfast-subscriptions';
import { sastDate } from './card-billing';
import {
  extendPaidUntil,
  getFreeMonthCredit,
  getSubscription,
  markFreeMonthCreditApplied,
  saveFreeMonthCredit,
} from './subscription-store';

export function isReferralFreeMonthsOn(): boolean {
  return process.env['REFERRAL_FREE_MONTHS'] === 'true';
}

export const referralCreditId = (referredTenantId: string): string => `REF-${referredTenantId}`;

export const plusOneMonth = (iso: string): string => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

export type FreeMonthOutcome =
  | { outcome: 'switched-off' }
  /** No paid month running: stays owed until the next payment. */
  | { outcome: 'not-paying' }
  | { outcome: 'applied' | 'already'; planId: string; fromEnd: string; toEnd: string };

export interface FreeMonthDeps {
  subscriptionsApi: () => Promise<SubscriptionsApi>;
  now?: () => Date;
}

/** Paid-until moved by a payment or another free month at the same moment: read again. */
const MAX_ATTEMPTS = 4;

export async function applyReferralFreeMonth(
  referrerTenantId: string,
  referredTenantId: string,
  deps: FreeMonthDeps,
): Promise<FreeMonthOutcome> {
  if (!isReferralFreeMonthsOn()) return { outcome: 'switched-off' };
  const now = deps.now?.() ?? new Date();
  const creditId = referralCreditId(referredTenantId);

  const credit = await getFreeMonthCredit(referrerTenantId, creditId);
  if (credit?.appliedAt && credit.fromEnd && credit.toEnd) {
    return { outcome: 'already', planId: credit.planId ?? '', fromEnd: credit.fromEnd, toEnd: credit.toEnd };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const sub = await getSubscription(referrerTenantId);
    if (!sub) return { outcome: 'not-paying' };

    // Paid-until already moved for this credit (an earlier attempt stopped after step 3).
    if (sub.freeMonthCredits?.has(creditId) && credit?.fromEnd && credit.toEnd) {
      return finish(referrerTenantId, creditId, sub.planId, credit.fromEnd, credit.toEnd, sub.autoRenew);
    }

    const end = sub.currentPeriodEnd;
    if (sub.status !== 'active' || !end || Date.parse(end) <= now.getTime()) return { outcome: 'not-paying' };

    const fromEnd = end;
    const toEnd = plusOneMonth(fromEnd);
    await saveFreeMonthCredit(referrerTenantId, { creditId, referredTenantId, planId: sub.planId, fromEnd, toEnd });

    // The card would otherwise be charged on the old date. Whatever our own
    // switches say, a live PayFast subscription charges, so move it whenever
    // there is one.
    if (sub.autoRenew === true && sub.payfastToken) {
      await (await deps.subscriptionsApi()).setNextChargeDate(sub.payfastToken, sastDate(new Date(toEnd)));
    }

    if (await extendPaidUntil(referrerTenantId, fromEnd, toEnd, creditId)) {
      return finish(referrerTenantId, creditId, sub.planId, fromEnd, toEnd, sub.autoRenew);
    }
  }
  throw new Error('Paid-until kept changing; the free month will be retried');
}

async function finish(
  tenantId: string,
  creditId: string,
  planId: string,
  fromEnd: string,
  toEnd: string,
  autoRenew: boolean | undefined,
): Promise<FreeMonthOutcome> {
  const plan = getPlan(planId as PlanId);
  await markSubscribed(tenantId, toEnd, {
    monthlyProductLimit: plan?.monthlyProducts ?? null,
    ...(autoRenew !== undefined ? { autoRenew } : {}),
  });
  await markFreeMonthCreditApplied(tenantId, creditId);
  return { outcome: 'applied', planId, fromEnd, toEnd };
}
