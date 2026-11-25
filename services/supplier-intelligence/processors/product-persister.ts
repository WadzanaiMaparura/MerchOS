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
import type { CanonicalProduct } from '@merch-os/types';
import type { ImportMetadata, ImportJobResults, SourceType } from '../types/supplier.types';
import type { ValidatedRecord } from '../types/validation.types';
import { updateImportJobStatus } from '../utils/import-job-status';
import { emitImportJobCompleted } from '../utils/event-emitter';
import { reserveProductSlots, releaseProductSlot } from '../../shared/entitlements/trial-gate';

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
      region: process.env['AWS_REGION'] ?? 'eu-west-1',
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
  /**
   * Counts known to the caller but not to the persister (extracted rows,
   * merged/duplicate/invalid records). Merged over the computed results.
   */
  resultCounts?: Partial<Omit<ImportJobResults, 'created'>>;
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
 * Build a DynamoDB item for an imported product in the **canonical** shape.
 *
 * This is the single authoritative Products write shape (G07): it MUST match
 * what the Product API writes via `ProductRepository`/`ProductService`, so that
 * imported products and API-created products share one data model and one index
 * layout. In particular:
 *
 * - SKU lives at `content.sku` (nested), NOT a flat top-level `sku`.
 * - GSI1 uses the canonical SKU-uniqueness layout:
 *     GSI1PK = `TENANT#{tenantId}#SKU`, GSI1SK = `SKU#{sku}`
 *   (identical to `ProductRepository.toItem`), so the API's `findBySku` and the
 *   import duplicate-detector resolve to the same records.
 * - `importMetadata` is carried inside `content.attributes.importMetadata`
 *   (per ImportMetadata docs), keeping it within the canonical model.
 * - `lifecycleState` is the lowercase canonical subset value `'draft'`.
 *
 * The flat `ValidatedRecord.record` (a `Partial<Product>` DTO with top-level
 * title/sku/brand/description/category/images/price) is mapped into the
 * canonical content/commercial domains here.
 */
function buildProductItem(
  tenantId: string,
  productId: string,
  record: ValidatedRecord['record'],
  importMetadata: ImportMetadata,
): Record<string, unknown> {
  const now = new Date().toISOString();

  const sku = (record.sku ?? '').trim();
  // record is Partial<Product> (flat DTO). Pull the fields the validation
  // engine/parsers actually populate: title, sku, description, brand,
  // category, images, price.
  const flat = record as Record<string, unknown>;
  const title = (flat['title'] as string | undefined) ?? '';
  const brand = (flat['brand'] as string | undefined) ?? '';
  const description = (flat['description'] as string | undefined) ?? null;
  const category = flat['category'] as string | undefined;
  const price = typeof flat['price'] === 'number' ? (flat['price'] as number) : null;

  // Preserve any seller/parser-supplied attributes, then attach import provenance
  // and (optionally) the source category as a canonical attribute.
  const existingAttributes =
    (flat['attributes'] as Record<string, string | number | boolean> | undefined) ?? {};
  const attributes: Record<string, unknown> = {
    ...existingAttributes,
    ...(category ? { category } : {}),
    importMetadata,
  };

  const product: CanonicalProduct = {
    productId,
    tenantId,
    content: {
      title,
      shortDescription: null,
      longDescription: description,
      bulletPoints: [],
      brand,
      manufacturer: null,
      sku,
      barcode: null,
      mpn: null,
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      // importMetadata is stored inside attributes per the ImportMetadata contract.
      attributes: attributes as Record<string, string | number | boolean>,
      // Was always []: every imported image (CSV image URLs, OCR'd photos,
      // crawled images) was dropped.
      imageRefs: toImportedImageRefs(productId, flat['images'], title),
      variants: [],
    },
    commercial: {
      sellingPrice: price,
      rrp: null,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 0,
      lowStockThreshold: null,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'draft',
      saleStartDate: null,
      saleEndDate: null,
    },
    platformSpecific: {
      platformIdentifiers: {},
      categoryMappings: {},
      metadata: {},
      exportHistory: {},
    },
    // Lowercase canonical lifecycle subset — matches ProductService/repository.
    lifecycleState: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  return {
    // Keys — identical layout to ProductRepository.toItem (unified data model).
    PK: `TENANT#${tenantId}`,
    SK: `PRODUCT#${productId}`,
    GSI1PK: `TENANT#${tenantId}#SKU`,
    GSI1SK: `SKU#${sku}`,
    // Canonical product body (includes content.sku, content.attributes.importMetadata,
    // commercial, platformSpecific, lifecycleState, createdAt/updatedAt).
    ...product,
  };
}

/** Marketplaces accept at most ~10 images per listing. */
export const MAX_IMPORTED_IMAGES = 10;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  gif: 'image/gif', avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
};

