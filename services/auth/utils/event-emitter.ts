/**
 * EventBridge event emitter for MerchOS auth domain events.
 *
 * Provides a typed helper to emit authentication and authorization events
 * to the shared EventBridge bus. All auth handlers should use this module
 * to publish domain events consistently.
 */

import {
  EventBridgeClient,
  EventBridgeClientConfig,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';

const DEFAULT_REGION = 'af-south-1';
const EVENT_SOURCE = 'merch-os.auth';

/**
 * All supported auth domain event detail types.
 */
export type AuthEventDetailType =
  | 'auth.user.registered'
  | 'auth.user.invited'
  | 'auth.user.verified'
  | 'auth.user.disabled'
  | 'auth.user.deleted'
  | 'auth.user.role-changed'
  | 'auth.session.created'
  | 'auth.session.revoked'
  | 'auth.password.reset'
  | 'auth.security.rate-limit';

/**
 * Options for emitting an auth domain event.
 */
export interface AuthEventOptions {
  /** The event detail type (e.g. 'auth.user.registered'). */
  detailType: AuthEventDetailType;
  /** The event payload. Must be JSON-serializable. */
  detail: Record<string, unknown>;
}

let clientInstance: EventBridgeClient | null = null;

/**
 * Returns a singleton EventBridgeClient.
 *
 * The client is configured with the region from the AWS_REGION environment
 * variable, falling back to 'af-south-1' if not set.
 *
 * Uses a singleton pattern to reuse the underlying HTTP connection pool
 * across Lambda invocations within the same execution context.
 */
export function getEventBridgeClient(
  config?: EventBridgeClientConfig
): EventBridgeClient {
  if (!clientInstance) {
    clientInstance = new EventBridgeClient({
      region: process.env['AWS_REGION'] ?? DEFAULT_REGION,
      ...config,
    });
  }
  return clientInstance;
}

/**
 * Emits an auth domain event to EventBridge.
 *
 * Publishes a PutEvents entry to the event bus specified by the
 * EVENT_BUS_NAME environment variable. The event source is always
 * 'merch-os.auth'.
 *
 * @param options - The event detail type and payload.
 * @returns The PutEvents response from EventBridge.
 * @throws Error if EVENT_BUS_NAME is not set.
 */
export async function emitAuthEvent(options: AuthEventOptions) {
  const eventBusName = process.env['EVENT_BUS_NAME'];
  if (!eventBusName) {
    throw new Error(
      'EVENT_BUS_NAME environment variable is not set. Cannot emit auth event.'
    );
  }

  const client = getEventBridgeClient();

  const entry: PutEventsRequestEntry = {
    Source: EVENT_SOURCE,
    DetailType: options.detailType,
    Detail: JSON.stringify(options.detail),
    EventBusName: eventBusName,
    Time: new Date(),
  };

  const command = new PutEventsCommand({
    Entries: [entry],
  });

  return client.send(command);
}

/**
 * Resets the singleton EventBridge client instance.
 * Useful for testing to ensure a fresh client is created.
 */
export function resetForTesting(): void {
  clientInstance = null;
}

/** Re-export the client type for handler use. */
export type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
