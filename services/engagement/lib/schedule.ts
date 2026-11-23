/**
 * Later lifecycle steps as one-off EventBridge Scheduler schedules. Each
 * deletes itself after it fires; the scheduled handler re-checks everything
 * (account still exists, opted out, already sent) before sending.
 *
 *   Trial track       tips +2 days, training +5 days      (from sign-up)
 *   Subscriber track  review +30 days, referral +35 days  (from first payment)
 *   Referral check    qualify +14 days                    (from the referred seller's first payment)
 */

import { ConflictException, CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { config } from './config';

export type ScheduledStep = 'tips' | 'training' | 'review' | 'referral' | 'qualify';

export const STEP_DELAY_DAYS: Record<ScheduledStep, number> = {
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
}

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
export function dueDate(step: ScheduledStep, from: Date): Date {
  const due = new Date(from.getTime() + STEP_DELAY_DAYS[step] * 24 * 60 * 60 * 1000);
  if (step !== 'qualify') due.setUTCHours(7, 0, 0, 0);
  return due;
}

/** Idempotent: a schedule that already exists (event retry) is left alone. */
export async function scheduleStep(event: ScheduledEvent, from: Date = new Date()): Promise<void> {
  scheduler ??= new SchedulerClient({});
  try {
    await scheduler.send(
      new CreateScheduleCommand({
        // <= 64 chars: "eng-referral-" + a 36-char uuid.
        Name: `eng-${event.step}-${event.tenantId}`,
        GroupName: config.scheduleGroup,
        ScheduleExpression: atExpression(dueDate(event.step, from)),
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
