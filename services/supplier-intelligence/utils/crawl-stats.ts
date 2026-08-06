/**
 * Crawl Statistics Recorder — tracks crawl metrics and supports session completion
 * with incremental import capability.
 *
 * Requirements: 4.7, 4.11, 4.12
 *
 * Responsibilities:
 * - Track pages crawled, pages skipped (robots.txt disallowed), products extracted,
 *   images downloaded, errors encountered, and total duration
 * - Provide a startSession() / endSession() lifecycle for crawl stat collection
 * - Support incremental import: compare new product data against existing DynamoDB records
 *   by tenant+SKU, only persist changed fields
 * - Return a final CrawlStats summary when the session completes
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CrawlStats } from '../types/crawl.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Extracted product data from a crawl — the minimal shape needed for
 * incremental import comparison.
 */
export interface ExtractedProduct {
  sku: string;
  title?: string;
  description?: string;
  price?: number;
  brand?: string;
  category?: string;
  stockAvailability?: string;
  images?: string[];
  variations?: Record<string, string>[];
  specifications?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Result of an incremental import comparison for a single product.
 */
export interface IncrementalImportResult {
  sku: string;
  action: 'created' | 'updated' | 'unchanged';
  /** Fields that changed (only present when action is 'updated') */
  changedFields?: string[];
}

/**
 * Summary of the incremental import operation.
 */
export interface IncrementalImportSummary {
  newProducts: number;
  updatedProducts: number;
  unchangedProducts: number;
  results: IncrementalImportResult[];
}

/**
 * Internal mutable state for a stats recording session.
 */
interface StatsSessionState {
  startTime: number;
  pagesCrawled: number;
  pagesSkipped: number;
  productsExtracted: number;
  imagesDownloaded: number;
  errorsEncountered: number;
  active: boolean;
}

// ---------------------------------------------------------------------------
// DynamoDB Client Singleton
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client);
  }
  return ddbDocClient;
}

/**
 * Override the DynamoDB Document Client (used for testing).
 */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// CrawlStatsRecorder Class
// ---------------------------------------------------------------------------

/**
 * Records crawl statistics throughout a crawl session and produces a
 * final CrawlStats summary upon completion.
 *
 * Usage:
 * ```ts
 * const recorder = new CrawlStatsRecorder();
 * recorder.startSession();
 *
 * recorder.recordPageCrawled();
 * recorder.recordPageSkipped();
 * recorder.recordProductExtracted();
 * recorder.recordImageDownloaded();
 * recorder.recordError();
 *
 * const stats = recorder.endSession();
 * ```
 */
export class CrawlStatsRecorder {
  private state: StatsSessionState | null = null;

  /**
   * Start a new stats recording session. Resets all counters and begins timing.
   * @throws Error if a session is already active
   */
  startSession(): void {
    if (this.state?.active) {
      throw new Error('A crawl stats session is already active. Call endSession() first.');
    }

    this.state = {
      startTime: Date.now(),
      pagesCrawled: 0,
      pagesSkipped: 0,
      productsExtracted: 0,
      imagesDownloaded: 0,
      errorsEncountered: 0,
      active: true,
    };
  }

  /**
   * End the current stats session and return the final CrawlStats summary.
   * @throws Error if no session is active
   */
  endSession(): CrawlStats {
    if (!this.state || !this.state.active) {
      throw new Error('No active crawl stats session. Call startSession() first.');
    }

    const durationMs = Date.now() - this.state.startTime;

    const stats: CrawlStats = {
      pagesCrawled: this.state.pagesCrawled,
      pagesSkipped: this.state.pagesSkipped,
      productsExtracted: this.state.productsExtracted,
      imagesDownloaded: this.state.imagesDownloaded,
      errorsEncountered: this.state.errorsEncountered,
      durationMs,
    };

    this.state.active = false;

    return stats;
  }

  /**
   * Record that a page was successfully crawled.
   * @param count - Number of pages to record (default: 1)
   */
  recordPageCrawled(count: number = 1): void {
    this.assertActive();
    this.state!.pagesCrawled += count;
  }

  /**
   * Record that a page was skipped (e.g., disallowed by robots.txt or already visited).
   * @param count - Number of pages to record (default: 1)
   */
  recordPageSkipped(count: number = 1): void {
    this.assertActive();
    this.state!.pagesSkipped += count;
  }

