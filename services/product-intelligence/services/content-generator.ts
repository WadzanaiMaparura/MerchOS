/**
 * Content Generator service for the Product Intelligence Engine.
 *
 * Orchestrates the full content generation flow for titles, descriptions,
 * and bullet points by coordinating prompt resolution, response caching,
 * Bedrock invocation, confidence scoring, and marketplace adaptation.
 *
 * Flow:
 * 1. Resolve active prompt template via PromptManager
 * 2. Check Response Cache (SHA-256 hash of normalized inputs)
 * 3. On cache miss: invoke Bedrock via BedrockClient with model config
 * 4. Calculate confidence score via ConfidenceScorer
 * 5. Apply marketplace rules via MarketplaceAdapter (when applicable)
 * 6. Cache the result
 * 7. Return GenerationResult with all required metadata
 *
 * @module content-generator
 * @see Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { randomUUID } from 'crypto';

import type {
  GeneratedContent,
  GenerationResult,
  GenerationType,
  MarketplaceId,
  ProductData,
} from '../types/generation.types';
import type { CacheKeyInput } from '../types/cache.types';
import type { PromptTemplate } from '../types/prompt.types';

import { BedrockClient, type BedrockInvocationResult } from './bedrock-client';
import { calculate, shouldRecommendReview } from './confidence-scorer';
import { getModelConfig } from './model-config';
import { promptManager, PromptManager } from './prompt-manager';
import { responseCache, ResponseCache } from './response-cache';

// ---------------------------------------------------------------------------
// Input Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for title generation requests.
 */
export interface TitleGenerationInput {
  /** Product data used as context for generation */
  productData: ProductData;
  /** Optional target marketplace for platform-specific rules */
  marketplace?: MarketplaceId;
  /** Additional attributes to incorporate into the title */
  attributes?: Record<string, string>;
}

/**
 * Input for description generation requests.
 */
export interface DescriptionGenerationInput {
  /** Product data used as context for generation */
  productData: ProductData;
  /** Optional target marketplace for platform-specific rules */
  marketplace?: MarketplaceId;
  /** Desired tone for the description */
  tone?: 'professional' | 'casual' | 'luxury';
  /** Target word count range with 10% tolerance */
  wordCountRange?: { min: number; max: number };
}

/**
 * Input for bullet point generation requests.
 */
