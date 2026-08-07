/**
 * Unit tests for the Response Cache service.
 *
 * Tests cache key computation, DynamoDB get/set operations,
 * and cache invalidation by prompt version.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import {
  computeKey,
  ResponseCache,
  setDynamoDocClient,
} from '../../services/response-cache';
import type { CacheKeyInput } from '../../types/cache.types';
import type { GenerationResult } from '../../types/generation.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDocClient() {
  const sendSpy = vi.fn();
  const client = { send: sendSpy } as unknown as DynamoDBDocumentClient;
  return { client, sendSpy };
}

function buildCacheKeyInput(overrides?: Partial<CacheKeyInput>): CacheKeyInput {
  return {
    normalizedInput: 'test product data',
    generationType: 'title',
    marketplace: 'amazon',
    promptVersion: 1,
    ...overrides,
  };
}

function buildGenerationResult(overrides?: Partial<GenerationResult>): GenerationResult {
  return {
    resultId: 'result-123',
    type: 'title',
    status: 'completed',
    content: { type: 'title', title: 'Test Product Title' },
    confidenceScore: 0.85,
    reviewRecommended: false,
    metadata: {
      promptVersion: 1,
      promptTemplateId: 'template-title-v1',
      tokenUsage: { inputTokens: 100, outputTokens: 25 },
      cached: false,
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      latencyMs: 450,
      marketplace: 'amazon',
    },
    createdAt: '2024-01-15T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeKey tests
// ---------------------------------------------------------------------------

describe('computeKey', () => {
  it('should produce a 64-character hex string (SHA-256)', () => {
    const input = buildCacheKeyInput();
    const key = computeKey(input);

    expect(key).toHaveLength(64);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should produce the same hash for identical inputs (determinism)', () => {
    const input = buildCacheKeyInput();
    const key1 = computeKey(input);
    const key2 = computeKey(input);

    expect(key1).toBe(key2);
  });

  it('should produce different hashes when normalizedInput differs', () => {
    const input1 = buildCacheKeyInput({ normalizedInput: 'product A' });
    const input2 = buildCacheKeyInput({ normalizedInput: 'product B' });

    expect(computeKey(input1)).not.toBe(computeKey(input2));
  });

  it('should produce different hashes when generationType differs', () => {
    const input1 = buildCacheKeyInput({ generationType: 'title' });
    const input2 = buildCacheKeyInput({ generationType: 'description' });

    expect(computeKey(input1)).not.toBe(computeKey(input2));
  });

  it('should produce different hashes when marketplace differs', () => {
    const input1 = buildCacheKeyInput({ marketplace: 'amazon' });
    const input2 = buildCacheKeyInput({ marketplace: 'shopify' });

    expect(computeKey(input1)).not.toBe(computeKey(input2));
  });

  it('should produce different hashes when promptVersion differs', () => {
    const input1 = buildCacheKeyInput({ promptVersion: 1 });
    const input2 = buildCacheKeyInput({ promptVersion: 2 });

    expect(computeKey(input1)).not.toBe(computeKey(input2));
  });

  it('should handle undefined marketplace consistently', () => {
    const input1 = buildCacheKeyInput({ marketplace: undefined });
    const input2 = buildCacheKeyInput({ marketplace: undefined });

    expect(computeKey(input1)).toBe(computeKey(input2));
  });

  it('should differentiate between undefined and defined marketplace', () => {
    const input1 = buildCacheKeyInput({ marketplace: undefined });
    const input2 = buildCacheKeyInput({ marketplace: 'amazon' });

    expect(computeKey(input1)).not.toBe(computeKey(input2));
  });
});

// ---------------------------------------------------------------------------
// ResponseCache.get tests
// ---------------------------------------------------------------------------

describe('ResponseCache.get', () => {
  let cache: ResponseCache;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockDocClient();
    sendSpy = mock.sendSpy;
    setDynamoDocClient(mock.client);
    cache = new ResponseCache();
  });

  it('should return null when no item found', async () => {
    sendSpy.mockResolvedValueOnce({ Item: undefined });

    const result = await cache.get('abc123');

    expect(result).toBeNull();
  });

  it('should return a GenerationResult when item exists', async () => {
    sendSpy.mockResolvedValueOnce({
      Item: {
        PK: 'CACHE#abc123',
        SK: 'ENTRY',
        cacheKey: 'abc123',
        generationType: 'title',
        promptVersion: 1,
        result: { type: 'title', title: 'Cached Title' },
        confidenceScore: 0.9,
        tokenUsage: { inputTokens: 50, outputTokens: 10 },
        createdAt: '2024-01-15T10:00:00.000Z',
        ttl: 1705401600,
      },
    });

    const result = await cache.get('abc123');

    expect(result).not.toBeNull();
    expect(result!.type).toBe('title');
    expect(result!.status).toBe('completed');
    expect(result!.content).toEqual({ type: 'title', title: 'Cached Title' });
    expect(result!.confidenceScore).toBe(0.9);
    expect(result!.metadata.cached).toBe(true);
    expect(result!.metadata.promptVersion).toBe(1);
    expect(result!.metadata.tokenUsage).toEqual({ inputTokens: 50, outputTokens: 10 });
  });

  it('should query DynamoDB with correct PK and SK', async () => {
    sendSpy.mockResolvedValueOnce({ Item: undefined });

    await cache.get('my-cache-key');

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0];
    expect(command.input).toEqual({
      TableName: 'product-intelligence',
      Key: {
        PK: 'CACHE#my-cache-key',
        SK: 'ENTRY',
      },
    });
  });

  it('should set reviewRecommended=true when confidence < 0.7', async () => {
    sendSpy.mockResolvedValueOnce({
      Item: {
        PK: 'CACHE#key1',
        SK: 'ENTRY',
        cacheKey: 'key1',
        generationType: 'title',
        promptVersion: 1,
        result: { type: 'title', title: 'Low Confidence' },
        confidenceScore: 0.5,
        tokenUsage: { inputTokens: 50, outputTokens: 10 },
        createdAt: '2024-01-15T10:00:00.000Z',
        ttl: 1705401600,
      },
    });

    const result = await cache.get('key1');

    expect(result!.reviewRecommended).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ResponseCache.set tests
// ---------------------------------------------------------------------------

describe('ResponseCache.set', () => {
  let cache: ResponseCache;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockDocClient();
    sendSpy = mock.sendSpy;
    setDynamoDocClient(mock.client);
    cache = new ResponseCache();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00.000Z'));
  });

  it('should store a cache entry with default 24-hour TTL', async () => {
    sendSpy.mockResolvedValueOnce({});

    const result = buildGenerationResult();
    await cache.set('cache-key-1', result);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0][0];
    const item = command.input.Item;

    expect(item.PK).toBe('CACHE#cache-key-1');
    expect(item.SK).toBe('ENTRY');
    expect(item.cacheKey).toBe('cache-key-1');
    expect(item.generationType).toBe('title');
    expect(item.promptVersion).toBe(1);

    // TTL should be current time (epoch) + 86400
    const currentEpoch = Math.floor(Date.now() / 1000);
    expect(item.ttl).toBe(currentEpoch + 86400);
  });

  it('should store a cache entry with custom TTL', async () => {
    sendSpy.mockResolvedValueOnce({});

    const result = buildGenerationResult();
    await cache.set('cache-key-2', result, 3600); // 1 hour

    const command = sendSpy.mock.calls[0][0];
    const item = command.input.Item;

    const currentEpoch = Math.floor(Date.now() / 1000);
    expect(item.ttl).toBe(currentEpoch + 3600);
  });

  it('should store the correct content in the cache entry', async () => {
    sendSpy.mockResolvedValueOnce({});

    const result = buildGenerationResult({
      content: { type: 'title', title: 'Amazing Product' },
      confidenceScore: 0.95,
    });
    await cache.set('key-3', result);

    const command = sendSpy.mock.calls[0][0];
    const item = command.input.Item;

    expect(item.result).toEqual({ type: 'title', title: 'Amazing Product' });
    expect(item.confidenceScore).toBe(0.95);
  });
});

// ---------------------------------------------------------------------------
// ResponseCache.invalidateByPromptVersion tests
// ---------------------------------------------------------------------------

describe('ResponseCache.invalidateByPromptVersion', () => {
  let cache: ResponseCache;
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mock = createMockDocClient();
    sendSpy = mock.sendSpy;
    setDynamoDocClient(mock.client);
    cache = new ResponseCache();
  });

  it('should query GSI for matching entries and delete them', async () => {
    // First call: QueryCommand returns matching items
    sendSpy.mockResolvedValueOnce({
      Items: [
        { PK: 'CACHE#hash1', SK: 'ENTRY' },
        { PK: 'CACHE#hash2', SK: 'ENTRY' },
      ],
      LastEvaluatedKey: undefined,
    });

    // Delete calls
    sendSpy.mockResolvedValueOnce({});
    sendSpy.mockResolvedValueOnce({});

    await cache.invalidateByPromptVersion('title', 1);

    // 1 query + 2 deletes = 3 calls
    expect(sendSpy).toHaveBeenCalledTimes(3);
  });

  it('should handle empty query results gracefully', async () => {
    sendSpy.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    await cache.invalidateByPromptVersion('description', 2);

    // Only the query call
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('should paginate through results when LastEvaluatedKey is present', async () => {
    // First page
    sendSpy.mockResolvedValueOnce({
      Items: [{ PK: 'CACHE#hash1', SK: 'ENTRY' }],
      LastEvaluatedKey: { PK: 'CACHE#hash1', SK: 'ENTRY' },
    });
    sendSpy.mockResolvedValueOnce({}); // delete

    // Second page
    sendSpy.mockResolvedValueOnce({
      Items: [{ PK: 'CACHE#hash2', SK: 'ENTRY' }],
      LastEvaluatedKey: undefined,
    });
    sendSpy.mockResolvedValueOnce({}); // delete

    await cache.invalidateByPromptVersion('seo', 3);

    // 2 queries + 2 deletes = 4 calls
    expect(sendSpy).toHaveBeenCalledTimes(4);
  });
});

// ---------------------------------------------------------------------------
// ResponseCache.computeKey (instance method) tests
// ---------------------------------------------------------------------------

describe('ResponseCache.computeKey (instance method)', () => {
  it('should produce the same result as the standalone computeKey function', () => {
    const cache = new ResponseCache();
    const input = buildCacheKeyInput();

    expect(cache.computeKey(input)).toBe(computeKey(input));
  });
});