  /**
   * Record that products were successfully extracted from a page.
   * @param count - Number of products extracted (default: 1)
   */
  recordProductExtracted(count: number = 1): void {
    this.assertActive();
    this.state!.productsExtracted += count;
  }

  /**
   * Record that images were downloaded.
   * @param count - Number of images downloaded (default: 1)
   */
  recordImageDownloaded(count: number = 1): void {
    this.assertActive();
    this.state!.imagesDownloaded += count;
  }

  /**
   * Record that an error occurred during the crawl.
   * @param count - Number of errors to record (default: 1)
   */
  recordError(count: number = 1): void {
    this.assertActive();
    this.state!.errorsEncountered += count;
  }

  /**
   * Get a snapshot of the current stats without ending the session.
   * Useful for progress reporting during a crawl.
   */
  getSnapshot(): CrawlStats {
    this.assertActive();
    const durationMs = Date.now() - this.state!.startTime;

    return {
      pagesCrawled: this.state!.pagesCrawled,
      pagesSkipped: this.state!.pagesSkipped,
      productsExtracted: this.state!.productsExtracted,
      imagesDownloaded: this.state!.imagesDownloaded,
      errorsEncountered: this.state!.errorsEncountered,
      durationMs,
    };
  }

  /**
   * Check if a session is currently active.
   */
  isActive(): boolean {
    return this.state?.active === true;
  }

  /**
   * Assert that a session is active, throw if not.
   */
  private assertActive(): void {
    if (!this.state || !this.state.active) {
      throw new Error('No active crawl stats session. Call startSession() first.');
    }
  }
}

// ---------------------------------------------------------------------------
// Incremental Import Support
// ---------------------------------------------------------------------------

/**
 * Fetch existing products for a tenant+supplier from DynamoDB by SKU.
 * Queries the Products table using the tenant PK and filters by supplierId
 * via the import metadata.
 *
 * @param tenantId - The tenant's identifier
 * @param supplierId - The supplier's identifier
 * @param skus - Array of SKUs to look up
 * @param tableName - DynamoDB products table name
 * @returns Map of SKU → existing product record (as a flat key-value object)
 */
export async function fetchExistingProductsBySku(
  tenantId: string,
  supplierId: string,
  skus: string[],
  tableName: string,
): Promise<Map<string, Record<string, unknown>>> {
  const docClient = getDynamoDocClient();
  const existingProducts = new Map<string, Record<string, unknown>>();

  if (skus.length === 0) {
    return existingProducts;
  }

  // Query products by tenant and filter by SKU using a batch approach.
  // DynamoDB doesn't support IN queries on sort keys directly, so we
  // query by tenant+supplier and filter by SKU in batches.
  const batchSize = 25;
  for (let i = 0; i < skus.length; i += batchSize) {
    const batch = skus.slice(i, i + batchSize);

    for (const sku of batch) {
      try {
        const result = await docClient.send(
          new QueryCommand({
            TableName: tableName,
            IndexName: 'GSI-SKU',
            KeyConditionExpression: 'GSI_SKU_PK = :pk AND GSI_SKU_SK = :sk',
            FilterExpression: 'contains(importMetadata.sourceSupplierId, :supplierId)',
            ExpressionAttributeValues: {
              ':pk': `TENANT#${tenantId}`,
              ':sk': `SKU#${sku}`,
              ':supplierId': supplierId,
            },
            Limit: 1,
          }),
        );

        if (result.Items && result.Items.length > 0) {
          existingProducts.set(sku, result.Items[0] as Record<string, unknown>);
        }
      } catch {
        // If the GSI doesn't exist or query fails, continue without existing data.
        // This allows the system to fall back to treating all products as new.
      }
    }
  }

  return existingProducts;
}

/**
 * Compare two product records and return a list of fields that differ.
 * Performs a shallow comparison on known product fields.
 *
 * @param existing - The existing product record from DynamoDB
 * @param extracted - The newly extracted product data
 * @returns Array of field names that have changed
 */
