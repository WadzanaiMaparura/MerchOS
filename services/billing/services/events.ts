/**
 * Billing domain events on the shared bus (merch-os-events-<env>).
 *
 *   billing.subscription.activated   a payment landed and the plan is active.
 *     Sent for every applied payment (first and renewals). Consumers must be
 *     idempotent and decide "first activation" themselves (engagement does).
 *
 * Detail: { tenantId, planId, planName, monthlyProducts, mPaymentId, periodStart, periodEnd }
 * No personal data (no names, emails or card details).
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export const BILLING_EVENT_SOURCE = 'merch-os.billing';

export interface SubscriptionActivatedDetail {
  tenantId: string;
  planId: string;
  planName: string;
  monthlyProducts: number | null;
  mPaymentId: string;
  periodStart: string;
  periodEnd: string;
  /** Paid-until before this payment (absent on the first payment). */
  previousPeriodEnd?: string;
}

let client: EventBridgeClient | undefined;

/** @internal tests only */
export function _setEventBridgeClient(value: EventBridgeClient | undefined): void {
  client = value;
}

export async function emitSubscriptionActivated(detail: SubscriptionActivatedDetail): Promise<void> {
  const bus = process.env['EVENT_BUS_NAME'];
  if (!bus) throw new Error('EVENT_BUS_NAME is not configured');
  client ??= new EventBridgeClient({});
  const out = await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: BILLING_EVENT_SOURCE,
          DetailType: 'billing.subscription.activated',
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
