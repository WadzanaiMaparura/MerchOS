/**
 * Token usage tracking and model configuration types for the Product Intelligence Engine.
 *
 * Defines types for recording token consumption, aggregating usage summaries,
 * and configuring model selection per generation type.
 *
 * @module usage.types
 */

import type { GenerationType } from './generation.types';

/**
 * A single token usage recording from a Bedrock invocation.
 * Recorded by the Token Tracker for cost monitoring and budget enforcement.
 */
export interface TokenUsageRecord {
  /** Tenant that owns this usage */
  tenantId: string;
  /** The generation type that consumed tokens */
  generationType: GenerationType;
  /** Number of input tokens sent to the model */
  inputTokens: number;
  /** Number of output tokens received from the model */
  outputTokens: number;
  /** The Bedrock model ID used for this invocation */
  modelId: string;
  /** ISO 8601 timestamp of the invocation */
  timestamp: string;
}

/**
 * Aggregated token usage summary for a tenant over a time period.
 * Used for dashboard display and budget enforcement.
 */
export interface TokenUsageSummary {
  /** Tenant this summary belongs to */
  tenantId: string;
  /** The aggregation period */
  period: 'daily' | 'monthly';
  /** Total input tokens consumed in the period */
  totalInputTokens: number;
  /** Total output tokens consumed in the period */
  totalOutputTokens: number;
  /** Estimated total cost in USD for the period */
  totalCost: number;
  /** Configured monthly budget limit (in token units) */
  budgetLimit: number;
  /** Remaining budget before enforcement triggers */
  budgetRemaining: number;
  /** Usage breakdown by generation type */
  breakdown: Record<GenerationType, { inputTokens: number; outputTokens: number }>;
}

/**
 * Model selection configuration for a specific generation type.
 * Determines which Bedrock model and parameters are used.
 */
export interface ModelConfig {
  /** The generation type this config applies to */
  generationType: GenerationType;
  /** The full Bedrock model identifier (e.g., 'anthropic.claude-3-haiku-20240307-v1:0') */
  modelId: string;
  /** Maximum output tokens for this model/type combination */
  maxTokens: number;
  /** Temperature for controlling randomness (0.0 to 1.0) */
  temperature: number;
}