export function diffProductFields(
  existing: Record<string, unknown>,
  extracted: ExtractedProduct,
): string[] {
  const changedFields: string[] = [];

  const fieldsToCompare: string[] = [
    'title',
    'description',
    'price',
    'brand',
    'category',
    'stockAvailability',
    'images',
    'variations',
    'specifications',
  ];

  for (const field of fieldsToCompare) {
    const extractedValue = extracted[field];

    // Skip undefined fields in extracted data — they weren't present on the page
    if (extractedValue === undefined) {
      continue;
    }

    const existingValue = existing[field];

    if (!deepEqual(existingValue, extractedValue)) {
      changedFields.push(field);
    }
  }

  return changedFields;
}

/**
 * Perform an incremental import: compare extracted products against existing
 * records in DynamoDB, and update only changed fields.
 *
 * @param tenantId - Tenant identifier
 * @param supplierId - Supplier identifier
 * @param extractedProducts - Array of newly extracted products
 * @param tableName - DynamoDB products table name
 * @returns IncrementalImportSummary with counts and per-product results
 */
export async function performIncrementalImport(
  tenantId: string,
  supplierId: string,
  extractedProducts: ExtractedProduct[],
  tableName: string,
): Promise<IncrementalImportSummary> {
  const results: IncrementalImportResult[] = [];
  let newProducts = 0;
  let updatedProducts = 0;
  let unchangedProducts = 0;

  // Collect all SKUs from extracted products
  const skus = extractedProducts
    .map((p) => p.sku)
    .filter((sku): sku is string => sku !== undefined && sku !== '');

  // Fetch existing products in bulk
  const existingProducts = await fetchExistingProductsBySku(tenantId, supplierId, skus, tableName);

  const docClient = getDynamoDocClient();

  for (const extracted of extractedProducts) {
    if (!extracted.sku) {
      // Products without SKU are always treated as new
      results.push({ sku: '', action: 'created' });
      newProducts++;
      continue;
    }

    const existing = existingProducts.get(extracted.sku);

    if (!existing) {
      // No existing record — this is a new product
      results.push({ sku: extracted.sku, action: 'created' });
      newProducts++;
      continue;
    }

    // Diff fields to determine what changed
    const changedFields = diffProductFields(existing, extracted);

    if (changedFields.length === 0) {
      // Nothing changed — skip this product
      results.push({ sku: extracted.sku, action: 'unchanged' });
      unchangedProducts++;
      continue;
    }

    // Build an update expression for only the changed fields
    try {
      await updateProductChangedFields(
        tenantId,
        existing,
        extracted,
        changedFields,
        tableName,
        docClient,
      );

      results.push({
        sku: extracted.sku,
        action: 'updated',
        changedFields,
      });
      updatedProducts++;
    } catch {
      // If update fails, treat as needing creation
      results.push({ sku: extracted.sku, action: 'created' });
      newProducts++;
    }
  }

  return {
    newProducts,
    updatedProducts,
    unchangedProducts,
    results,
  };
}

/**
 * Update only the changed fields on an existing product record in DynamoDB.
 */
async function updateProductChangedFields(
  tenantId: string,
  existing: Record<string, unknown>,
  extracted: ExtractedProduct,
  changedFields: string[],
  tableName: string,
  docClient: DynamoDBDocumentClient,
): Promise<void> {
  if (changedFields.length === 0) return;

  // Build DynamoDB UpdateExpression
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};
  const updateParts: string[] = [];

  for (const field of changedFields) {
    const attrName = `#${field}`;
    const attrValue = `:${field}`;
    expressionAttributeNames[attrName] = field;
    expressionAttributeValues[attrValue] = extracted[field];
    updateParts.push(`${attrName} = ${attrValue}`);
  }

  // Always update the updatedAt timestamp
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = new Date().toISOString();
  updateParts.push('#updatedAt = :updatedAt');

  const updateExpression = `SET ${updateParts.join(', ')}`;

  // Use the existing record's PK/SK for the update
  const pk = existing['PK'] as string ?? `TENANT#${tenantId}`;
  const sk = existing['SK'] as string;

  if (!sk) {
    throw new Error(`Cannot update product: missing SK for SKU "${extracted.sku}"`);
  }

  await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { PK: pk, SK: sk },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }),
  );
}

// ---------------------------------------------------------------------------
// Utility: Deep Equality
// ---------------------------------------------------------------------------

/**
 * Perform a deep equality check between two values.
 * Handles primitives, arrays, and plain objects.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;

  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
