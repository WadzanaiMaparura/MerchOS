/**
 * Response cache types for the Product Intelligence Engine.
 *
 * Defines the cache key computation input and DynamoDB cache entry structure
 * used by the Response Cache service for SHA-256 hash-based cache lookups.
 *
 * @module cache.types
 */

import type { GeneratedContent, GenerationType, MarketplaceId } from './generation.types';

/**
 * Input fields used to compute a deterministic SHA-256 cache key.
 * Identical inputs always produce the same key; different inputs produce different keys.
 */
export interface CacheKeyInput {
  /** Normalized input data string (product data serialized consistently) */
  normalizedInput: string;
  /** The generation type for this request */
  generationType: GenerationType;
  /** Target marketplace if specified */
  marketplace?: MarketplaceId;
  /** The prompt template version used */
  promptVersion: number;
}

/**
 * A cache entry stored in DynamoDB.
 * Cached responses are returned directly without invoking Bedrock.
 */
export interface CacheEntryItem {
  /** The computed SHA-256 cache key */
  cacheKey: string;
  /** Generation type of the cached result */
  generationType: GenerationType;
  /** Prompt template version that produced this result */
  promptVersion: number;
  /** The cached generated content */
  result: GeneratedContent;
  /** Confidence score of the cached result */
  confidenceScore: number;
  /** Token usage from the original generation */
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** ISO 8601 timestamp when the cache entry was created */
  createdAt: string;
  /** DynamoDB TTL attribute (epoch seconds) for automatic expiration */
  ttl: number;
}
