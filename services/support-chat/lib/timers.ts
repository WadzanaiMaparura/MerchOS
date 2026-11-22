/**
 * One-off EventBridge Scheduler timers for a waiting chat:
 *   +60s  second push alert; visitor sees "Still finding someone…"
 *   +120s no one answered: mark MISSED, email support, open the details form
 * Each schedule deletes itself after it fires. The timer handler re-checks the
 * conversation, so an accepted chat simply ignores them.
 */

import { CreateScheduleCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { config } from './config';

export type TimerStep = 'remind' | 'timeout';
export const TIMER_DELAYS_SECONDS: Record<TimerStep, number> = { remind: 60, timeout: 120 };

export interface TimerEvent {
  conversationId: string;
  step: TimerStep;
}

let scheduler: SchedulerClient | undefined;

/** Scheduler `at()` takes UTC wall time without a zone suffix, to the second. */
export function atExpression(when: Date): string {
  return `at(${when.toISOString().slice(0, 19)})`;
}

export async function scheduleWaitingTimers(conversationId: string, now: Date = new Date()): Promise<void> {
  scheduler ??= new SchedulerClient({});
  await Promise.all(
    (Object.keys(TIMER_DELAYS_SECONDS) as TimerStep[]).map((step) =>
      scheduler!.send(
        new CreateScheduleCommand({
          Name: `chat-${conversationId}-${step}`,
          GroupName: config.scheduleGroup,
          ScheduleExpression: atExpression(new Date(now.getTime() + TIMER_DELAYS_SECONDS[step] * 1000)),
          ScheduleExpressionTimezone: 'UTC',
          FlexibleTimeWindow: { Mode: 'OFF' },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: config.timerFunctionArn,
            RoleArn: config.schedulerRoleArn,
            Input: JSON.stringify({ conversationId, step } satisfies TimerEvent),
            RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 },
          },
        }),
      ),
    ),
  );
}
