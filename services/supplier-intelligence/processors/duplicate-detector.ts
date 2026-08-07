/**
 * Duplicate Detector Lambda — detect duplicate products during import.
 * Requirements: 7.1, 7.2, 7.3, 7.4
 *
 * Detection algorithm:
 * 1. Primary: exact SKU match via DynamoDB GSI query within tenant scope
 * 2. Secondary: normalised Levenshtein distance on title (threshold 0.85)
 * 3. Apply supplier-configured DuplicateStrategy (SKIP | MERGE | CREATE_FLAGGED)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { DuplicateStrategy } from '../types/supplier.types';
import type { DuplicateCheckResult } from '../types/crawl.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Levenshtein similarity threshold — scores at or above this are flagged as duplicates. */
export const TITLE_SIMILARITY_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// DynamoDB client (lazy-initialised for Lambda container reuse)
// ---------------------------------------------------------------------------

let dynamoClient: DynamoDBDocumentClient | undefined;

function getDynamoClient(): DynamoDBDocumentClient {
  if (!dynamoClient) {
    const base = new DynamoDBClient({});
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
// Pure string-similarity algorithm (no external library)
// ---------------------------------------------------------------------------

/**
 * Compute the classic dynamic-programming Levenshtein edit distance between
 * two strings using space-optimised two-row DP.
 *
 * Time: O(|a| * |b|)  Space: O(min(|a|, |b|))
 */
export function levenshteinDistance(a: string, b: string): number {
  // Guarantee `a` is the shorter string to minimise memory usage.
  if (a.length > b.length) return levenshteinDistance(b, a);

  const lenA = a.length;
  const lenB = b.length;

  // Base cases
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  // One row of the DP matrix (the "previous" row)
  let prev = Array.from({ length: lenA + 1 }, (_, i) => i);

  for (let j = 1; j <= lenB; j++) {
    const curr: number[] = [j];
    for (let i = 1; i <= lenA; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        prev[i]! + 1,      // deletion
        curr[i - 1]! + 1,  // insertion
        prev[i - 1]! + cost // substitution
      );
    }
    prev = curr;
  }

  return prev[lenA]!;
}

/**
 * Compute the normalised Levenshtein similarity between two strings.
 *
 * Returns a value in [0.0, 1.0] where:
 *   1.0 = identical strings
 *   0.0 = completely different strings (edit distance = max(|a|, |b|))
 *
 * Both strings are lower-cased and trimmed before comparison so that
 * capitalisation differences do not affect the score.
 */
export function computeSimilarity(a: string, b: string): number {
  const normA = a.toLowerCase().trim();
  const normB = b.toLowerCase().trim();

  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0; // Both empty strings are identical

  const distance = levenshteinDistance(normA, normB);
  return 1 - distance / maxLen;
}

// ---------------------------------------------------------------------------
// DynamoDB query helpers
// ---------------------------------------------------------------------------

/**
 * Query the Products GSI for an exact SKU match within a tenant scope.
 *
 * The Products table uses a GSI keyed on `tenantId` + `sku` to support
 * this lookup.  The environment variable `PRODUCTS_TABLE_NAME` must be set.
 *
 * @returns The productId of the first matching existing product, or null.
 */
async function queryBySku(
  tenantId: string,
  sku: string,
  supplierId?: string
): Promise<string | null> {
  const tableName = process.env['PRODUCTS_TABLE_NAME'];
  if (!tableName) {
    throw new Error('PRODUCTS_TABLE_NAME environment variable is not set');
  }

  const client = getDynamoClient();

  // GSI: GSI1PK = "TENANT#{tenantId}#SKU#{sku}"
  // Using the pattern established in the data model: tenant-scoped SKU index
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `TENANT#${tenantId}#SKU#${sku}`,
      },
      // We only need the first hit and its productId
      Limit: 1,
      ProjectionExpression: 'productId, supplierId',
    })
  );

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  const item = result.Items[0];
  if (!item) return null;

  // If a supplierId filter is provided, only match within the same supplier.
  // (The design calls out duplicate detection within tenant scope; supplier
  // scoping is optional and can be enabled by callers.)
  if (supplierId !== undefined && item['supplierId'] !== supplierId) {
    return null;
  }

  return item['productId'] as string;
}

/**
 * Retrieve all product titles (and their productIds) for a given supplier within
 * a tenant, to be used for the secondary title-similarity check.
 *
 * The query uses the GSI keyed on `TENANT#{tenantId}#SUPPLIER#{supplierId}` so
 * that we only load relevant titles instead of a full table scan.
 */
