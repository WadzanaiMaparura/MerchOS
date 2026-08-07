/**
 * DynamoDB item schemas for the Product Intelligence Engine.
 *
 * Defines the exact shape of items stored in the single-table DynamoDB design.
 * All items use TENANT# prefixed partition keys for tenant isolation.
 *
 * @module dynamo.types
 */

import type {
  GeneratedContent,
  GenerationRequest,
  GenerationType,
  MarketplaceId,
} from './generation.types';

/**
 * DynamoDB item schema for a stored generation result.
 *
 * Access patterns:
 * - Get Result: PK=TENANT#{tenantId}, SK=RESULT#{resultId}
 * - List Results by Date (GSI1): GSI1PK=TENANT#{tenantId}, GSI1SK=RESULT#CREATED#{ts}
 * - List Results by Confidence (GSI2): GSI2PK=TENANT#{tenantId}#CONFIDENCE, GSI2SK=SCORE#{score}#CREATED#{ts}
 */
export interface GenerationResultItem {
  /** Partition key: TENANT#{tenantId} */
  PK: `TENANT#${string}`;
  /** Sort key: RESULT#{resultId} */
  SK: `RESULT#${string}`;
  /** GSI1 partition key: TENANT#{tenantId} */
  GSI1PK: `TENANT#${string}`;
  /** GSI1 sort key: RESULT#CREATED#{timestamp} */
  GSI1SK: `RESULT#CREATED#${string}`;
  /** GSI2 partition key: TENANT#{tenantId}#CONFIDENCE */
  GSI2PK: `TENANT#${string}#CONFIDENCE`;
  /** GSI2 sort key: SCORE#{score}#CREATED#{timestamp} */
  GSI2SK: `SCORE#${string}#CREATED#${string}`;
  /** Unique result identifier */
  resultId: string;
  /** Tenant that owns this result */
  tenantId: string;
  /** The generation type that produced this result */
  generationType: GenerationType;
  /** Completion status */
  status: 'completed' | 'failed';
  /** The original generation request */
  request: GenerationRequest;
  /** The generated content payload */
  result: GeneratedContent;
  /** Confidence score (0.0 to 1.0) */
  confidenceScore: number;
  /** Whether manual review is recommended */
  reviewRecommended: boolean;
  /** Token counts from the Bedrock invocation */
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** Prompt template version used */
  promptVersion: number;
  /** Prompt template ID used */
  promptTemplateId: string;
  /** Target marketplace if specified */
  marketplace?: MarketplaceId;
  /** Marketplace compliance status if applicable */
  marketplaceCompliance?: 'compliant' | 'warnings' | 'non_compliant';
  /** Whether the result was served from cache */
  cached: boolean;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Optional DynamoDB TTL (epoch seconds) */
  ttl?: number;
}

/**
 * DynamoDB item schema for a stored prompt template.
 *
 * Access patterns:
 * - Get Prompt Template: PK=PROMPT#{generationType}, SK=VERSION#{version}
 * - List Active Templates: PK=PROMPT#{generationType}, SK begins_with VERSION#
 */
export interface PromptTemplateItem {
  /** Partition key: PROMPT#{generationType} */
  PK: `PROMPT#${string}`;
  /** Sort key: VERSION#{version} */
  SK: `VERSION#${string}`;
  /** Unique template identifier */
  templateId: string;
  /** The generation type this template is for */
  generationType: GenerationType;
  /** Monotonically increasing version number */
  version: number;
  /** Template content with {{variable}} placeholders */
  content: string;
  /** Variable names expected by this template */
  variables: string[];
  /** Whether this template is currently active */
  active: boolean;
  /** Traffic percentage for A/B testing */
  trafficPercentage?: number;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ID of the user who created this template */
  createdBy: string;
}

/**
 * DynamoDB item schema for a response cache entry.
 *
 * Access patterns:
 * - Cache Lookup: PK=CACHE#{sha256Hash}, SK=ENTRY
 */
export interface CacheEntryItem {
  /** Partition key: CACHE#{sha256Hash} */
  PK: `CACHE#${string}`;
  /** Sort key: always 'ENTRY' */
  SK: 'ENTRY';
  /** The computed SHA-256 cache key */
  cacheKey: string;
  /** Generation type of the cached result */
  generationType: GenerationType;
  /** Prompt version that produced this cached result */
  promptVersion: number;
  /** The cached generated content */
  result: GeneratedContent;
  /** Confidence score of the cached result */
  confidenceScore: number;
  /** Token usage from the original generation */
  tokenUsage: { inputTokens: number; outputTokens: number };
  /** ISO 8601 timestamp when the entry was cached */
  createdAt: string;
  /** DynamoDB TTL attribute (epoch seconds) */
  ttl: number;
}

/**
 * DynamoDB item schema for aggregated token usage.
 *
 * Access patterns:
 * - Get Token Usage (daily): PK=TENANT#{tenantId}#USAGE, SK=DAY#{date}
 * - Get Token Usage (monthly): PK=TENANT#{tenantId}#USAGE, SK=MONTH#{yearMonth}
 */
export interface TokenUsageItem {
  /** Partition key: TENANT#{tenantId}#USAGE */
  PK: `TENANT#${string}#USAGE`;
  /** Sort key: DAY#{YYYY-MM-DD} or MONTH#{YYYY-MM} */
  SK: `DAY#${string}` | `MONTH#${string}`;
  /** Tenant this usage belongs to */
  tenantId: string;
  /** The period identifier (date or month string) */
  period: string;
  /** Total input tokens consumed in this period */
  totalInputTokens: number;
  /** Total output tokens consumed in this period */
  totalOutputTokens: number;
  /** Breakdown by generation type */
  breakdown: Record<string, { inputTokens: number; outputTokens: number }>;
  /** Configured budget limit for budget enforcement */
  budgetLimit: number;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}
