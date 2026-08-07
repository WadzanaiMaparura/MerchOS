/**
 * Product Persister Lambda — batch-write validated Product records to DynamoDB in DRAFT state.
 *
 * Responsibilities:
 * - Write Product records to DynamoDB with PK `TENANT#{tenantId}`, SK `PRODUCT#{productId}`
 * - Attach `importMetadata` (sourceImportJobId, sourceSupplierId, sourceType, importedAt,
 *   ocrConfidence?, flaggedForReview?, duplicateOf?)
 * - Update ImportJob status to COMPLETED with result summary
 * - Partial failure preservation: commit batches as they succeed, preserve records
 *   before the failure point, record the failure in the result summary
 *
 * DynamoDB batchWrite is limited to 25 items per request.
 *
 * @see Requirements 2.1, 10.2, 14.3
 */

import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
  type BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { ImportMetadata, ImportJobResults, SourceType } from '../types/supplier.types';
import type { ValidatedRecord } from '../types/validation.types';
import { updateImportJobStatus } from '../utils/import-job-status';
import { emitImportJobCompleted } from '../utils/event-emitter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DynamoDB hard limit for batchWrite operations. */
export const BATCH_WRITE_MAX_ITEMS = 25;

// ---------------------------------------------------------------------------
// DynamoDB Client (lazy-initialised for Lambda container reuse)
// ---------------------------------------------------------------------------

let dynamoClient: DynamoDBDocumentClient | undefined;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const base = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    dynamoClient = DynamoDBDocumentClient.from(base);
  }
  return dynamoClient;
}

/** Allow test code to inject a mock DynamoDB client. */
export function setDynamoClient(client: DynamoDBDocumentClient): void {
  dynamoClient = client;
}

/** Reset DynamoDB client (for test teardown). */
export function resetDynamoClient(): void {
  dynamoClient = undefined;
}

// ---------------------------------------------------------------------------
// Parameter and Result Interfaces
// ---------------------------------------------------------------------------

/**
 * A single validated product record ready for persistence, combined with
 * the per-product duplicate action metadata.
 */
export interface ProductToPersist {
  /** Validated record (must have status VALID) */
  record: ValidatedRecord['record'];
  /**
   * Import metadata to attach to this product record.
   * All required fields must be provided; optional fields may be omitted.
   */
  importMetadata: ImportMetadata;
  /**
   * The resolved UUID for this product.
   * Callers may pre-assign IDs (e.g. when MERGE or CREATE_FLAGGED was chosen).
   * If omitted, a new UUID is generated.
   */
  productId?: string;
}

/**
 * Parameters for the `persistProducts` function.
 */
export interface PersistProductsParams {
  /** Tenant identifier (used as DynamoDB PK: `TENANT#{tenantId}`) */
  tenantId: string;
  /** The import job identifier being finalised */
  importJobId: string;
  /** Supplier identifier */
  supplierId: string;
  /** The source type of the import */
  sourceType: SourceType;
  /** Current import job status for the transition guard (must be PERSISTING) */
  currentJobStatus?: 'PERSISTING';
  /** Array of validated product records to persist */
  products: ProductToPersist[];
  /**
   * DynamoDB table name for products.
   * Reads from PRODUCTS_TABLE_NAME environment variable if omitted.
   */
  productsTableName?: string;
  /**
   * DynamoDB table name for import jobs.
   * Reads from IMPORT_JOBS_TABLE environment variable if omitted.
   */
  importJobsTableName?: string;
  /** ISO 8601 start timestamp used to compute job duration (defaults to now). */
  jobStartedAt?: string;
}

/**
 * Summary result returned by `persistProducts`.
 */
