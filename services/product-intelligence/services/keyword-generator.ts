/**
 * Keyword Generator service for the Product Intelligence Engine.
 *
 * Generates relevant search keywords and tags for product discoverability
 * using Amazon Bedrock. Categorizes keywords into primary (high relevance),
 * secondary (medium relevance), and long-tail (specific phrases) groups.
 * Identifies gap keywords when competitor keywords are provided, and tailors
 * output to marketplace search algorithm characteristics when a marketplace
 * is specified.
 *
 * @module keyword-generator
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */

import type {
  MarketplaceId,
  ProductData,
  KeywordGenerationResult,
} from '../types/generation.types';
import { BedrockClient } from './bedrock-client';
import { getModelConfig } from './model-config';
import { calculate as calculateConfidence } from './confidence-scorer';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for keyword generation requests.
 */
export interface KeywordGenerationInput {
  /** Product data providing context for keyword generation */
  productData: ProductData;
  /** Optional target marketplace for algorithm-specific keyword tailoring */
  marketplace?: MarketplaceId;
  /** Number of keywords to generate (10-50, defaults to 20) */
  count?: number;
  /** Optional competitor keywords to identify gaps */
  competitorKeywords?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default number of keywords to generate when no count is specified.
 */
const DEFAULT_KEYWORD_COUNT = 20;

/**
 * Minimum allowed keyword count.
 */
const MIN_KEYWORD_COUNT = 10;

/**
 * Maximum allowed keyword count.
 */
const MAX_KEYWORD_COUNT = 50;

/**
 * Default historical accuracy for keyword generation confidence scoring.
 */
const DEFAULT_HISTORICAL_ACCURACY = 0.75;

/**
 * Marketplace-specific search algorithm characteristics used to tailor keywords.
 */
const MARKETPLACE_SEARCH_CHARACTERISTICS: Record<MarketplaceId, string> = {
  amazon: [
    'Focus on backend search terms and indexed keywords.',
    'Prioritize exact-match keywords over broad match.',
    'Include misspelling variations buyers commonly use.',
    'Avoid repeating words already in the product title.',
    'Use single-word and two-word phrases over long sentences.',
    'Do not use competitor brand names or ASINs.',
  ].join(' '),
  shopify: [
    'Focus on long-tail conversational search phrases.',
    'Include natural language queries buyers would type.',
    'Prioritize product tags and collection-friendly terms.',
    'Include seasonal and trending terminology.',
    'Optimize for Google Shopping and organic search.',
  ].join(' '),
  ebay: [
    'Focus on item specifics and category-relevant terms.',
    'Include condition descriptors (new, refurbished, vintage).',
    'Prioritize brand and model number keywords.',
    'Include alternate product names and abbreviations.',
    'Optimize for Cassini search algorithm relevance signals.',
  ].join(' '),
};

// ---------------------------------------------------------------------------
// Keyword Generator Class
// ---------------------------------------------------------------------------

/**
 * Keyword Generator service that uses Amazon Bedrock to produce relevant
 * search keywords for product discoverability.
 *
 * Capabilities:
 * - Generates 10-50 keywords categorized as primary, secondary, or long-tail
 * - Tailors keywords to marketplace search algorithms when marketplace is specified
 * - Identifies gap keywords when competitor keywords are provided
 * - Includes an overall quality score (confidence) for the keyword set
 *
 * Uses Claude 3 Haiku (via `getModelConfig('keywords')`) for list generation
 * due to the low complexity of the task.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
 */
export class KeywordGenerator {
  private readonly bedrockClient: BedrockClient;

  /**
   * Creates a new KeywordGenerator instance.
   *
   * @param bedrockClient - Optional Bedrock client instance for dependency injection (defaults to a new BedrockClient)
   */
  constructor(bedrockClient?: BedrockClient) {
    this.bedrockClient = bedrockClient ?? new BedrockClient();
  }

