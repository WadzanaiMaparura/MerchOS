/**
 * SEO Optimizer service for the Product Intelligence Engine.
 *
 * Analyzes and optimizes product content for search engine visibility.
 * Calculates keyword density, detects keyword stuffing, generates meta
 * descriptions, and applies marketplace-specific SEO guidelines via
 * Amazon Bedrock (Claude) for AI-powered analysis.
 *
 * @module seo-optimizer
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import type {
  MarketplaceId,
  ProductData,
  SEOAnalysisResult,
} from '../types/generation.types';
import { BedrockClient } from './bedrock-client';
import type { BedrockInvocationResult } from './bedrock-client';
import { getModelConfig } from './model-config';
import { calculate as calculateConfidence } from './confidence-scorer';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input parameters for SEO analysis.
 */
export interface SEOAnalysisInput {
  /** The content to analyze and optimize for SEO */
  content: string;
  /** Product data used as context for analysis */
  productData: ProductData;
  /** Optional target marketplace for platform-specific SEO guidelines */
  marketplace?: MarketplaceId;
  /** Whether to generate a meta description (defaults to true) */
  generateMetaDescription?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Keyword stuffing threshold: density above 3% is flagged */
const KEYWORD_STUFFING_THRESHOLD = 3;

/** Maximum meta description length in characters */
const META_DESCRIPTION_MAX_LENGTH = 155;

/**
 * Marketplace-specific SEO guidelines applied during analysis.
 * Each marketplace has different search algorithm characteristics.
 */
const MARKETPLACE_SEO_GUIDELINES: Record<MarketplaceId, string> = {
  amazon:
    'Amazon A9 algorithm: prioritize backend keywords, avoid keyword repetition across fields, ' +
    'use all available search term slots, focus on product relevance and conversion rate. ' +
    'Front-load important keywords in titles. Avoid special characters in search terms.',
  shopify:
    'Shopify SEO: optimize for Google search, use natural language keywords, ' +
    'focus on long-tail keywords, include alt text descriptions for images, ' +
    'use structured data markup-friendly content. Meta descriptions should include a call to action.',
  ebay:
    'eBay Cassini search: item specifics are critical for ranking, ' +
    'include category-relevant keywords, avoid unnecessary filler words, ' +
    'front-load titles with most important keywords. Use all 80 characters for titles.',
};

// ---------------------------------------------------------------------------
// SEO Optimizer Class
// ---------------------------------------------------------------------------

/**
 * SEO Optimizer service that analyzes and optimizes product content
 * for search engine visibility using Amazon Bedrock.
 *
 * Capabilities:
 * - Keyword density calculation as percentage of total word count
 * - Keyword stuffing detection when density exceeds 3% for any single keyword
 * - AI-powered meta description generation (≤ 155 characters)
 * - Marketplace-specific SEO guidelines application
 * - Content optimization suggestions via Bedrock
 *
 * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */
export class SEOOptimizer {
  private readonly bedrockClient: BedrockClient;

  /**
   * Creates a new SEOOptimizer instance.
   *
   * @param bedrockClient - Optional BedrockClient instance for dependency injection (testing)
   */
  constructor(bedrockClient?: BedrockClient) {
    this.bedrockClient = bedrockClient ?? new BedrockClient();
  }

