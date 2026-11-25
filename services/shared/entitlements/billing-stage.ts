/**
 * Where a paying seller is in the payment cycle, worked out from the end of the
 * paid period alone (no status writes, no daily job). Billing, the product gates,
 * engagement emails and the admin dashboard all use these same rules.
 *
 *   paid      more than 7 days of the paid month left
 *   due_soon  the last 7 days (reminder emails, "payment due" banner)
 *   grace     up to 3 days after the end: everything still works
 *   paused    day 3 to 37: can sign in, view, edit, export and pay; no new
 *             products and no new listings written
 *   closed    from day 37: only the Welcome back page (pay to reopen); data kept
 *             for 12 months
 *
 * A seller who has never paid is 'none' (trial rules); free unlimited accounts
 * are 'exempt'. Paying again (at any stage) moves the seller straight back to 'paid'.
 */

export type BillingStage = 'none' | 'exempt' | 'paid' | 'due_soon' | 'grace' | 'paused' | 'closed';

export const DUE_SOON_DAYS = 7;
export const GRACE_DAYS = 3;
export const CLOSE_AFTER_DAYS = 37;
export const DATA_KEPT_MONTHS = 12;

/** Win-back offer: 50% off the first month back, for 14 days from day 90. */
export const COMEBACK_PERCENT_OFF = 50;
export const COMEBACK_FROM_DAYS = 90;
export const COMEBACK_FOR_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY_MS).toISOString();

/** The minimum the stage needs from the entitlement record (ENTITLEMENT#trial). */
export interface StageInput {
  status: string;
  subscribedUntil?: string | undefined;
}

export function billingStage(e: StageInput | null | undefined, now: Date = new Date()): BillingStage {
  if (!e) return 'none';
  if (e.status === 'exempt') return 'exempt';
  if (e.status !== 'subscribed') return 'none';
  // A subscription with no end date is an open-ended (custom) plan.
  if (!e.subscribedUntil) return 'paid';
  const t = now.getTime();
  const until = Date.parse(e.subscribedUntil);
  if (Number.isNaN(until)) return 'paid';
  if (t < until - DUE_SOON_DAYS * DAY_MS) return 'paid';
  if (t < until) return 'due_soon';
  if (t < until + GRACE_DAYS * DAY_MS) return 'grace';
  if (t < until + CLOSE_AFTER_DAYS * DAY_MS) return 'paused';
  return 'closed';
}

/** True while the seller may still add products and have listings written. */
export const stageAllowsNewWork = (stage: BillingStage): boolean =>
  stage === 'paid' || stage === 'due_soon' || stage === 'grace';

export interface StageDates {
  paidUntil: string;
  /** End of the grace period (= when the plan pauses). */
  graceEndsAt: string;
  closesAt: string;
  /** Data is kept for 12 months after the account closes. */
  dataKeptUntil: string;
  comebackStartsAt: string;
  comebackEndsAt: string;
}

export function stageDates(paidUntil: string): StageDates {
  const closesAt = addDays(paidUntil, CLOSE_AFTER_DAYS);
  const kept = new Date(closesAt);
  kept.setUTCMonth(kept.getUTCMonth() + DATA_KEPT_MONTHS);
  const comebackStartsAt = addDays(paidUntil, COMEBACK_FROM_DAYS);
  return {
    paidUntil,
    graceEndsAt: addDays(paidUntil, GRACE_DAYS),
    closesAt,
    dataKeptUntil: kept.toISOString(),
    comebackStartsAt,
    comebackEndsAt: addDays(comebackStartsAt, COMEBACK_FOR_DAYS),
  };
}

export interface ComebackOffer {
  percentOff: number;
  endsAt: string;
}

/**
 * The win-back discount, if it applies right now: only in the 14 days after the
 * day-90 email, and only once per seller (ever).
 */
export function comebackOffer(
  paidUntil: string | undefined,
  usedAt: string | undefined,
  now: Date = new Date(),
): ComebackOffer | null {
  if (!paidUntil || usedAt) return null;
  const d = stageDates(paidUntil);
  const t = now.getTime();
  if (t < Date.parse(d.comebackStartsAt) || t >= Date.parse(d.comebackEndsAt)) return null;
  return { percentOff: COMEBACK_PERCENT_OFF, endsAt: d.comebackEndsAt };
}

/** The payment reminders, pause, closing and win-back emails and screens. Off unless BILLING_LIFECYCLE=true. */
export function isBillingLifecycleOn(): boolean {
  return process.env['BILLING_LIFECYCLE'] === 'true';
}