/**
 * Turns the importer's image list into canonical image refs.
 *
 * Kept: absolute http(s) URLs (from CSV image columns or crawled pages: used
 * as-is in marketplace exports) and our own `assets/` S3 keys (OCR'd photos,
 * downloaded crawl images). Dropped: anything else, e.g. bare file names, which
 * point at nothing. De-duplicated, in source order, capped at 10.
 *
 * imageIds are derived from the product id + position so a retried import
 * writes identical refs.
 */
export function toImportedImageRefs(
  productId: string,
  images: unknown,
  title: string,
): CanonicalProduct['content']['imageRefs'] {
  if (!Array.isArray(images)) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of images) {
    if (typeof raw !== 'string') continue;
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    const isUrl = /^https?:\/\/[^\s]+$/i.test(v);
    const isAssetKey = /^assets\/[^\s]+$/.test(v) && !v.includes('..');
    if (!isUrl && !isAssetKey) continue;
    seen.add(v);
    kept.push(v);
    if (kept.length >= MAX_IMPORTED_IMAGES) break;
  }
  return kept.map((s3Key, position) => {
    const ext = /\.([a-z0-9]{2,5})(?:[?#].*)?$/i.exec(s3Key)?.[1]?.toLowerCase() ?? '';
    return {
      imageId: `${productId}-img-${position}`,
      s3Key,
      position,
      altText: title || null,
      mimeType: MIME_BY_EXT[ext] ?? 'image/jpeg',
      // Unknown until the image is processed by the image pipeline.
      width: 0,
      height: 0,
      fileSize: 0,
      variantId: null,
    };
  });
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

  // Resolve every product id first: the free-trial gate reserves a slot PER product
  // BEFORE anything is written. BatchWriteItem cannot carry conditions, so a bulk
  // import has to be truncated here or one big file would bypass the cap.
  const resolved = products.map((p) => ({ ...p, resolvedId: p.productId ?? randomUUID() }));
  const gate = await reserveProductSlots(
    tenantId,
    resolved.map((r) => r.resolvedId),
    { tableName: productsTableName },
  );
  const allowedIds = new Set(gate.allowed);
  const allowedProducts = resolved.filter((r) => allowedIds.has(r.resolvedId));
  const blockedByTrial = resolved.length - allowedProducts.length;
  const blockedWhy = blockedReasonText(gate.reason);

  const productItems: Record<string, unknown>[] = allowedProducts.map(
    ({ record, importMetadata, resolvedId }) =>
      buildProductItem(tenantId, resolvedId, record, importMetadata),
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

  // Give back the slots of products that were never even attempted (everything
  // after the failing batch). The failing batch itself may be partly written, so its
  // slots stay used: over-counting is safe, handing out extra products is not.
  if (failureAtIndex !== null) {
    for (const p of allowedProducts.slice(failureAtIndex + BATCH_WRITE_MAX_ITEMS)) {
      await releaseProductSlot(tenantId, p.resolvedId, { tableName: productsTableName });
    }
  }

  // Write failures only; products blocked by the trial are reported separately.
  const failed = productItems.length - persisted;

  // ---------------------------------------------------------------------------
  // Build ImportJobResults
  // ---------------------------------------------------------------------------

  const jobResults: ImportJobResults = {
    totalExtracted: products.length,
    created: persisted,
    updated: 0,
    duplicates: 0,
    validationFailed: 0,
    ...params.resultCounts,
    ...(blockedByTrial > 0 ? { blockedByTrial, ...(gate.reason ? { blockedReason: gate.reason } : {}) } : {}),
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
        : blockedByTrial > 0
          ? `Completed: ${persisted} imported, ${blockedByTrial} not imported because ${blockedWhy}`
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

/** Seller-facing reason in the import progress text ("... not imported because ..."). */
function blockedReasonText(reason: string | undefined): string {
  switch (reason) {
    case 'PLAN_PAUSED':
      return 'your plan is paused';
    case 'PLAN_LIMIT_REACHED':
      return "this month's plan allowance is used up";
    default:
      return 'the free trial limit was reached';
  }
}
