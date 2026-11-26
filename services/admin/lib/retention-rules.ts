/**
 * When a seller account's data is deleted (agreed rules, see the 3b plan):
 *
 *   free unlimited (exempt)        never
 *   on hold (staff)                never, while the hold is on
 *   disabled by staff              never automatically; staff are told once it
 *                                  has been disabled for 12 months, to decide
 *   paid, then stopped paying      12 months after the account closed
 *                                  (closed = 37 days after paid-until)
 *   never paid (trial)             12 months after the last sign-in (dashboard use)
 *
 * The seller is warned 30 days before. Nothing is ever deleted unless that
 * warning went out at least 30 days earlier, so switching the job on late, or a
 * missed email, only ever postpones a deletion.
 *
 * Pure functions: no I/O, so the money/data rules are tested in one place.
 */

import { billingStage, stageDates } from '../../shared/entitlements/billing-stage';

export const INACTIVE_MONTHS = 12;
export const DISABLED_REVIEW_MONTHS = 12;
export const WARNING_DAYS = 30;
/**
 * "Last signed in" is recorded from this date on. Older trial accounts count as
 * active on this date, so none is deleted before 12 months after it.
 */
export const ACTIVITY_TRACKED_FROM = '2026-11-26T00:00:00.000Z';

const DAY_MS = 24 * 60 * 60 * 1000;
const plusMonths = (iso: string, months: number): string => {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
};
const later = (...isos: Array<string | undefined>): string =>
  isos.filter((s): s is string => !!s && !Number.isNaN(Date.parse(s))).sort().at(-1)!;

export interface RetentionInput {
  tenantId: string;
  /** ENTITLEMENT#trial: status and paid-until. */
  entitlement?: { status: string; subscribedUntil?: string | undefined } | undefined;
  /** Admin STATE: disabled by staff, and since when. */
  disabled?: { since: string } | undefined;
  /** Admin HOLD: staff asked to keep this account's data. */
  onHold?: boolean;
  /** Last day the seller used the dashboard (engagement ACTIVITY). */
  lastActiveAt?: string | undefined;
  /** When the account was created (tenant METADATA). */
  createdAt?: string | undefined;
  /** When the 30-day warning was sent (admin RETENTION), if it was. */
  warnedAt?: string | undefined;
}

export type RetentionReason = 'closed' | 'inactive';

export type RetentionDecision =
  | { action: 'keep'; why: 'exempt' | 'hold' | 'paying' | 'open-ended' | 'not-due' | 'disabled' }
  /** Disabled by staff 12+ months ago: staff decide (never deleted automatically). */
  | { action: 'review'; disabledSince: string }
  /** Due within 30 days, or due but the warning has not gone out yet: warn the seller. */
  | { action: 'warn'; reason: RetentionReason; deleteOn: string; since: string }
  /** Warned at least 30 days ago and the date has passed. */
  | { action: 'delete'; reason: RetentionReason; deleteOn: string; since: string };

function byDate(reason: RetentionReason, dueAt: string, since: string, warnedAt: string | undefined, now: Date): RetentionDecision {
  const t = now.getTime();
  const due = Date.parse(dueAt);
  // The job runs daily: warn from 31 days before, so the date in the email is the rule's date.
  if (t < due - (WARNING_DAYS + 1) * DAY_MS) return { action: 'keep', why: 'not-due' };
  const warned = warnedAt ? Date.parse(warnedAt) : NaN;
  // A warning must have gone out at least 30 days before; if it has not, warn now
  // and delete 30 days from now at the earliest.
  if (Number.isNaN(warned)) {
    const deleteOn = new Date(Math.max(due, t + WARNING_DAYS * DAY_MS)).toISOString();
    return { action: 'warn', reason, deleteOn, since };
  }
  const earliest = Math.max(due, warned + WARNING_DAYS * DAY_MS);
  if (t >= earliest) return { action: 'delete', reason, deleteOn: new Date(earliest).toISOString(), since };
  return { action: 'keep', why: 'not-due' };
}

export function retentionDecision(i: RetentionInput, now: Date = new Date()): RetentionDecision {
  const e = i.entitlement;
  if (e?.status === 'exempt') return { action: 'keep', why: 'exempt' };
  if (i.onHold) return { action: 'keep', why: 'hold' };
  if (i.disabled) {
    const reviewAt = Date.parse(plusMonths(i.disabled.since, DISABLED_REVIEW_MONTHS));
    return now.getTime() >= reviewAt ? { action: 'review', disabledSince: i.disabled.since } : { action: 'keep', why: 'disabled' };
  }

  if (e?.status === 'subscribed') {
    if (!e.subscribedUntil || Number.isNaN(Date.parse(e.subscribedUntil))) return { action: 'keep', why: 'open-ended' };
    if (billingStage(e, now) !== 'closed') {
      // Not closed yet: nothing is due, unless the 30-day warning window has
      // already started (it cannot before closing: 12 months > 30 days).
      return { action: 'keep', why: 'paying' };
    }
    const d = stageDates(e.subscribedUntil);
    return byDate('closed', d.dataKeptUntil, d.closesAt, i.warnedAt, now);
  }

  // Never paid (trial, or signed up and left): 12 months after the last use.
  const lastActive = later(i.lastActiveAt, i.createdAt, ACTIVITY_TRACKED_FROM);
  return byDate('inactive', plusMonths(lastActive, INACTIVE_MONTHS), lastActive, i.warnedAt, now);
}

/** When this account's data would be deleted if nothing changes (for the admin dashboard). */
export function plannedDeletion(i: RetentionInput, now: Date = new Date()): { on: string; reason: RetentionReason } | null {
  const e = i.entitlement;
  if (e?.status === 'exempt' || i.onHold || i.disabled) return null;
  if (e?.status === 'subscribed') {
    if (!e.subscribedUntil || Number.isNaN(Date.parse(e.subscribedUntil))) return null;
    // Still paying (or in the pause): only once it closes does the 12 months start.
    if (billingStage(e, now) !== 'closed') return null;
    return { on: stageDates(e.subscribedUntil).dataKeptUntil, reason: 'closed' };
  }
  const lastActive = later(i.lastActiveAt, i.createdAt, ACTIVITY_TRACKED_FROM);
  return { on: plusMonths(lastActive, INACTIVE_MONTHS), reason: 'inactive' };
}