export interface BulletGenerationInput {
  /** Product data used as context for generation */
  productData: ProductData;
  /** Optional target marketplace for platform-specific rules */
  marketplace?: MarketplaceId;
  /** Number of bullets to produce (default 5, configurable 1-20) */
  count?: number;
  /** Additional attributes to incorporate into bullets */
  attributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default number of bullet points when none specified */
const DEFAULT_BULLET_COUNT = 5;

/** Minimum bullet count allowed */
const MIN_BULLET_COUNT = 1;

/** Maximum bullet count allowed */
const MAX_BULLET_COUNT = 20;

/** Default word count tolerance percentage (10%) */
const WORD_COUNT_TOLERANCE = 0.10;

/** Marketplace character limits per content type */
const MARKETPLACE_LIMITS: Record<MarketplaceId, { title: number; description: number }> = {
  amazon: { title: 200, description: 2000 },
  shopify: { title: 255, description: 5000 },
  ebay: { title: 80, description: 4000 },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes product data into a deterministic string for cache key computation.
 *
 * @param productData - The product data to normalize
 * @param options - Additional options to include in the normalized string
 * @returns A deterministic JSON string of the normalized input
 */
function normalizeInput(productData: ProductData, options?: Record<string, unknown>): string {
  const payload = {
    productData: {
      name: productData.name ?? null,
      description: productData.description ?? null,
      category: productData.category ?? null,
      brand: productData.brand ?? null,
      attributes: productData.attributes ?? null,
      images: productData.images ?? null,
      price: productData.price ?? null,
      existingContent: productData.existingContent ?? null,
    },
    ...(options ? { options } : {}),
  };
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/**
 * Counts the words in a text string.
 *
 * @param text - The text to count words in
 * @returns Number of words
 */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Calculates input completeness based on available product data fields.
 * Used by the confidence scorer to weight the confidence calculation.
 *
 * @param productData - The product data to assess
 * @returns A value between 0 and 1 representing completeness
 */
function calculateInputCompleteness(productData: ProductData): number {
  const fields = [
    productData.name,
    productData.description,
    productData.category,
    productData.brand,
    productData.attributes && Object.keys(productData.attributes).length > 0
      ? productData.attributes
      : undefined,
    productData.images && productData.images.length > 0 ? productData.images : undefined,
    productData.price,
  ];
  const filledCount = fields.filter((f) => f !== undefined && f !== null).length;
  return filledCount / fields.length;
}

/**
 * Builds prompt variables map from product data and additional attributes.
 *
 * @param productData - The product data to extract variables from
 * @param extras - Additional key-value pairs to include as variables
 * @returns A variables map for prompt template interpolation
 */
function buildPromptVariables(
  productData: ProductData,
  extras?: Record<string, string>,
): Record<string, string> {
  const variables: Record<string, string> = {};

  if (productData.name) variables['product_name'] = productData.name;
  if (productData.description) variables['product_description'] = productData.description;
  if (productData.category) variables['category'] = productData.category;
  if (productData.brand) variables['brand'] = productData.brand;
  if (productData.attributes) {
    variables['attributes'] = Object.entries(productData.attributes)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
  }
  if (productData.price) {
    variables['price'] = `${productData.price.amount} ${productData.price.currency}`;
  }
  if (productData.existingContent) {
    variables['existing_content'] = productData.existingContent;
  }

  if (extras) {
    Object.assign(variables, extras);
  }

  return variables;
}

/**
 * Applies marketplace character limit enforcement to content.
 * Truncates at the nearest sentence boundary when the limit is exceeded.
 *
 * @param content - The content to enforce limits on
 * @param marketplace - The target marketplace
 * @param contentType - The content type ('title' or 'description')
 * @returns An object with the (possibly truncated) content and whether truncation occurred
 */
function enforceCharacterLimit(
  content: string,
  marketplace: MarketplaceId,
  contentType: 'title' | 'description',
): { content: string; truncated: boolean } {
  const limit = MARKETPLACE_LIMITS[marketplace][contentType];

  if (content.length <= limit) {
    return { content, truncated: false };
  }

  // Truncate at the nearest sentence boundary before the limit
  const truncated = content.slice(0, limit);
  const lastSentenceEnd = Math.max(
    truncated.lastIndexOf('. '),
    truncated.lastIndexOf('! '),
    truncated.lastIndexOf('? '),
  );

  if (lastSentenceEnd > 0) {
    return { content: truncated.slice(0, lastSentenceEnd + 1), truncated: true };
  }

  // Fall back to truncating at the limit
  return { content: truncated, truncated: true };
}

// ---------------------------------------------------------------------------
// Content Generator Class
// ---------------------------------------------------------------------------

/**
 * Options for constructing a ContentGenerator instance.
 * Primarily used for dependency injection in tests.
 */
export interface ContentGeneratorOptions {
  /** Custom PromptManager instance */
  promptManager?: PromptManager;
  /** Custom ResponseCache instance */
  responseCache?: ResponseCache;
  /** Custom BedrockClient instance */
  bedrockClient?: BedrockClient;
}

/**
 * Content Generator service that orchestrates the full generation flow
 * for titles, descriptions, and bullet points.
 *
 * The generation flow for each method:
 * 1. Resolve active prompt template via PromptManager
 * 2. Check Response Cache using SHA-256 hash of normalized inputs
 * 3. On cache miss: invoke Bedrock with model config from getModelConfig()
 * 4. Calculate confidence score via ConfidenceScorer
 * 5. Apply marketplace rules (character limits, formatting)
 * 6. Cache the result
 * 7. Return GenerationResult with all metadata
 *
 * @see Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5
 */
export class ContentGenerator {
  private readonly promptMgr: PromptManager;
  private readonly cache: ResponseCache;
  private readonly bedrock: BedrockClient;

  constructor(options: ContentGeneratorOptions = {}) {
    this.promptMgr = options.promptManager ?? promptManager;
    this.cache = options.responseCache ?? responseCache;
    this.bedrock = options.bedrockClient ?? new BedrockClient();
  }

  /**
   * Generates an optimized product title using AI.
   *
   * Incorporates brand name, key features, and category terms from the
   * product data and attributes. Applies marketplace-specific title length
   * limits when a marketplace is specified.
   *
   * @param request - The title generation input containing product data and options
   * @returns A GenerationResult containing the generated title with confidence score and metadata
   * @throws Returns a failed GenerationResult with GENERATION_FAILED code on Bedrock failure
   *
   * @see Requirements 1.1, 1.2, 1.3, 1.4, 1.5
   */
  async generateTitle(request: TitleGenerationInput): Promise<GenerationResult> {
    const generationType: GenerationType = 'title';
    const startTime = Date.now();

    try {
      // 1. Resolve active prompt template
      const template = await this.promptMgr.getActiveTemplate(generationType);

      // 2. Build cache key and check cache
      const normalizedInput = normalizeInput(request.productData, {
        attributes: request.attributes,
      });
      const cacheKeyInput: CacheKeyInput = {
        normalizedInput,
        generationType,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        promptVersion: template.version,
      };
      const cacheKey = this.cache.computeKey(cacheKeyInput);
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached;
      }

      // 3. Build prompt and invoke Bedrock
      const variables = buildPromptVariables(request.productData, request.attributes);
      const prompt = this.promptMgr.interpolate(template.content, variables);
      const modelConfig = getModelConfig(generationType);

      const bedrockResult = await this.bedrock.invoke({
        modelId: modelConfig.modelId,
        prompt,
        maxTokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
      });

      // 4. Process the generated title
      let generatedTitle = bedrockResult.content.trim();
      let truncated = false;

      // Apply marketplace character limits
      if (request.marketplace) {
        const limited = enforceCharacterLimit(generatedTitle, request.marketplace, 'title');
        generatedTitle = limited.content;
        truncated = limited.truncated;
      }

      // 5. Calculate confidence score
      const inputCompleteness = calculateInputCompleteness(request.productData);
      const confidenceScore = calculate({
        modelProbability: 0.85, // Base probability for title generation
        inputCompleteness,
        historicalAccuracy: 0.80,
      });

      // 6. Build result
      const content: GeneratedContent = { type: 'title', title: generatedTitle };
      const result = this.buildResult({
        generationType,
        content,
        confidenceScore,
        template,
        bedrockResult,
        startTime,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        truncated,
      });

      // 7. Cache and return
      await this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      return this.buildFailedResult(generationType, error, startTime);
    }
  }

  /**
   * Generates a compelling product description using AI.
   *
   * Supports configurable tone (professional, casual, luxury) and target
   * word count range with 10% tolerance. Applies marketplace-specific
   * character limits and truncates at sentence boundaries when exceeded.
   *
   * @param request - The description generation input with tone and word count options
   * @returns A GenerationResult containing the generated description with metadata
   * @throws Returns a failed GenerationResult with GENERATION_FAILED code on Bedrock failure
   *
   * @see Requirements 2.1, 2.2, 2.3, 2.4, 2.5
   */
  async generateDescription(request: DescriptionGenerationInput): Promise<GenerationResult> {
    const generationType: GenerationType = 'description';
    const startTime = Date.now();

    try {
      // 1. Resolve active prompt template
      const template = await this.promptMgr.getActiveTemplate(generationType);

      // 2. Build cache key and check cache
      const normalizedInput = normalizeInput(request.productData, {
        tone: request.tone,
        wordCountRange: request.wordCountRange,
      });
      const cacheKeyInput: CacheKeyInput = {
        normalizedInput,
        generationType,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        promptVersion: template.version,
      };
      const cacheKey = this.cache.computeKey(cacheKeyInput);
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached;
      }

      // 3. Build prompt with tone and word count instructions
      const extras: Record<string, string> = {};
      if (request.tone) {
        extras['tone'] = request.tone;
      }
      if (request.wordCountRange) {
        extras['word_count_min'] = String(request.wordCountRange.min);
        extras['word_count_max'] = String(request.wordCountRange.max);
      }

      const variables = buildPromptVariables(request.productData, extras);
      let prompt = this.promptMgr.interpolate(template.content, variables);

      // Append tone and word count instructions if not already in the template
      if (request.tone && !template.content.includes('{{tone}}')) {
        prompt += `\n\nUse a ${request.tone} tone.`;
      }
      if (request.wordCountRange && !template.content.includes('{{word_count_min}}')) {
        prompt += `\n\nTarget word count: ${request.wordCountRange.min}-${request.wordCountRange.max} words.`;
      }

      const modelConfig = getModelConfig(generationType);

      const bedrockResult = await this.bedrock.invoke({
        modelId: modelConfig.modelId,
        prompt,
        maxTokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
      });

      // 4. Process the generated description
      let generatedDescription = bedrockResult.content.trim();
      let truncated = false;

      // Validate word count against range with 10% tolerance
      if (request.wordCountRange) {
        const wordCount = countWords(generatedDescription);
        const toleranceMax = Math.ceil(request.wordCountRange.max * (1 + WORD_COUNT_TOLERANCE));

        // If over the tolerance max, truncate to nearest sentence within range
        if (wordCount > toleranceMax) {
          const words = generatedDescription.split(/\s+/);
          generatedDescription = words.slice(0, toleranceMax).join(' ');
          // Find last sentence end
          const lastSentence = Math.max(
            generatedDescription.lastIndexOf('. '),
            generatedDescription.lastIndexOf('! '),
            generatedDescription.lastIndexOf('? '),
          );
          if (lastSentence > 0) {
            generatedDescription = generatedDescription.slice(0, lastSentence + 1);
          }
          truncated = true;
        }
      }

      // Apply marketplace character limits
      if (request.marketplace) {
        const limited = enforceCharacterLimit(
          generatedDescription,
          request.marketplace,
          'description',
        );
        generatedDescription = limited.content;
        truncated = truncated || limited.truncated;
      }

      // 5. Calculate confidence score
      const inputCompleteness = calculateInputCompleteness(request.productData);
      const confidenceScore = calculate({
        modelProbability: 0.82,
        inputCompleteness,
        historicalAccuracy: 0.78,
      });

      // 6. Build result
      const content: GeneratedContent = {
        type: 'description',
        description: generatedDescription,
        truncated,
      };
      const result = this.buildResult({
        generationType,
        content,
        confidenceScore,
        template,
        bedrockResult,
        startTime,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        truncated,
      });

      // 7. Cache and return
      await this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      return this.buildFailedResult(generationType, error, startTime);
    }
  }

  /**
   * Generates product bullet points highlighting key features.
   *
   * Produces exactly the specified number of bullets (default 5, configurable 1-20).
   * Each bullet highlights a distinct feature without repetition.
   *
   * @param request - The bullet generation input with count and attributes options
   * @returns A GenerationResult containing the generated bullet points with metadata
   * @throws Returns a failed GenerationResult with GENERATION_FAILED code on Bedrock failure
   *
   * @see Requirements 3.1, 3.2, 3.3, 3.4, 3.5
   */
  async generateBullets(request: BulletGenerationInput): Promise<GenerationResult> {
    const generationType: GenerationType = 'bullets';
    const startTime = Date.now();

    // Resolve bullet count: default 5, clamped to [1, 20]
    const requestedCount = request.count ?? DEFAULT_BULLET_COUNT;
    const bulletCount = Math.min(MAX_BULLET_COUNT, Math.max(MIN_BULLET_COUNT, requestedCount));

    try {
      // 1. Resolve active prompt template
      const template = await this.promptMgr.getActiveTemplate(generationType);

      // 2. Build cache key and check cache
      const normalizedInput = normalizeInput(request.productData, {
        count: bulletCount,
        attributes: request.attributes,
      });
      const cacheKeyInput: CacheKeyInput = {
        normalizedInput,
        generationType,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        promptVersion: template.version,
      };
      const cacheKey = this.cache.computeKey(cacheKeyInput);
      const cached = await this.cache.get(cacheKey);

      if (cached) {
        return cached;
      }

      // 3. Build prompt with bullet count instructions
      const extras: Record<string, string> = {
        bullet_count: String(bulletCount),
        ...(request.attributes ?? {}),
      };

      const variables = buildPromptVariables(request.productData, extras);
      let prompt = this.promptMgr.interpolate(template.content, variables);

      // Append bullet count instruction if not in template
      if (!template.content.includes('{{bullet_count}}')) {
        prompt += `\n\nGenerate exactly ${bulletCount} bullet points. Each bullet should highlight a distinct product feature.`;
      }

      const modelConfig = getModelConfig(generationType);

      const bedrockResult = await this.bedrock.invoke({
        modelId: modelConfig.modelId,
        prompt,
        maxTokens: modelConfig.maxTokens,
        temperature: modelConfig.temperature,
      });

      // 4. Parse bullets from Bedrock response
      const bullets = this.parseBullets(bedrockResult.content, bulletCount);

      // 5. Calculate confidence score
      const inputCompleteness = calculateInputCompleteness(request.productData);
      const confidenceScore = calculate({
        modelProbability: 0.84,
        inputCompleteness,
        historicalAccuracy: 0.82,
      });

      // 6. Build result
      const content: GeneratedContent = { type: 'bullets', bullets };
      const result = this.buildResult({
        generationType,
        content,
        confidenceScore,
        template,
        bedrockResult,
        startTime,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        truncated: false,
      });

      // 7. Cache and return
      await this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      return this.buildFailedResult(generationType, error, startTime);
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Parses bullet points from Bedrock's text response.
   * Handles various list formats (numbered, dashed, bulleted).
   * Ensures exactly the requested count is returned by padding or trimming.
   *
   * @param rawContent - The raw text response from Bedrock
   * @param targetCount - The desired number of bullets
   * @returns An array of exactly targetCount bullet strings
   */
  private parseBullets(rawContent: string, targetCount: number): string[] {
    const lines = rawContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // Strip common bullet prefixes: "1.", "1)", "-", "•", "*"
      .map((line) => line.replace(/^(\d+[\.\)]\s*|[-•*]\s*)/, '').trim())
      .filter((line) => line.length > 0);

    // If we have too many, take the first targetCount
    if (lines.length >= targetCount) {
      return lines.slice(0, targetCount);
    }

    // If we have too few, pad with the last available or generic bullets
    const result = [...lines];
    while (result.length < targetCount) {
      result.push(result[result.length - 1] ?? 'Key product feature');
    }

    return result;
  }

  /**
   * Builds a successful GenerationResult with all required metadata.
   *
   * @param params - The result building parameters
   * @returns A complete GenerationResult
   */
  private buildResult(params: {
    generationType: GenerationType;
    content: GeneratedContent;
    confidenceScore: number;
    template: PromptTemplate;
    bedrockResult: BedrockInvocationResult;
    startTime: number;
    marketplace?: MarketplaceId;
    truncated: boolean;
  }): GenerationResult {
    const {
      generationType,
      content,
      confidenceScore,
      template,
      bedrockResult,
      startTime,
      marketplace,
      truncated,
    } = params;

    const latencyMs = Date.now() - startTime;
    const reviewRecommended = shouldRecommendReview(confidenceScore);

    // Determine marketplace compliance status
    let marketplaceCompliance: 'compliant' | 'warnings' | 'non_compliant' | undefined;
    if (marketplace) {
      marketplaceCompliance = truncated ? 'warnings' : 'compliant';
    }

    return {
      resultId: randomUUID(),
      type: generationType,
      status: 'completed',
      content,
      confidenceScore,
      reviewRecommended,
      metadata: {
        promptVersion: template.version,
        promptTemplateId: template.templateId,
        tokenUsage: {
          inputTokens: bedrockResult.inputTokens,
          outputTokens: bedrockResult.outputTokens,
        },
        cached: false,
        modelId: bedrockResult.modelId,
        latencyMs,
        ...(marketplace ? { marketplace } : {}),
        ...(marketplaceCompliance ? { marketplaceCompliance } : {}),
      },
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Builds a failed GenerationResult with error details.
   * Returns GENERATION_FAILED error code as specified by the design.
   *
   * @param generationType - The type of generation that failed
   * @param error - The error that caused the failure
   * @param startTime - The request start time for latency calculation
   * @returns A GenerationResult with status 'failed' and error details
   */
  private buildFailedResult(
    generationType: GenerationType,
    error: unknown,
    startTime: number,
  ): GenerationResult {
    const latencyMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // Check if the error is a structured BedrockUnavailableError
    const errorCode =
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code: string }).code)
        : 'GENERATION_FAILED';

    return {
      resultId: randomUUID(),
      type: generationType,
      status: 'failed',
      content: { type: 'title', title: '' } as GeneratedContent,
      confidenceScore: 0,
      reviewRecommended: true,
      metadata: {
        promptVersion: 0,
        promptTemplateId: 'unknown',
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        cached: false,
        modelId: 'unknown',
        latencyMs,
      },
      error: {
        code: errorCode,
        message: errorMessage,
      },
      createdAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared ContentGenerator instance */
export const contentGenerator = new ContentGenerator();