export interface PersistProductsResult {
  /** Total number of product records that were successfully written */
  persisted: number;
  /** Number of records that failed to write */
  failed: number;
  /**
   * Index of the first record that failed (0-based), or null if all succeeded.
   * Records before this index are guaranteed to be persisted.
   */
  failureAtIndex: number | null;
  /** Descriptive error from the failing batch, if any */
  failureError: string | null;
  /** Final ImportJobResults written to the ImportJob record */
  jobResults: ImportJobResults;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a DynamoDB item for a product record in DRAFT state.
 */
function buildProductItem(
  tenantId: string,
  productId: string,
  record: ValidatedRecord['record'],
  importMetadata: ImportMetadata,
): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    PK: `TENANT#${tenantId}`,
    SK: `PRODUCT#${productId}`,
    // GSI keys for query patterns used by duplicate-detector and list operations
    GSI1PK: `TENANT#${tenantId}#SKU#${record.sku ?? ''}`,
    GSI1SK: `PRODUCT#CREATED#${now}`,
    GSI2PK: `TENANT#${tenantId}#SUPPLIER#${importMetadata.sourceSupplierId}`,
    GSI2SK: `PRODUCT#CREATED#${now}`,
    // Identity
    productId,
    tenantId,
    supplierId: importMetadata.sourceSupplierId,
    // Core product fields from the validated record
    ...record,
    // Lifecycle state — always DRAFT on initial import
    lifecycleState: 'DRAFT',
    // Import provenance
    importMetadata,
    // Timestamps
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Split an array into chunks of at most `size` items.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Write a single batch of up to 25 items to DynamoDB using batchWrite.
 *
 * Handles unprocessed items by retrying with exponential backoff up to
 * `maxRetries` times (DynamoDB may return partial results for throttled writes).
 *
 * @throws If the batch cannot be fully written after retries.
 */
async function writeBatch(
  client: DynamoDBDocumentClient,
  tableName: string,
  items: Record<string, unknown>[],
  maxRetries = 5,
): Promise<void> {
  let unprocessed: Record<string, unknown>[] = items;
  let attempt = 0;

  while (unprocessed.length > 0) {
    const requestItems: BatchWriteCommandInput['RequestItems'] = {
      [tableName]: unprocessed.map((item) => ({
        PutRequest: { Item: item },
      })),
    };

    const result = await client.send(
      new BatchWriteCommand({ RequestItems: requestItems }),
    );

    const remaining = result.UnprocessedItems?.[tableName] ?? [];
    unprocessed = remaining
      .map((req) => (req as { PutRequest?: { Item?: Record<string, unknown> } }).PutRequest?.Item)
      .filter((item): item is Record<string, unknown> => item != null);

    if (unprocessed.length > 0) {
      attempt++;
      if (attempt >= maxRetries) {
        throw new Error(
          `batchWrite failed: ${unprocessed.length} item(s) remained unprocessed after ${maxRetries} retries`,
        );
      }
      // Exponential backoff with jitter: base 100ms, max ~3.2s
      const delayMs = Math.min(100 * Math.pow(2, attempt), 3200) + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

/**
 * Persist validated Product records to DynamoDB in DRAFT state, then mark
 * the ImportJob as COMPLETED with a result summary.
 *
 * Implements partial failure preservation: each batch of up to 25 records is
 * committed independently. If a batch fails, all previously committed batches
 * are retained and the failure is recorded in the result. Records after the
 * failure point are NOT written.
 *
 * @param params - See `PersistProductsParams`
 * @returns `PersistProductsResult` with persisted/failed counts and job results
 *
 * @see Requirements 2.1, 10.2, 14.3
 */
export async function persistProducts(
  params: PersistProductsParams,
): Promise<PersistProductsResult> {
  const {
    tenantId,
    importJobId,
    supplierId,
    sourceType,
    products,
    jobStartedAt,
  } = params;

  const productsTableName =
    params.productsTableName ?? process.env['PRODUCTS_TABLE_NAME'];
  if (!productsTableName) {
    throw new Error(
      'Products table name is required. Pass productsTableName or set the PRODUCTS_TABLE_NAME environment variable.',
    );
  }

  const importJobsTableName =
    params.importJobsTableName ?? process.env['IMPORT_JOBS_TABLE'];
  if (!importJobsTableName) {
    throw new Error(
      'Import Jobs table name is required. Pass importJobsTableName or set the IMPORT_JOBS_TABLE environment variable.',
    );
  }

  const client = getDynamoClient();

  // ---------------------------------------------------------------------------
  // Build all DynamoDB items before any writes
  // ---------------------------------------------------------------------------

  const productItems: Record<string, unknown>[] = products.map(
    ({ record, importMetadata, productId }) => {
      const resolvedId = productId ?? randomUUID();
      return buildProductItem(tenantId, resolvedId, record, importMetadata);
    },
  );

  // ---------------------------------------------------------------------------
  // Batch write with partial failure preservation (Requirement 14.3)
  // ---------------------------------------------------------------------------

  const batches = chunkArray(productItems, BATCH_WRITE_MAX_ITEMS);

  let persisted = 0;
  let failureAtIndex: number | null = null;
  let failureError: string | null = null;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!;
    try {
      await writeBatch(client, productsTableName, batch);
      persisted += batch.length;
    } catch (err) {
      // Record the failure point — preserve everything already committed
      failureAtIndex = batchIdx * BATCH_WRITE_MAX_ITEMS;
      failureError =
        err instanceof Error ? err.message : String(err);
      // Stop processing further batches
      break;
    }
  }

  const failed = products.length - persisted;

  // ---------------------------------------------------------------------------
  // Build ImportJobResults
  // ---------------------------------------------------------------------------

  const jobResults: ImportJobResults = {
    totalExtracted: products.length,
    created: persisted,
    updated: 0,
    duplicates: 0,
    validationFailed: 0,
  };

  // ---------------------------------------------------------------------------
  // Update ImportJob status → COMPLETED (Requirement 10.2)
  // ---------------------------------------------------------------------------

  const durationMs =
    jobStartedAt != null
      ? Date.now() - new Date(jobStartedAt).getTime()
      : 0;

  await updateImportJobStatus({
    tableName: importJobsTableName,
    tenantId,
    importJobId,
    currentStatus: 'PERSISTING',
    newStatus: 'COMPLETED',
    progress: {
      percentage: 100,
      currentStep: failureError
        ? `Completed with errors — ${failed} record(s) failed`
        : 'Completed',
    },
  });

  // ---------------------------------------------------------------------------
  // Emit ImportJobCompleted event (Requirement 8.1)
  // ---------------------------------------------------------------------------

  await emitImportJobCompleted({
    tenantId,
    importJobId,
    supplierId,
    sourceType,
    results: jobResults,
    durationMs,
  });

  return {
    persisted,
    failed,
    failureAtIndex,
    failureError,
    jobResults,
  };
}
