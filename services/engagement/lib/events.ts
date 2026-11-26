/**
 * Engagement domain events on the shared bus (merch-os-events-<env>).
 *
 *   engagement.referral.reward-earned   a referral free month is owed to the
 *     referrer. Billing applies it (paid-until one month later; for a card on
 *     file, the next charge moves too) and answers with
 *     billing.subscription.extended. Sent when the reward is earned, and again
 *     after each payment while it is still owed. Billing is idempotent per
 *     referral, so repeats never add a second month.
 *
 * Detail: { referrerTenantId, referredTenantId }. No personal data.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export const ENGAGEMENT_EVENT_SOURCE = 'merch-os.engagement';

/** Free months applied automatically. Off unless REFERRAL_FREE_MONTHS=true. */
export function isReferralFreeMonthsOn(): boolean {
  return process.env['REFERRAL_FREE_MONTHS'] === 'true';
}

export interface RewardEarnedDetail {
  referrerTenantId: string;
  referredTenantId: string;
}

let client: EventBridgeClient | undefined;

/** @internal tests only */
export function _setEventBridgeClient(value: EventBridgeClient | undefined): void {
  client = value;
}

export async function emitRewardEarned(detail: RewardEarnedDetail): Promise<void> {
  const bus = process.env['EVENT_BUS_NAME'];
  if (!bus) throw new Error('EVENT_BUS_NAME is not configured');
  client ??= new EventBridgeClient({});
  const out = await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: ENGAGEMENT_EVENT_SOURCE,
          DetailType: 'engagement.referral.reward-earned',
          Detail: JSON.stringify(detail),
          EventBusName: bus,
        },
      ],
    }),
  );
  if (out.FailedEntryCount) {
    throw new Error(`EventBridge rejected the event: ${out.Entries?.[0]?.ErrorCode ?? 'unknown'}`);
  }
}
