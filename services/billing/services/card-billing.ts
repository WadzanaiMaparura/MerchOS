/**
 * Card subscription rules (automatic monthly charges). Pure functions only, so
 * the money rules are tested in one place.
 *
 *   Subscribe        first charge now (voucher / comeback offer apply to it),
 *                    then the full plan price every month
 *   Upgrade          today: new price minus the unused part of the current
 *                    month; the new plan and a fresh month start now
 *   Downgrade        no charge now; the lower price from the next charge date
 *                    (the higher plan runs to the end of the month paid for)
 *   Same plan        nothing to do (already charged automatically)
 */

import { PAYFAST_MIN_CHARGE_CENTS } from './vouchers';

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanChangeKind = 'subscribe' | 'upgrade' | 'downgrade' | 'same';

export interface CurrentCardPlan {
  planId: string;
  priceCents: number;
  periodStart: string;
  periodEnd: string;
}

/** What kind of change this is, for a seller on automatic billing (or not). */
export function planChangeKind(
  current: CurrentCardPlan | null,
  newPlanId: string,
  newPriceCents: number,
  now: Date = new Date(),
): PlanChangeKind {
  if (!current || Date.parse(current.periodEnd) <= now.getTime()) return 'subscribe';
  if (current.planId === newPlanId) return 'same';
  return newPriceCents > current.priceCents ? 'upgrade' : 'downgrade';
}

export interface UpgradeQuote {
  /** Value of the unused part of the current month (integer cents, rounded down). */
  creditCents: number;
  /** What is charged today. */
  chargeCents: number;
  unusedDays: number;
}

/**
 * Upgrade top-up. The credit is the CURRENT plan's price for the unused share
 * of the paid month, rounded down (in our favour by under a cent), and the
 * charge never goes below PayFast's minimum.
 */
export function upgradeQuote(current: CurrentCardPlan, newPriceCents: number, now: Date = new Date()): UpgradeQuote {
  const start = Date.parse(current.periodStart);
  const end = Date.parse(current.periodEnd);
  const total = Math.max(1, end - start);
  const left = Math.min(total, Math.max(0, end - now.getTime()));
  const creditCents = Math.floor((current.priceCents * left) / total);
  const chargeCents = Math.max(PAYFAST_MIN_CHARGE_CENTS, newPriceCents - creditCents);
  return { creditCents, chargeCents, unusedDays: Math.round(left / DAY_MS) };
}

/** YYYY-MM-DD in South African time (PayFast billing dates are dates, not times). */
export function sastDate(at: Date): string {
  return new Date(at.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const plusOneMonth = (iso: string): string => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
};

/**
 * When the first AUTOMATIC charge happens: one month after the month the first
 * payment buys starts. `monthStart` is that start (now, or the end of a
 * still-running month when renewing the same plan early).
 */
export function firstRecurringDate(monthStart: string): string {
  return sastDate(new Date(plusOneMonth(monthStart)));
}

/**
 * A monthly charge arrived: the month it buys always continues from the
 * current paid-until when that is still ahead (a charge taken a day early
 * never loses a day), otherwise starts now (charge after a failed month).
 */
export function renewalPeriod(currentEnd: string | undefined, now: Date): { start: string; end: string } {
  const start = currentEnd && Date.parse(currentEnd) > now.getTime() ? currentEnd : now.toISOString();
  return { start, end: plusOneMonth(start) };
}

/** Plan whose price matches a monthly charge (downgrades switch at the charge). */
export function planForRenewal(
  sub: { planId: string; nextPlanId?: string | undefined },
  amountCents: number,
  priceOf: (planId: string) => number | null,
): string | null {
  if (sub.nextPlanId && priceOf(sub.nextPlanId) === amountCents) return sub.nextPlanId;
  if (priceOf(sub.planId) === amountCents) return sub.planId;
  return null;
}
