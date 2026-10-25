/**
 * EventBridge event emitter for the Image Intelligence Engine.
 *
 * Source: "merch-os.image-intelligence"
 *
 * Requirements: 2.3, 7.2, 7.3
 */

import {
  EventBridgeClient,
  EventBridgeClientConfig,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import {
  IMAGE_INTELLIGENCE_EVENT_SOURCE,
  type ImageProcessingCompletedEvent,
  type ImageProcessingFailedEvent,
  type ImageModerationRejectedEvent,
} from '../types/events.types';

const DEFAULT_REGION = 'eu-west-1';

let clientInstance: EventBridgeClient | null = null;

export function getEventBridgeClient(config?: EventBridgeClientConfig): EventBridgeClient {
  if (!clientInstance) {
    clientInstance = new EventBridgeClient({
      region: process.env['AWS_REGION'] ?? DEFAULT_REGION,
      ...config,
    });
  }
  return clientInstance;
}

/** Resets the singleton EventBridge client (used in tests). */
export function resetForTesting(): void {
  clientInstance = null;
}

function getEventBusName(): string {
  const name = process.env['EVENT_BUS_NAME'];
  if (!name) {
    throw new Error(
      'EVENT_BUS_NAME environment variable is not set. Cannot emit image-intelligence event.',
    );
  }
  return name;
}

async function putEvent(detailType: string, detail: unknown) {
  const entry: PutEventsRequestEntry = {
    Source: IMAGE_INTELLIGENCE_EVENT_SOURCE,
    DetailType: detailType,
    Detail: JSON.stringify(detail),
    EventBusName: getEventBusName(),
    Time: new Date(),
  };
  return getEventBridgeClient().send(new PutEventsCommand({ Entries: [entry] }));
}

/** Emits `ImageProcessingCompleted`. */
export async function emitImageProcessingCompleted(
  detail: ImageProcessingCompletedEvent['detail'],
) {
  return putEvent('ImageProcessingCompleted', detail);
}

/** Emits `ImageProcessingFailed`. */
export async function emitImageProcessingFailed(
  detail: ImageProcessingFailedEvent['detail'],
) {
  return putEvent('ImageProcessingFailed', detail);
}

/** Emits `ImageModerationRejected`. */
export async function emitImageModerationRejected(
  detail: ImageModerationRejectedEvent['detail'],
) {
  return putEvent('ImageModerationRejected', detail);
}