  /**
   * Analyzes content for SEO quality and returns optimization suggestions.
   *
   * Flow:
   * 1. Extract keywords from content via Bedrock
   * 2. Calculate keyword density locally as (occurrences / total words) * 100
   * 3. Flag keywords exceeding 3% density as keyword stuffing
   * 4. Generate optimized content with SEO improvements via Bedrock
   * 5. Optionally generate meta description (≤ 155 characters)
   * 6. Apply marketplace-specific SEO guidelines when marketplace specified
   *
   * @param request - The SEO analysis input containing content and options
   * @returns SEO analysis result with density metrics, suggestions, and optimized content
   * @throws BedrockUnavailableError if Bedrock invocation fails after retries
   *
   * @see Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
   */
  async analyze(request: SEOAnalysisInput): Promise<SEOAnalysisResult> {
    const { content, productData, marketplace, generateMetaDescription } = request;
    const shouldGenerateMetaDescription = generateMetaDescription !== false;

    const modelConfig = getModelConfig('seo');

    // Build the prompt for Bedrock analysis
    const prompt = this.buildAnalysisPrompt(
      content,
      productData,
      marketplace,
      shouldGenerateMetaDescription,
    );

    // Invoke Bedrock for AI-powered SEO analysis
    const bedrockResult: BedrockInvocationResult = await this.bedrockClient.invoke({
      modelId: modelConfig.modelId,
      prompt,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    });

    // Parse the Bedrock response
    const aiAnalysis = this.parseBedrockResponse(bedrockResult.content);

    // Calculate keyword density locally for accuracy
    const keywordDensity = calculateKeywordDensity(content, aiAnalysis.keywords);

    // Flag keyword stuffing (density > 3%)
    const keywordStuffingFlags = detectKeywordStuffing(keywordDensity);

    // Generate meta description (ensure ≤ 155 characters)
    let metaDescription: string | undefined;
    if (shouldGenerateMetaDescription && aiAnalysis.metaDescription !== null) {
      metaDescription = truncateMetaDescription(aiAnalysis.metaDescription);
    }

    // Calculate confidence score
    const inputCompleteness = this.calculateInputCompleteness(productData);
    const confidenceScore = calculateConfidence({
      modelProbability: 0.8, // Default model probability for SEO analysis
      inputCompleteness,
      historicalAccuracy: 0.75, // Default historical accuracy
    });

    const result: SEOAnalysisResult = {
      keywordDensity,
      suggestions: aiAnalysis.suggestions,
      optimizedContent: aiAnalysis.optimizedContent || content,
      keywordStuffingFlags,
      confidenceScore,
    };

    if (metaDescription !== undefined) {
      result.metaDescription = metaDescription;
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Private Methods
  // -------------------------------------------------------------------------

  /**
   * Builds the Bedrock prompt for SEO analysis.
   *
   * @param content - The content to analyze
   * @param productData - Product context for analysis
   * @param marketplace - Optional marketplace for specific guidelines
   * @param generateMetaDescription - Whether to request meta description generation
   * @returns The formatted prompt string
   */
  private buildAnalysisPrompt(
    content: string,
    productData: ProductData,
    marketplace?: MarketplaceId,
    generateMetaDescription?: boolean,
  ): string {
    const marketplaceGuidelines = marketplace
      ? `\n\nMarketplace-specific SEO guidelines:\n${MARKETPLACE_SEO_GUIDELINES[marketplace]}`
      : '';

    const productContext = [
      productData.name ? `Product name: ${productData.name}` : '',
      productData.category ? `Category: ${productData.category}` : '',
      productData.brand ? `Brand: ${productData.brand}` : '',
      productData.attributes
        ? `Attributes: ${JSON.stringify(productData.attributes)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    const metaDescriptionInstruction = generateMetaDescription
      ? '\n4. Generate a meta description that is 155 characters or fewer, summarizing the product for search results.'
      : '';

    return `You are an SEO optimization expert for e-commerce product listings. Analyze the following product content and provide SEO recommendations.

Product context:
${productContext}

Content to analyze:
${content}
${marketplaceGuidelines}

Respond in the following JSON format:
{
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "suggestions": ["suggestion1", "suggestion2"],
  "optimizedContent": "improved version of the content with better SEO"${generateMetaDescription ? ',\n  "metaDescription": "concise meta description for search results"' : ''}
}

Instructions:
1. Extract the most relevant SEO keywords from the content (5-15 keywords).
2. Provide specific, actionable suggestions to improve the content's search visibility.
3. Rewrite the content with improved keyword placement and SEO best practices.${metaDescriptionInstruction}

Important:
- Suggestions should be specific and actionable.
- The optimized content should read naturally while incorporating keywords.
- Focus on search relevance and user intent.
- Return ONLY valid JSON, no additional text.`;
  }

  /**
   * Parses the Bedrock AI response into structured analysis data.
   *
   * @param responseContent - The raw text response from Bedrock
   * @returns Parsed analysis with keywords, suggestions, optimized content, and meta description
   */
  private parseBedrockResponse(responseContent: string): {
    keywords: string[];
    suggestions: string[];
    optimizedContent: string;
    metaDescription: string | null;
  } {
    try {
      // Try to extract JSON from the response (handle potential markdown wrapping)
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getDefaultAnalysis();
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        keywords?: unknown;
        suggestions?: unknown;
        optimizedContent?: unknown;
        metaDescription?: unknown;
      };

      return {
        keywords: Array.isArray(parsed.keywords)
          ? (parsed.keywords as string[]).filter((k) => typeof k === 'string')
          : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? (parsed.suggestions as string[]).filter((s) => typeof s === 'string')
          : [],
        optimizedContent:
          typeof parsed.optimizedContent === 'string'
            ? parsed.optimizedContent
            : '',
        metaDescription:
          typeof parsed.metaDescription === 'string'
            ? parsed.metaDescription
            : null,
      };
    } catch {
      return this.getDefaultAnalysis();
    }
  }

  /**
   * Returns a default analysis result when Bedrock response parsing fails.
   */
  private getDefaultAnalysis(): {
    keywords: string[];
    suggestions: string[];
    optimizedContent: string;
    metaDescription: null;
  } {
    return {
      keywords: [],
      suggestions: ['Unable to parse AI response. Please try again.'],
      optimizedContent: '',
      metaDescription: null,
    };
  }

  /**
   * Calculates input completeness based on available product data fields.
   * Used as a factor in confidence score calculation.
   *
   * @param productData - The product data to assess
   * @returns A value between 0 and 1 representing completeness
   */
  private calculateInputCompleteness(productData: ProductData): number {
    const fields = [
      productData.name,
      productData.description,
      productData.category,
      productData.brand,
      productData.attributes && Object.keys(productData.attributes).length > 0,
    ];

    const filledFields = fields.filter(Boolean).length;
    return filledFields / fields.length;
  }
}

// ---------------------------------------------------------------------------
// Pure Utility Functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Calculates keyword density for each keyword as a percentage of total word count.
 *
 * Formula: (keyword occurrences / total words) * 100
 *
 * Keywords are matched case-insensitively. Multi-word keywords are counted
 * as a single occurrence when all words appear consecutively.
 *
 * Property 13: Keywords with density > 3% will be flagged as stuffing.
 *
 * @param content - The text content to analyze
 * @param keywords - The keywords to calculate density for
 * @returns A record mapping each keyword to its density percentage
 *
 * @see Requirement 4.2
 */
export function calculateKeywordDensity(
  content: string,
  keywords: string[],
): Record<string, number> {
  if (!content || keywords.length === 0) {
    return {};
  }

  const normalizedContent = content.toLowerCase();
  const words = normalizedContent.split(/\s+/).filter((w) => w.length > 0);
  const totalWords = words.length;

  if (totalWords === 0) {
    return {};
  }

  const density: Record<string, number> = {};

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase().trim();
    if (!normalizedKeyword) continue;

    // Count occurrences of the keyword in the content
    const occurrences = countKeywordOccurrences(normalizedContent, normalizedKeyword);

    // Density = (occurrences / total words) * 100
    density[keyword] = (occurrences / totalWords) * 100;
  }

  return density;
}

/**
 * Counts occurrences of a keyword in content.
 * Supports multi-word keywords by matching consecutive sequences.
 *
 * @param normalizedContent - The lowercase content to search
 * @param normalizedKeyword - The lowercase keyword to count
 * @returns The number of occurrences
 */
export function countKeywordOccurrences(
  normalizedContent: string,
  normalizedKeyword: string,
): number {
  // Use word boundary matching for accurate counting
  const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'gi');
  const matches = normalizedContent.match(regex);
  return matches ? matches.length : 0;
}

/**
 * Detects keyword stuffing by identifying keywords with density above 3%.
 *
 * Property 13: A keyword with density > 3% is flagged as stuffed.
 * Keywords at or below 3% density are NOT flagged.
 *
 * @param keywordDensity - The keyword density map (keyword → percentage)
 * @returns Array of flagged keywords with their density values
 *
 * @see Requirement 4.6
 */
export function detectKeywordStuffing(
  keywordDensity: Record<string, number>,
): { keyword: string; density: number }[] {
  const flags: { keyword: string; density: number }[] = [];

  for (const [keyword, density] of Object.entries(keywordDensity)) {
    if (density > KEYWORD_STUFFING_THRESHOLD) {
      flags.push({ keyword, density });
    }
  }

  return flags;
}

/**
 * Truncates a meta description to 155 characters or fewer.
 *
 * If the description exceeds 155 characters, it is truncated at the last
 * complete word boundary that fits within the limit, with an ellipsis appended.
 *
 * Property 14: The resulting meta description is always ≤ 155 characters.
 *
 * @param description - The raw meta description text
 * @returns The meta description truncated to 155 characters or fewer
 *
 * @see Requirement 4.4
 */
export function truncateMetaDescription(description: string): string {
  if (description.length <= META_DESCRIPTION_MAX_LENGTH) {
    return description;
  }

  // Reserve space for ellipsis (3 characters)
  const maxLength = META_DESCRIPTION_MAX_LENGTH - 3;
  const truncated = description.slice(0, maxLength);

  // Find the last word boundary
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + '...';
  }

  // No space found — truncate hard
  return truncated + '...';
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared SEOOptimizer instance */
export const seoOptimizer = new SEOOptimizer();
