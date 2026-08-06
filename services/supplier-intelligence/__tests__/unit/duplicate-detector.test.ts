/**
 * Unit tests for the Duplicate Detector processor.
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  computeSimilarity,
  levenshteinDistance,
  detectDuplicates,
  setDynamoClient,
  resetDynamoClient,
  TITLE_SIMILARITY_THRESHOLD,
} from '../../processors/duplicate-detector';

// ---------------------------------------------------------------------------
// levenshteinDistance — pure unit tests (no AWS needed)
// ---------------------------------------------------------------------------

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns the length of the non-empty string when the other is empty', () => {
    expect(levenshteinDistance('', 'hello')).toBe(5);
    expect(levenshteinDistance('hello', '')).toBe(5);
  });

  it('returns 0 for two empty strings', () => {
    expect(levenshteinDistance('', '')).toBe(0);
  });

  it('computes single-character differences', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('saturday', 'sunday')).toBe(3);
  });

  it('is commutative — distance(a,b) == distance(b,a)', () => {
    expect(levenshteinDistance('abc', 'xyz')).toBe(levenshteinDistance('xyz', 'abc'));
  });

  it('computes distance for single character strings', () => {
    expect(levenshteinDistance('a', 'b')).toBe(1);
    expect(levenshteinDistance('a', 'a')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeSimilarity — pure unit tests (no AWS needed)
// ---------------------------------------------------------------------------

describe('computeSimilarity', () => {
  it('returns 1.0 for identical strings', () => {
    expect(computeSimilarity('Blue Shirt', 'Blue Shirt')).toBe(1.0);
  });

  it('returns 1.0 for empty strings', () => {
    expect(computeSimilarity('', '')).toBe(1.0);
  });

  it('is case-insensitive', () => {
    expect(computeSimilarity('Blue Shirt', 'blue shirt')).toBe(1.0);
    expect(computeSimilarity('BLUE SHIRT', 'blue shirt')).toBe(1.0);
  });

  it('trims whitespace before comparison', () => {
    expect(computeSimilarity('  Blue Shirt  ', 'Blue Shirt')).toBe(1.0);
  });

  it('returns a value in [0, 1] for any two strings', () => {
    const score = computeSimilarity('hello', 'world');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns a high score for very similar strings', () => {
    // One character different out of 10 → distance=1, maxLen=11 → score≈0.909
    const score = computeSimilarity('Blue Shirt', 'Blue Shirt!');
    expect(score).toBeGreaterThan(TITLE_SIMILARITY_THRESHOLD);
  });

  it('returns a low score for completely different strings', () => {
    const score = computeSimilarity('aaaaaa', 'bbbbbb');
    expect(score).toBeLessThan(0.5);
  });

  it('returns 0.0 when one string is empty and the other is not', () => {
    // distance = len of non-empty, maxLen = len of non-empty → 1 - 1 = 0
    expect(computeSimilarity('', 'hello')).toBe(0.0);
    expect(computeSimilarity('hello', '')).toBe(0.0);
  });

  it('is symmetric — similarity(a,b) == similarity(b,a)', () => {
    const s1 = computeSimilarity('Apple iPhone', 'Apple iPhone 15');
    const s2 = computeSimilarity('Apple iPhone 15', 'Apple iPhone');
    expect(s1).toBeCloseTo(s2, 10);
  });

  it('scores near-identical product titles above the threshold', () => {
    expect(computeSimilarity(
      'Nike Air Max 270 Running Shoe',
      'Nike Air Max 270 Running Shoes'
    )).toBeGreaterThanOrEqual(TITLE_SIMILARITY_THRESHOLD);
  });

  it('scores clearly different product titles below the threshold', () => {
    expect(computeSimilarity(
      'Nike Air Max Running Shoe',
      'Adidas Ultraboost Trail Sneaker'
    )).toBeLessThan(TITLE_SIMILARITY_THRESHOLD);
  });
});

// ---------------------------------------------------------------------------
// detectDuplicates — DynamoDB tests using a spy on the injected client.send()
//
// We inject a fake DynamoDBDocumentClient via setDynamoClient() and spy on
// its send() method. This avoids cross-module resolution issues that occur
// when aws-sdk-client-mock is used with workspace-level node_modules.
// ---------------------------------------------------------------------------

describe('detectDuplicates', () => {
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi.fn();
    const fakeClient = { send: sendSpy } as unknown as DynamoDBDocumentClient;
    setDynamoClient(fakeClient);
    process.env['PRODUCTS_TABLE_NAME'] = 'products-test-table';
  });

  afterEach(() => {
    resetDynamoClient();
    delete process.env['PRODUCTS_TABLE_NAME'];
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Requirement 7.1 — SKU exact match
  // -------------------------------------------------------------------------

  it('detects SKU exact match and returns action=skip for SKIP strategy', async () => {
    sendSpy.mockResolvedValueOnce({
      Items: [{ productId: 'existing-prod-1', supplierId: 'sup-1' }],
    });

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'SKIP',
      record: { sku: 'SKU-001', title: 'Some Product' },
    });

    expect(result).toEqual({ action: 'skip' });
  });

  it('detects SKU exact match and returns action=merge for MERGE strategy', async () => {
    sendSpy.mockResolvedValueOnce({
      Items: [{ productId: 'existing-prod-2', supplierId: 'sup-1' }],
    });

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'MERGE',
      record: { sku: 'SKU-002', title: 'Another Product' },
    });

    expect(result).toEqual({ action: 'merge', existingProductId: 'existing-prod-2' });
  });

  it('detects SKU exact match and returns action=create_flagged for CREATE_FLAGGED strategy', async () => {
    sendSpy.mockResolvedValueOnce({
      Items: [{ productId: 'existing-prod-3', supplierId: 'sup-1' }],
    });

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'CREATE_FLAGGED',
      record: { sku: 'SKU-003', title: 'Yet Another Product' },
    });

    expect(result).toEqual({ action: 'create_flagged', duplicateOf: 'existing-prod-3' });
  });

  // -------------------------------------------------------------------------
  // Requirement 7.2 — title similarity (secondary check)
  // -------------------------------------------------------------------------

  it('falls through to title similarity when SKU query returns no results', async () => {
    sendSpy
      .mockResolvedValueOnce({ Items: [] })          // SKU check → no match
      .mockResolvedValueOnce({                        // Title similarity check
        Items: [
          { productId: 'existing-prod-title', title: 'Nike Air Max 270 Running Shoe' },
        ],
      });

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'CREATE_FLAGGED',
      record: {
        sku: 'SKU-NEW',
        title: 'Nike Air Max 270 Running Shoes', // very similar title
      },
    });

    expect(result).toEqual({
      action: 'create_flagged',
      duplicateOf: 'existing-prod-title',
    });
  });

  it('returns action=create when title similarity is below the threshold', async () => {
    sendSpy
      .mockResolvedValueOnce({ Items: [] }) // SKU check → no match
      .mockResolvedValueOnce({              // Title similarity check → different title
        Items: [
          { productId: 'existing-prod-different', title: 'Adidas Ultraboost Trail Sneaker' },
        ],
      });

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'SKIP',
      record: {
        sku: 'SKU-NEW',
        title: 'Nike Air Max Running Shoe',
      },
    });

    expect(result).toEqual({ action: 'create' });
  });

  // -------------------------------------------------------------------------
  // Requirement 7.3 — no duplicate found
  // -------------------------------------------------------------------------

  it('returns action=create when no SKU or title match exists', async () => {
    sendSpy
      .mockResolvedValueOnce({ Items: [] }) // SKU check
      .mockResolvedValueOnce({ Items: [] }); // title check

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'MERGE',
      record: { sku: 'BRAND-NEW-SKU', title: 'Completely New Product' },
    });

    expect(result).toEqual({ action: 'create' });
  });

  it('returns action=create when record has no SKU and no title', async () => {
    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'CREATE_FLAGGED',
      record: {},
    });

    expect(result).toEqual({ action: 'create' });
    // No DynamoDB calls should have been made for empty inputs
    expect(sendSpy).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Requirement 7.4 — strategy dispatch edge cases
  // -------------------------------------------------------------------------

  it('skips title similarity check when SKU match is found (short circuit)', async () => {
    sendSpy.mockResolvedValueOnce({
      Items: [{ productId: 'existing-by-sku', supplierId: 'sup-1' }],
    });

    await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'SKIP',
      record: { sku: 'SKU-EXISTS', title: 'Some Title' },
    });

    // Only one send call (SKU check) — title check should not have been made
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('only checks title when SKU is absent (no SKU query)', async () => {
    sendSpy.mockResolvedValueOnce({ Items: [] }); // title query only

    await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'MERGE',
      record: { title: 'Some Product Without SKU' },
    });

    // Only one send call (title check) — no SKU check
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('picks the highest-scoring title match when multiple exist', async () => {
    sendSpy
      .mockResolvedValueOnce({ Items: [] }) // SKU check
      .mockResolvedValueOnce({
        Items: [
          { productId: 'low-score', title: 'Apple iPad Air' },
          { productId: 'high-score', title: 'Apple iPhone 15 Pro Max' },
          { productId: 'medium-score', title: 'Apple iPhone 15 Pro' },
        ],
      });

    const result = await detectDuplicates({
      tenantId: 'tenant-a',
      supplierId: 'sup-1',
      duplicateStrategy: 'MERGE',
      record: { sku: 'NEW', title: 'Apple iPhone 15 Pro Max' },
    });

    // Exact match with 'Apple iPhone 15 Pro Max' → highest score = 1.0
    expect(result).toEqual({ action: 'merge', existingProductId: 'high-score' });
  });

  // -------------------------------------------------------------------------
  // Environment variable guard
  // -------------------------------------------------------------------------

  it('throws when PRODUCTS_TABLE_NAME is not set', async () => {
    delete process.env['PRODUCTS_TABLE_NAME'];

    await expect(
      detectDuplicates({
        tenantId: 'tenant-a',
        supplierId: 'sup-1',
        duplicateStrategy: 'SKIP',
        record: { sku: 'SKU-001' },
      })
    ).rejects.toThrow('PRODUCTS_TABLE_NAME environment variable is not set');
  });
});
