/**
 * Later lifecycle steps as one-off EventBridge Scheduler schedules. Each
 * deletes itself after it fires; the scheduled handler re-checks everything
 * (account still exists, opted out, already sent) before sending.
 *
 *   Trial track       tips +2 days, training +5 days      (from sign-up)
 *   Subscriber track  review +30 days, referral +35 days  (from first payment)
 *   Referral check    qualify +14 days, then weekly       (from the referred seller's first payment;
 *                                                       weekly while they have under 10 products)
 *   Payment cycle     due7 ... wb180                      (from each payment's paid-until; billing-cycle.ts)
 */

import { ConflictException, CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { BILLING_STEPS, billingDueDate, isBillingStep, type BillingStep } from './billing-cycle';
import { config } from './config';

export type LifecycleStep = 'tips' | 'training' | 'review' | 'referral' | 'qualify';
export type ScheduledStep = LifecycleStep | BillingStep;

export const STEP_DELAY_DAYS: Record<LifecycleStep, number> = {
  tips: 2,
  training: 5,
  review: 30,
  referral: 35,
  qualify: 14,
};

export interface ScheduledEvent {
  step: ScheduledStep;
  tenantId: string;
  /** qualify only: the seller who referred `tenantId`. */
  referrerTenantId?: string;
  /** qualify only: 0 = the 14-day check, 1+ = weekly re-checks for activity. */
  attempt?: number;
  /** Payment-cycle steps: the paid-until these emails are about. */
  paidUntil?: string;
  /** Payment-cycle steps: the plan that was paid for. */
  planId?: string;
}

/** Days between re-checks while a referred seller has not yet added enough products. */
export const RECHECK_DAYS = 7;

let scheduler: SchedulerClient | undefined;

/** @internal tests only */
export function _setScheduler(value: SchedulerClient | undefined): void {
  scheduler = value;
}

/** Scheduler `at()` takes UTC wall time without a zone suffix, to the second. */
export function atExpression(when: Date): string {
  return `at(${when.toISOString().slice(0, 19)})`;
}

/**
 * Emails land at 9am South African time (07:00 UTC) on the due day, not at
 * whatever hour the seller signed up. The referral check runs exactly 14 days on.
 */
export function dueDate(step: LifecycleStep, from: Date, attempt = 0): Date {
  const days = step === 'qualify' && attempt > 0 ? RECHECK_DAYS : STEP_DELAY_DAYS[step];
  const due = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  if (step !== 'qualify') due.setUTCHours(7, 0, 0, 0);
  return due;
}

/** Schedule name, <= 64 chars. */
export function scheduleName(event: ScheduledEvent): string {
  if (isBillingStep(event.step)) {
    // One set per paid period: "eng-paused-<uuid>-20261222" (56 chars).
    const day = (event.paidUntil ?? '').slice(0, 10).replace(/-/g, '');
    return `eng-${event.step}-${event.tenantId}-${day}`;
  }
  // "eng-qualify-" + 36-char uuid + "-12". Re-checks get their own name: the
  // schedule that is firing right now still exists while it creates the next one.
  return `eng-${event.step}-${event.tenantId}${event.attempt ? `-${event.attempt}` : ''}`;
}

/** When a step is due. Payment-cycle steps count from the paid-until, the others from `from`. */
export function stepDueDate(event: ScheduledEvent, from: Date): Date {
  if (isBillingStep(event.step)) {
    if (!event.paidUntil) throw new Error('A payment-cycle step needs paidUntil');
    return billingDueDate(event.step, event.paidUntil);
  }
  return dueDate(event.step, from, event.attempt ?? 0);
}

/**
 * Books every payment-cycle email for a paid period (at each payment). Steps
 * already in the past are skipped (e.g. "due in 7 days" when only 5 are left).
 */
export async function scheduleBillingSteps(
  tenantId: string,
  paidUntil: string,
  planId: string,
  now: Date = new Date(),
): Promise<BillingStep[]> {
  const booked: BillingStep[] = [];
  for (const step of BILLING_STEPS) {
    if (billingDueDate(step, paidUntil).getTime() <= now.getTime()) continue;
    await scheduleStep({ step, tenantId, paidUntil, planId }, now);
    booked.push(step);
  }
  return booked;
}

/** Idempotent: a schedule that already exists (event retry) is left alone. */
export async function scheduleStep(event: ScheduledEvent, from: Date = new Date()): Promise<void> {
  scheduler ??= new SchedulerClient({});
  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: scheduleName(event),
        GroupName: config.scheduleGroup,
        ScheduleExpression: atExpression(stepDueDate(event, from)),
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'FLEXIBLE', MaximumWindowInMinutes: 60 },
        ActionAfterCompletion: 'DELETE',
        Target: {
          Arn: config.scheduledFunctionArn,
          RoleArn: config.schedulerRoleArn,
          Input: JSON.stringify(event),
          RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 6 * 60 * 60 },
        },
      }),
    );
  } catch (error) {
    if (error instanceof ConflictException || (error as { name?: string }).name === 'ConflictException') return;
    throw error;
  }
}
