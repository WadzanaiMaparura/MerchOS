/**
 * Product Intelligence Engine - Shared Types
 *
 * Barrel export for all type definitions used across the service.
 * Import from this module for convenient access to all types.
 *
 * @example
 * ```typescript
 * import { GenerationType, GenerationRequest, GenerationResult } from '../types';
 * ```
 *
 * @module types
 */

// Core generation types
export type {
  GenerationType,
  MarketplaceId,
  ProductData,
  GenerationRequest,
  GeneratedContent,
  GenerationResult,
  BatchGenerationRequest,
  BatchGenerationResult,
  SEOAnalysisResult,
  CategoryPredictionResult,
  BrandDetectionResult,
  AttributeExtractionResult,
  KeywordGenerationResult,
  ComplianceValidationResult,
  MarketplaceAdaptedContent,
} from './generation.types';

// Prompt management types
export type {
  PromptTemplate,
  ABTestConfig,
  CreatePromptTemplateInput,
} from './prompt.types';

// Cache types
export type {
  CacheKeyInput,
  CacheEntryItem as CacheEntry,
} from './cache.types';

// Token usage and model configuration types
export type {
  TokenUsageRecord,
  TokenUsageSummary,
  ModelConfig,
} from './usage.types';

// DynamoDB item schemas
export type {
  GenerationResultItem,
  PromptTemplateItem,
  CacheEntryItem as DynamoCacheEntryItem,
  TokenUsageItem,
} from './dynamo.types';