async function queryTitlesBySupplier(
  tenantId: string,
  supplierId: string
): Promise<Array<{ productId: string; title: string }>> {
  const tableName = process.env['PRODUCTS_TABLE_NAME'];
  if (!tableName) {
    throw new Error('PRODUCTS_TABLE_NAME environment variable is not set');
  }

  const client = getDynamoClient();
  const results: Array<{ productId: string; title: string }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#SUPPLIER#${supplierId}`,
        },
        ProjectionExpression: 'productId, title',
        ExclusiveStartKey: lastEvaluatedKey as Record<string, unknown> | undefined,
      })
    );

    if (result.Items) {
      for (const item of result.Items) {
        if (item['productId'] && item['title']) {
          results.push({
            productId: item['productId'] as string,
            title: item['title'] as string,
          });
        }
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return results;
}

// ---------------------------------------------------------------------------
// Core duplicate check
// ---------------------------------------------------------------------------

/**
 * Check whether an incoming product record is a duplicate of an existing record
 * within the same tenant (and optionally within the same supplier).
 *
 * Steps:
 * 1. If the incoming record has a SKU, query the DynamoDB Products GSI for an
 *    exact match within the tenant.  A match → SKU_EXACT duplicate.
 * 2. If no SKU match (or no SKU provided), fetch all titles for the supplier
 *    and compute Levenshtein similarity for each.  If the best score ≥ 0.85
 *    → TITLE_SIMILAR duplicate.
 * 3. Return a DuplicateCheckResult with the match details.
 */
export async function checkForDuplicate(params: {
  tenantId: string;
  supplierId: string;
  sku?: string;
  title?: string;
}): Promise<DuplicateCheckResult> {
  const { tenantId, supplierId, sku, title } = params;

  // --- Primary check: exact SKU match ---
  if (sku && sku.trim().length > 0) {
    const matchedProductId = await queryBySku(tenantId, sku.trim());
    if (matchedProductId) {
      return {
        isDuplicate: true,
        matchType: 'SKU_EXACT',
        matchedProductId,
        similarityScore: 1.0,
      };
    }
  }

  // --- Secondary check: title similarity ---
  if (title && title.trim().length > 0) {
    const existingProducts = await queryTitlesBySupplier(tenantId, supplierId);
    let bestScore = 0;
    let bestProductId: string | null = null;

    for (const existing of existingProducts) {
      const score = computeSimilarity(title, existing.title);
      if (score > bestScore) {
        bestScore = score;
        bestProductId = existing.productId;
      }
    }

    if (bestScore >= TITLE_SIMILARITY_THRESHOLD && bestProductId) {
      return {
        isDuplicate: true,
        matchType: 'TITLE_SIMILAR',
        matchedProductId: bestProductId,
        similarityScore: bestScore,
      };
    }
  }

  return {
    isDuplicate: false,
    matchType: null,
    matchedProductId: null,
    similarityScore: null,
  };
}

// ---------------------------------------------------------------------------
// Strategy application
// ---------------------------------------------------------------------------

/** Possible actions returned by detectDuplicates after applying the strategy. */
export type DuplicateAction =
  | { action: 'skip' }
  | { action: 'merge'; existingProductId: string }
  | { action: 'create_flagged'; duplicateOf: string }
  | { action: 'create' };

/**
 * Parameters accepted by the main `detectDuplicates` entry point.
 */
export interface DetectDuplicatesParams {
  tenantId: string;
  supplierId: string;
  duplicateStrategy: DuplicateStrategy;
  /** Incoming product data to check */
  record: {
    sku?: string;
    title?: string;
  };
}

/**
 * Main entry point for the Duplicate Detector processor.
 *
 * 1. Queries DynamoDB for SKU exact match and/or title similarity.
 * 2. If a duplicate is found, applies the supplier's configured strategy:
 *    - SKIP → { action: 'skip' }
 *    - MERGE → { action: 'merge', existingProductId }
 *    - CREATE_FLAGGED → { action: 'create_flagged', duplicateOf: existingProductId }
 * 3. If no duplicate → { action: 'create' }
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
export async function detectDuplicates(
  params: DetectDuplicatesParams
): Promise<DuplicateAction> {
  const { tenantId, supplierId, duplicateStrategy, record } = params;

  const checkResult = await checkForDuplicate({
    tenantId,
    supplierId,
    sku: record.sku,
    title: record.title,
  });

  if (!checkResult.isDuplicate || checkResult.matchedProductId === null) {
    return { action: 'create' };
  }

  const existingProductId = checkResult.matchedProductId;

  switch (duplicateStrategy) {
    case 'SKIP':
      return { action: 'skip' };

    case 'MERGE':
      return { action: 'merge', existingProductId };

    case 'CREATE_FLAGGED':
      return { action: 'create_flagged', duplicateOf: existingProductId };

    default: {
      // TypeScript exhaustiveness guard
      const _exhaustive: never = duplicateStrategy;
      throw new Error(`Unknown duplicate strategy: ${String(_exhaustive)}`);
    }
  }
}
