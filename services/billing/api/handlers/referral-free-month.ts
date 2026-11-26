/**
 * EventBridge consumer: engagement.referral.reward-earned (merch-os.engagement).
 *
 * Engagement sends it when a referral earns a free month, and again after each
 * payment by a referrer who still has one owed. Applies the free month (see
 * services/free-month.ts) and, once applied, tells the platform with
 * billing.subscription.extended (engagement marks the reward applied and books
 * the reminders for the new paid-until).
 *
 * Errors propagate so EventBridge retries; every step is idempotent.
 */

import type { EventBridgeEvent } from 'aws-lambda';
import { z } from 'zod';
import { logger } from '../../../shared/middleware/logger';
import { loadPayFastConfig } from '../../providers/payfast';
import { PayFastSubscriptionsApi, type SubscriptionsApi } from '../../providers/payfast-subscriptions';
import { emitSubscriptionExtended } from '../../services/events';
import { applyReferralFreeMonth, type FreeMonthOutcome } from '../../services/free-month';

const detailSchema = z.object({
  referrerTenantId: z.string().uuid(),
  referredTenantId: z.string().uuid(),
});

let injectedApi: SubscriptionsApi | undefined;
/** Test seam: inject the PayFast subscriptions API. */
export function setFreeMonthSubscriptionsApi(api: SubscriptionsApi | undefined): void {
  injectedApi = api;
}

export async function handler(
  event: EventBridgeEvent<string, unknown>,
): Promise<{ result: FreeMonthOutcome['outcome'] | 'ignored' }> {
  const parsed = detailSchema.safeParse(event.detail);
  if (event['detail-type'] !== 'engagement.referral.reward-earned' || !parsed.success) {
    logger.warn('Free month request ignored: unexpected event');
    return { result: 'ignored' };
  }
  const { referrerTenantId, referredTenantId } = parsed.data;

  let out: FreeMonthOutcome;
  try {
    out = await applyReferralFreeMonth(referrerTenantId, referredTenantId, {
      subscriptionsApi: async () => injectedApi ?? new PayFastSubscriptionsApi(await loadPayFastConfig()),
    });
  } catch (error) {
    // Alarmed (billing alarms): EventBridge retries, but a seller may be charged for a free month.
    logger.error('Referral free month not applied', {
      referrerTenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (out.outcome === 'applied' || out.outcome === 'already') {
    // Also on 'already', so an attempt that stopped before telling engagement completes.
    await emitSubscriptionExtended({
      tenantId: referrerTenantId,
      planId: out.planId,
      reason: 'referral-free-month',
      referredTenantId,
      periodEnd: out.toEnd,
      previousPeriodEnd: out.fromEnd,
    });
  }
  logger.info('Referral free month', { referrerTenantId, result: out.outcome });
  return { result: out.outcome };
}
