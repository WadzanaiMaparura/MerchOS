/**
 * product.trial.usage (source merch-os.product): a free-trial seller is close
 * to, or at, the 15-product limit. Engagement turns it into a bell notification
 * ("12 of 15 used", "trial used up"), once each.
 *
 * Sent only from the last few trial slots, and only where EVENT_BUS_NAME is
 * configured. Best effort: a failure here must never block creating a product.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

export const TRIAL_EVENT_SOURCE = 'merch-os.product';
/** Notify from this many slots before the limit. */
export const TRIAL_NOTIFY_FROM_REMAINING = 3;

let client: EventBridgeClient | undefined;

/** @internal tests only */
export function _setTrialEventsClient(value: EventBridgeClient | undefined): void {
  client = value;
}

export function shouldNotifyTrialUsage(used: number, limit: number): boolean {
  return used >= limit - TRIAL_NOTIFY_FROM_REMAINING;
}

export function trialEventsConfigured(): boolean {
  return !!process.env['EVENT_BUS_NAME'];
}

export async function emitTrialUsage(tenantId: string, productsUsed: number, productLimit: number): Promise<void> {
  const bus = process.env['EVENT_BUS_NAME'];
  if (!bus || !shouldNotifyTrialUsage(productsUsed, productLimit)) return;
  try {
    client ??= new EventBridgeClient({});
    await client.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: TRIAL_EVENT_SOURCE,
            DetailType: 'product.trial.usage',
            Detail: JSON.stringify({ tenantId, productsUsed, productLimit }),
            EventBusName: bus,
          },
        ],
      }),
    );
  } catch (error) {
    console.warn('Trial usage event not sent', { error: error instanceof Error ? error.message : String(error) });
  }
}