  /**
   * Generates relevant search keywords for a product using Bedrock.
   *
   * Flow:
   * 1. Clamps the requested keyword count to the [10, 50] range (defaults to 20)
   * 2. Constructs a keyword generation prompt from product data and marketplace context
   * 3. Invokes Bedrock with the 'keywords' model configuration
   * 4. Parses the model response into categorized keywords
   * 5. Identifies gap keywords when competitor keywords are provided
   * 6. Calculates an overall quality score for the keyword set
   *
   * @param request - The keyword generation input containing product data, marketplace, count, and optional competitor keywords
   * @returns A KeywordGenerationResult with categorized keywords, optional gap keywords, and quality score
   * @throws BedrockUnavailableError if Bedrock invocation fails after all retries
   *
   * @see Requirement 9.1 — returns keywords ordered by relevance
   * @see Requirement 9.2 — produces 10-50 keywords (defaults to 20)
   * @see Requirement 9.3 — tailors to marketplace search algorithm
   * @see Requirement 9.4 — categorizes as primary, secondary, long-tail
   * @see Requirement 9.5 — includes confidence score 0-1
   * @see Requirement 9.6 — identifies gap keywords from competitor data
   */
  async generate(request: KeywordGenerationInput): Promise<KeywordGenerationResult> {
    const { productData, marketplace, count, competitorKeywords } = request;

    // Clamp keyword count to valid range
    const targetCount = this.clampCount(count);

    const modelConfig = getModelConfig('keywords');
    const prompt = this.buildPrompt(productData, marketplace, targetCount, competitorKeywords);

    const response = await this.bedrockClient.invoke({
      modelId: modelConfig.modelId,
      prompt,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    });

    // Parse keywords from model response
    const keywords = this.parseKeywordsResponse(response.content, targetCount);

    // Identify gap keywords when competitor keywords are provided
    const gapKeywords = competitorKeywords && competitorKeywords.length > 0
      ? this.identifyGapKeywords(keywords, competitorKeywords)
      : undefined;

    // Calculate overall quality score
    const inputCompleteness = this.calculateInputCompleteness(productData);
    const averageRelevance = keywords.length > 0
      ? keywords.reduce((sum, kw) => sum + kw.relevanceScore, 0) / keywords.length
      : 0;

    const overallQualityScore = calculateConfidence({
      modelProbability: averageRelevance,
      inputCompleteness,
      historicalAccuracy: DEFAULT_HISTORICAL_ACCURACY,
    });

    return {
      keywords,
      ...(gapKeywords !== undefined ? { gapKeywords } : {}),
      overallQualityScore,
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Clamps the keyword count to the valid [10, 50] range.
   * Defaults to 20 when no count is specified.
   *
   * @param count - The requested keyword count (optional)
   * @returns The clamped count within [10, 50]
   */
  private clampCount(count?: number): number {
    if (count === undefined || count === null) {
      return DEFAULT_KEYWORD_COUNT;
    }
    return Math.min(MAX_KEYWORD_COUNT, Math.max(MIN_KEYWORD_COUNT, Math.round(count)));
  }

  /**
   * Builds the keyword generation prompt for Bedrock invocation.
   *
   * Includes product data context, marketplace-specific search characteristics,
   * competitor keywords for gap analysis, and target count.
   *
   * @param productData - Product context for keyword generation
   * @param marketplace - Optional marketplace for tailoring
   * @param targetCount - Number of keywords to generate
   * @param competitorKeywords - Optional competitor keywords for gap analysis
   * @returns The formatted prompt string
   */
  private buildPrompt(
    productData: ProductData,
    marketplace: MarketplaceId | undefined,
    targetCount: number,
    competitorKeywords?: string[],
  ): string {
    const contextParts: string[] = [];

    if (productData.name) {
      contextParts.push(`Product Name: ${productData.name}`);
    }
    if (productData.description) {
      contextParts.push(`Description: ${productData.description}`);
    }
    if (productData.category) {
      contextParts.push(`Category: ${productData.category}`);
    }
    if (productData.brand) {
      contextParts.push(`Brand: ${productData.brand}`);
    }
    if (productData.attributes) {
      contextParts.push(`Attributes: ${JSON.stringify(productData.attributes)}`);
    }
    if (productData.price) {
      contextParts.push(`Price: ${productData.price.amount} ${productData.price.currency}`);
    }

    const marketplaceSection = marketplace
      ? `\n\nTarget Marketplace: ${marketplace}\nSearch Algorithm Guidelines: ${MARKETPLACE_SEARCH_CHARACTERISTICS[marketplace]}`
      : '';

    const competitorSection = competitorKeywords && competitorKeywords.length > 0
      ? `\n\nCompetitor Keywords (identify gaps — keywords they use that this product should also target):\n${competitorKeywords.join(', ')}`
      : '';

    return `Generate exactly ${targetCount} highly relevant search keywords for the following product. Categorize each keyword by relevance:

- "primary": Core product terms with highest search relevance (aim for ~30% of keywords)
- "secondary": Related terms with medium relevance (aim for ~40% of keywords)
- "long-tail": Specific multi-word phrases for niche search queries (aim for ~30% of keywords)

Product Information:
${contextParts.join('\n')}${marketplaceSection}${competitorSection}

Requirements:
1. Generate exactly ${targetCount} keywords
2. Order by relevance (most relevant first within each category)
3. Each keyword should be unique
4. Include a relevance score between 0.0 and 1.0 for each keyword
5. Primary keywords should have relevance >= 0.7
6. Secondary keywords should have relevance between 0.4 and 0.7
7. Long-tail keywords should have relevance between 0.2 and 0.5${competitorKeywords && competitorKeywords.length > 0 ? '\n8. Identify keywords from the competitor list that are relevant but missing from the product\'s current positioning' : ''}

Respond ONLY with a JSON object in this exact format:
{
  "keywords": [
    {"term": "keyword phrase", "category": "primary", "relevanceScore": 0.95}
  ]${competitorKeywords && competitorKeywords.length > 0 ? ',\n  "gapKeywords": ["competitor keyword 1", "competitor keyword 2"]' : ''}
}`;
  }

  /**
   * Parses the Bedrock model response into categorized keyword entries.
   *
   * Extracts the JSON object from the response, validates each keyword entry,
   * and ensures relevance scores are clamped to [0, 1].
   *
   * @param content - The raw model response content
   * @param targetCount - The expected number of keywords
   * @returns Array of keyword entries with term, category, and relevanceScore
   */
  private parseKeywordsResponse(
    content: string,
    targetCount: number,
  ): KeywordGenerationResult['keywords'] {
    try {
      // Strip markdown code blocks if present
      let cleaned = content.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

      // Try to find a JSON object in the response
      const objectMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!objectMatch) {
        return [];
      }

      const parsed = JSON.parse(objectMatch[0]);

      if (!parsed || typeof parsed !== 'object') {
        return [];
      }

      const keywordsArray = parsed.keywords;
      if (!Array.isArray(keywordsArray)) {
        return [];
      }

      const keywords = keywordsArray
        .filter((item: unknown): item is Record<string, unknown> =>
          item !== null && typeof item === 'object',
        )
        .filter((item) =>
          typeof item['term'] === 'string' &&
          item['term'].length > 0 &&
          (item['category'] === 'primary' || item['category'] === 'secondary' || item['category'] === 'long-tail') &&
          typeof item['relevanceScore'] === 'number',
        )
        .map((item) => ({
          term: (item['term'] as string).trim(),
          category: item['category'] as 'primary' | 'secondary' | 'long-tail',
          relevanceScore: Math.min(1.0, Math.max(0.0, item['relevanceScore'] as number)),
        }));

      // Sort by relevance score descending (ordered by estimated relevance per Requirement 9.1)
      keywords.sort((a, b) => b.relevanceScore - a.relevanceScore);

      // Limit to target count
      return keywords.slice(0, targetCount);
    } catch {
      // If JSON parsing fails, return empty keywords
      return [];
    }
  }

  /**
   * Identifies gap keywords — terms used by competitors but not present
   * in the generated keyword set.
   *
   * Compares competitor keywords against the generated keywords and returns
   * those that are relevant but missing from the product's keyword set.
   *
   * @param generatedKeywords - The keywords generated for the product
   * @param competitorKeywords - Competitor keyword list to compare against
   * @returns Array of gap keywords not found in the generated set
   *
   * @see Requirement 9.6 — identifies gaps and suggests differentiating keywords
   */
  private identifyGapKeywords(
    generatedKeywords: KeywordGenerationResult['keywords'],
    competitorKeywords: string[],
  ): string[] {
    const generatedTermsLower = new Set(
      generatedKeywords.map((kw) => kw.term.toLowerCase().trim()),
    );

    return competitorKeywords.filter((competitorKw) => {
      const normalized = competitorKw.toLowerCase().trim();
      return normalized.length > 0 && !generatedTermsLower.has(normalized);
    });
  }

  /**
   * Calculates input completeness score for confidence scoring.
   *
   * Measures how much product context data is available for keyword generation.
   * More context leads to better keyword quality.
   *
   * @param productData - The product data context
   * @returns A value between 0 and 1 representing input completeness
   */
  private calculateInputCompleteness(productData: ProductData): number {
    let score = 0;
    const maxFields = 6;

    if (productData.name) score += 1;
    if (productData.description) score += 1;
    if (productData.category) score += 1;
    if (productData.brand) score += 1;
    if (productData.attributes && Object.keys(productData.attributes).length > 0) score += 1;
    if (productData.price) score += 1;

    return score / maxFields;
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared KeywordGenerator instance */
export const keywordGenerator = new KeywordGenerator();
