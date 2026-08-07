/**
 * Response Cache service for the Product Intelligence Engine.
 *
 * Implements SHA-256 hash-based cache lookups in DynamoDB to reduce
 * Bedrock invocation costs and latency for repeated identical requests.
 * Cache entries use DynamoDB TTL for automatic expiration (default 24 hours).
 *
 * @module response-cache
 */

import { createHash } from 'crypto';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

import type { GenerationResult, GenerationType } from '../types/generation.types';
import type { CacheKeyInput } from '../types/cache.types';
import type { CacheEntryItem } from '../types/dynamo.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default cache TTL: 24 hours in seconds */
const DEFAULT_TTL_SECONDS = 86400;

/** DynamoDB table name from environment */
const TABLE_NAME = process.env['PRODUCT_INTELLIGENCE_TABLE'] ?? 'product-intelligence';

// ---------------------------------------------------------------------------
// DynamoDB Client Setup
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

/**
 * Override the DynamoDB Document Client (used for testing).
 *
 * @param client - The mock or test DynamoDB document client
 */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// Cache Key Computation
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 cache key from the given input.
 *
 * The key is produced by JSON-serializing the input fields with sorted keys
 * to ensure determinism regardless of property insertion order.
 *
 * Property 6: Same inputs produce same SHA-256 hash; different inputs produce different hashes.
 *
 * @param input - The cache key input containing normalized data, generation type, marketplace, and prompt version
 * @returns A hex-encoded SHA-256 hash string
 */
export function computeKey(input: CacheKeyInput): string {
  const payload = {
    generationType: input.generationType,
    marketplace: input.marketplace ?? null,
    normalizedInput: input.normalizedInput,
    promptVersion: input.promptVersion,
  };

  const serialized = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(serialized).digest('hex');
}

// ---------------------------------------------------------------------------
// Response Cache Class
// ---------------------------------------------------------------------------

/**
 * Response Cache service that stores and retrieves cached generation results
 * from DynamoDB using SHA-256 hash-based keys.
 *
 * Implements the cache-aside pattern:
 * 1. Check cache before Bedrock invocation
 * 2. On miss, invoke Bedrock and store result in cache
 * 3. Invalidate on prompt version change
 */
export class ResponseCache {
  /**
   * Computes a deterministic SHA-256 cache key from the given input.
   *
   * @param input - The cache key input
   * @returns A hex-encoded SHA-256 hash string
   */
  computeKey(input: CacheKeyInput): string {
    return computeKey(input);
  }

  /**
   * Retrieves a cached generation result from DynamoDB.
   *
   * Queries with PK=`CACHE#{cacheKey}`, SK=`ENTRY`.
   * Returns null if the entry does not exist or has expired (TTL handled by DynamoDB).
   *
   * @param cacheKey - The SHA-256 cache key to look up
   * @returns The cached GenerationResult or null if not found
   */
  async get(cacheKey: string): Promise<GenerationResult | null> {
    const client = getDynamoDocClient();

    const response = await client.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `CACHE#${cacheKey}`,
          SK: 'ENTRY',
        },
      }),
    );

    if (!response.Item) {
      return null;
    }

    const item = response.Item as CacheEntryItem;

    // Reconstruct GenerationResult from cache entry
    const result: GenerationResult = {
      resultId: `cached-${cacheKey.slice(0, 8)}`,
      type: item.generationType,
      status: 'completed',
      content: item.result,
      confidenceScore: item.confidenceScore,
      reviewRecommended: item.confidenceScore < 0.7,
      metadata: {
        promptVersion: item.promptVersion,
        promptTemplateId: `template-${item.generationType}`,
        tokenUsage: item.tokenUsage,
        cached: true,
        modelId: 'cached',
        latencyMs: 0,
      },
      createdAt: item.createdAt,
    };

    return result;
  }

  /**
   * Stores a generation result in the DynamoDB cache with a TTL.
   *
   * Writes to PK=`CACHE#{cacheKey}`, SK=`ENTRY` with DynamoDB TTL
   * attribute set to current time + ttlSeconds.
   *
   * @param cacheKey - The SHA-256 cache key
   * @param result - The generation result to cache
   * @param ttlSeconds - Time-to-live in seconds (default: 24 hours / 86400 seconds)
   */
  async set(
    cacheKey: string,
    result: GenerationResult,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    const client = getDynamoDocClient();
    const now = Math.floor(Date.now() / 1000);

    const item: CacheEntryItem = {
      PK: `CACHE#${cacheKey}`,
      SK: 'ENTRY',
      cacheKey,
      generationType: result.type,
      promptVersion: result.metadata.promptVersion,
      result: result.content,
      confidenceScore: result.confidenceScore,
      tokenUsage: result.metadata.tokenUsage,
      createdAt: result.createdAt,
      ttl: now + ttlSeconds,
    };

    await client.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      }),
    );
  }

  /**
   * Invalidates all cached entries for a specific generation type and prompt version.
   *
   * Queries a GSI to find cache entries matching the generation type and old prompt version,
   * then deletes each matching entry. This ensures stale cached results from a previous
   * prompt version are not served after a prompt template update.
   *
   * @param generationType - The generation type to invalidate
   * @param oldVersion - The previous prompt version whose cache entries should be removed
   */
  async invalidateByPromptVersion(
    generationType: GenerationType,
    oldVersion: number,
  ): Promise<void> {
    const client = getDynamoDocClient();

    // Scan for cache entries matching the generation type and old prompt version.
    // Since cache entries use CACHE#{hash} as PK, we use a scan with filter.
    // In production, a GSI on generationType+promptVersion would be more efficient.
    // For now, we query by scanning the table with a filter expression.
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const queryInput = {
        TableName: TABLE_NAME,
        IndexName: 'GSI-CacheByType',
        KeyConditionExpression: 'generationType = :gt AND promptVersion = :pv',
        ExpressionAttributeValues: {
          ':gt': generationType,
          ':pv': oldVersion,
        },
        ...(lastEvaluatedKey ? { ExclusiveStartKey: lastEvaluatedKey } : {}),
      };

      const response = await client.send(new QueryCommand(queryInput));

      const items = (response.Items ?? []) as Pick<CacheEntryItem, 'PK' | 'SK'>[];

      // Delete each matching cache entry
      const deletePromises = items.map((item) =>
        client.send(
          new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { PK: item.PK, SK: item.SK },
          }),
        ),
      );

      await Promise.all(deletePromises);

      lastEvaluatedKey = response.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared ResponseCache instance */
export const responseCache = new ResponseCache();
