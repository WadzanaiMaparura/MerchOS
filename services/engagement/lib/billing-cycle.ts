/**
 * The payment-cycle emails, scheduled at every payment for that paid period
 * (one-off EventBridge Scheduler schedules, see schedule.ts). At send time each
 * step checks the seller has NOT paid for a later period since (paid-until
 * unchanged), so paying at any point quietly cancels the rest.
 *
 *   step     days from paid-until   kind
 *   due7     -7                     account
 *   due1     -1                     account
 *   paused   +3 (end of grace)      account
 *   final    +30                    account   "closes in 7 days"
 *   closed   +37                    account
 *   wb44     +44                    marketing "your products are waiting"
 *   wb60     +60                    marketing "why did you leave?"
 *   wb90     +90                    marketing 50% comeback offer (14 days)
 *   wb180    +180                   account   "kept until ..." (data notice)
 */

import { CLOSE_AFTER_DAYS, COMEBACK_FROM_DAYS, GRACE_DAYS } from '../../shared/entitlements/billing-stage';

export const BILLING_STEPS = ['due7', 'due1', 'paused', 'final', 'closed', 'wb44', 'wb60', 'wb90', 'wb180'] as const;
export type BillingStep = (typeof BILLING_STEPS)[number];

export const BILLING_STEP_DAYS: Record<BillingStep, number> = {
  due7: -7,
  due1: -1,
  paused: GRACE_DAYS,
  final: 30,
  closed: CLOSE_AFTER_DAYS,
  wb44: 44,
  wb60: 60,
  wb90: COMEBACK_FROM_DAYS,
  wb180: 180,
};

/** Marketing steps respect the unsubscribe; account notices always go. */
export const MARKETING_BILLING_STEPS: ReadonlySet<BillingStep> = new Set(['wb44', 'wb60', 'wb90']);

export const isBillingStep = (step: string): step is BillingStep => (BILLING_STEPS as readonly string[]).includes(step);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 9am South African time (07:00 UTC) on the due day. Reminders before the end
 * go out on or BEFORE the moment; notices after the end on or AFTER it (a
 * "paused" email never arrives while the plan still works).
 */
export function billingDueDate(step: BillingStep, paidUntil: string): Date {
  const days = BILLING_STEP_DAYS[step];
  const moment = Date.parse(paidUntil) + days * DAY_MS;
  const due = new Date(moment);
  due.setUTCHours(7, 0, 0, 0);
  if (days < 0 && due.getTime() > moment) due.setTime(due.getTime() - DAY_MS);
  if (days >= 0 && due.getTime() < moment) due.setTime(due.getTime() + DAY_MS);
  return due;
}

/** One email per step per paid period ("paused#2026-12-22T10:00:00.000Z"). */
export const billingEmailKey = (step: BillingStep, paidUntil: string): `${BillingStep}#${string}` =>
  `${step}#${paidUntil}`;
