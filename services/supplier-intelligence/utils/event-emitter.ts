/**
 * EventBridge event emitter for the Supplier Intelligence Platform.
 *
 * Provides typed helpers to emit import job domain events to the shared
 * EventBridge bus. All processors and handlers should use this module to
 * publish supplier-intelligence events consistently.
 *
 * Source: "merch-os.supplier-intelligence"
 *
 * @see Requirements 8.1, 8.2
 */

import {
  EventBridgeClient,
  EventBridgeClientConfig,
  PutEventsCommand,
  PutEventsRequestEntry,
} from '@aws-sdk/client-eventbridge';
import {
  SUPPLIER_INTELLIGENCE_EVENT_SOURCE,
  type ImportJobCompletedEvent,
  type ImportJobFailedEvent,
} from '../types/events.types';

const DEFAULT_REGION = 'af-south-1';

// ---------------------------------------------------------------------------
// Params Interfaces
// ---------------------------------------------------------------------------

/**
 * Parameters for emitting an ImportJobCompleted event.
 * @see Requirement 8.1
 */
export interface EmitImportJobCompletedParams {
  /** Tenant identifier */
  tenantId: string;
  /** Import job identifier */
  importJobId: string;
  /** Supplier identifier */
  supplierId: string;
  /** The source type that produced this job */
  sourceType: string;
  /** Summary statistics from the completed job */
  results: ImportJobCompletedEvent['detail']['results'];
  /** Total processing duration in milliseconds */
  durationMs: number;
}

/**
 * Parameters for emitting an ImportJobFailed event.
 * @see Requirement 8.2
 */
export interface EmitImportJobFailedParams {
  /** Tenant identifier */
  tenantId: string;
  /** Import job identifier */
  importJobId: string;
  /** Supplier identifier */
  supplierId: string;
  /** Structured error details */
  error: ImportJobFailedEvent['detail']['error'];
}

// ---------------------------------------------------------------------------
// Singleton Client
// ---------------------------------------------------------------------------

let clientInstance: EventBridgeClient | null = null;

/**
 * Returns a singleton EventBridgeClient.
 *
 * Uses a singleton pattern to reuse the underlying HTTP connection pool
 * across Lambda invocations within the same execution context.
 *
 * @param config - Optional client configuration (merged over defaults).
 */
export function getEventBridgeClient(
  config?: EventBridgeClientConfig,
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
 * Resets the singleton EventBridge client instance.
 * Useful in tests to ensure a fresh client is created between test cases.
 */
export function resetForTesting(): void {
  clientInstance = null;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function getEventBusName(): string {
  const name = process.env['EVENT_BUS_NAME'];
  if (!name) {
    throw new Error(
      'EVENT_BUS_NAME environment variable is not set. Cannot emit supplier-intelligence event.',
    );
  }
  return name;
}

async function putEvent(entry: PutEventsRequestEntry) {
  const client = getEventBridgeClient();
  const command = new PutEventsCommand({ Entries: [entry] });
  return client.send(command);
}

// ---------------------------------------------------------------------------
// emitImportJobCompleted
// ---------------------------------------------------------------------------

/**
 * Emits an `ImportJobCompleted` event to EventBridge.
 *
 * Published when an import job transitions to COMPLETED state. Carries the
 * job identifier, product count, and summary statistics.
 *
 * @param params - Job completion details including results summary.
 * @returns The PutEvents response from EventBridge.
 * @throws Error if EVENT_BUS_NAME is not set.
 *
 * @see Requirement 8.1
 */
export async function emitImportJobCompleted(params: EmitImportJobCompletedParams) {
  const { tenantId, importJobId, supplierId, sourceType, results, durationMs } = params;

  const detail: ImportJobCompletedEvent['detail'] = {
    tenantId,
    importJobId,
    supplierId,
    sourceType,
    results,
    durationMs,
  };

  const entry: PutEventsRequestEntry = {
    Source: SUPPLIER_INTELLIGENCE_EVENT_SOURCE,
    DetailType: 'ImportJobCompleted',
    Detail: JSON.stringify(detail),
    EventBusName: getEventBusName(),
    Time: new Date(),
  };

  return putEvent(entry);
}

// ---------------------------------------------------------------------------
// emitImportJobFailed
// ---------------------------------------------------------------------------

/**
 * Emits an `ImportJobFailed` event to EventBridge.
 *
 * Published when an import job transitions to FAILED state. Carries the
 * job identifier and structured error details.
 *
 * @param params - Job failure details including error code and message.
 * @returns The PutEvents response from EventBridge.
 * @throws Error if EVENT_BUS_NAME is not set.
 *
 * @see Requirement 8.2
 */
export async function emitImportJobFailed(params: EmitImportJobFailedParams) {
  const { tenantId, importJobId, supplierId, error } = params;

  const detail: ImportJobFailedEvent['detail'] = {
    tenantId,
    importJobId,
    supplierId,
    error,
  };

  const entry: PutEventsRequestEntry = {
    Source: SUPPLIER_INTELLIGENCE_EVENT_SOURCE,
    DetailType: 'ImportJobFailed',
    Detail: JSON.stringify(detail),
    EventBusName: getEventBusName(),
    Time: new Date(),
  };

  return putEvent(entry);
}
