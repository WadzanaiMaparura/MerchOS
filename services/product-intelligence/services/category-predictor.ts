/**
 * Category Predictor service for the Product Intelligence Engine.
 *
 * Classifies products into marketplace taxonomy categories using Amazon Bedrock
 * (Claude) inference. Returns ranked category predictions with confidence scores,
 * full breadcrumb paths, and flags for manual review when confidence is low.
 *
 * @module category-predictor
 */

import type {
  CategoryPredictionResult,
  MarketplaceId,
  ProductData,
} from '../types/generation.types';
import { BedrockClient, type BedrockInvocationParams } from './bedrock-client';
import { getModelConfig } from './model-config';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for category prediction requests.
 */
export interface CategoryPredictionInput {
  /** Product data used to classify the product into categories */
  productData: ProductData;
  /** Optional target marketplace for taxonomy mapping */
  marketplace?: MarketplaceId;
}

/**
 * Raw prediction parsed from the Bedrock model response.
 */
interface RawPrediction {
  categoryId: string;
  categoryPath: string[];
  confidenceScore: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Threshold below which manual classification is recommended */
const MANUAL_REVIEW_THRESHOLD = 0.3;

/** Minimum number of predictions to return */
const MIN_PREDICTIONS = 3;

// ---------------------------------------------------------------------------
// Marketplace Taxonomy Mappings
// ---------------------------------------------------------------------------

/**
 * Marketplace taxonomy prefix mappings.
 * When a marketplace is specified, category IDs are prefixed with the
 * marketplace taxonomy namespace.
 */
const MARKETPLACE_TAXONOMY_PREFIX: Record<MarketplaceId, string> = {
  amazon: 'amzn',
  shopify: 'shpfy',
  ebay: 'ebay',
};

// ---------------------------------------------------------------------------
// Prompt Construction
// ---------------------------------------------------------------------------

/**
 * Builds the classification prompt for Bedrock based on product data
 * and optional marketplace targeting.
 *
 * @param input - The category prediction input
 * @returns The prompt string for Bedrock invocation
 */
function buildCategoryPrompt(input: CategoryPredictionInput): string {
  const { productData, marketplace } = input;

  const productContext = [
    productData.name ? `Product Name: ${productData.name}` : '',
    productData.description ? `Description: ${productData.description}` : '',
    productData.category ? `Existing Category: ${productData.category}` : '',
    productData.brand ? `Brand: ${productData.brand}` : '',
    productData.attributes
      ? `Attributes: ${JSON.stringify(productData.attributes)}`
      : '',
    productData.price
      ? `Price: ${productData.price.amount} ${productData.price.currency}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const marketplaceInstruction = marketplace
    ? `\nMap all category predictions to the ${marketplace} marketplace taxonomy. Use the "${MARKETPLACE_TAXONOMY_PREFIX[marketplace]}" prefix for category IDs.`
    : '';

  return `You are a product classification expert. Classify the following product into the most appropriate categories.

${productContext}
${marketplaceInstruction}

Return your response as valid JSON with the following structure:
{
  "predictions": [
    {
      "categoryId": "string (unique category identifier)",
      "categoryPath": ["Level 1", "Level 2", "Level 3"],
      "confidenceScore": number between 0 and 1
    }
  ]
}

Requirements:
- Return at least ${MIN_PREDICTIONS} category predictions
- Sort predictions by confidenceScore descending (highest first)
- Each categoryPath must be a full breadcrumb from root to leaf category
- Confidence scores must reflect how well the product fits each category
- Be precise: use real, specific categories (not generic ones)

Return ONLY the JSON object, no additional text.`;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parses the raw Bedrock response text into structured predictions.
 * Handles malformed responses gracefully by returning empty predictions.
 *
 * @param responseText - The raw text from Bedrock model invocation
 * @returns Parsed array of raw predictions
 */
function parseBedrockResponse(responseText: string): RawPrediction[] {
  try {
    // Strip any markdown code fences if present
    const cleaned = responseText
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    const predictions = parsed.predictions ?? parsed;

    if (!Array.isArray(predictions)) {
      return [];
    }

    return predictions
      .filter(
        (p: unknown): p is RawPrediction =>
          typeof p === 'object' &&
          p !== null &&
          'categoryId' in p &&
          'categoryPath' in p &&
          'confidenceScore' in p &&
          typeof (p as RawPrediction).categoryId === 'string' &&
          Array.isArray((p as RawPrediction).categoryPath) &&
          typeof (p as RawPrediction).confidenceScore === 'number',
      )
      .map((p) => ({
        categoryId: p.categoryId,
        categoryPath: p.categoryPath.map(String),
        confidenceScore: Math.min(1, Math.max(0, p.confidenceScore)),
      }));
  } catch {
    return [];
  }
}

/**
 * Ensures the predictions array has at least MIN_PREDICTIONS entries.
 * If fewer are returned from the model, pads with low-confidence fallback entries.
 *
 * @param predictions - The parsed predictions
 * @param marketplace - Optional marketplace for taxonomy prefix
 * @returns Predictions array with at least MIN_PREDICTIONS entries
 */
function ensureMinimumPredictions(
  predictions: RawPrediction[],
  marketplace?: MarketplaceId,
): RawPrediction[] {
  if (predictions.length >= MIN_PREDICTIONS) {
    return predictions;
  }

  const prefix = marketplace ? `${MARKETPLACE_TAXONOMY_PREFIX[marketplace]}-` : '';
  const fallbacks: RawPrediction[] = [];
  const needed = MIN_PREDICTIONS - predictions.length;

  for (let i = 0; i < needed; i++) {
    fallbacks.push({
      categoryId: `${prefix}uncategorized-${i + 1}`,
      categoryPath: ['Uncategorized'],
      confidenceScore: 0.1,
    });
  }

  return [...predictions, ...fallbacks];
}

/**
 * Sorts predictions by confidence score in descending order.
 *
 * Property 15: The predictions array is sorted by confidence score descending.
 *
 * @param predictions - The predictions to sort
 * @returns Sorted predictions array
 */
function sortByConfidenceDescending(predictions: RawPrediction[]): RawPrediction[] {
  return [...predictions].sort((a, b) => b.confidenceScore - a.confidenceScore);
}

/**
 * Maps category IDs to marketplace-specific taxonomy when a marketplace is specified.
 *
 * @param predictions - The predictions to map
 * @param marketplace - The target marketplace
 * @returns Predictions with marketplace-prefixed category IDs
 */
function mapToMarketplaceTaxonomy(
  predictions: RawPrediction[],
  marketplace?: MarketplaceId,
): RawPrediction[] {
  if (!marketplace) {
    return predictions;
  }

  const prefix = MARKETPLACE_TAXONOMY_PREFIX[marketplace];

  return predictions.map((p) => ({
    ...p,
    categoryId: p.categoryId.startsWith(prefix)
      ? p.categoryId
      : `${prefix}-${p.categoryId}`,
  }));
}

// ---------------------------------------------------------------------------
// Category Predictor Class
// ---------------------------------------------------------------------------

/**
 * Category Predictor service that classifies products into marketplace
 * taxonomy categories using Bedrock AI inference.
 *
 * Guarantees:
 * - Returns at least 3 predictions (Property 15)
 * - Predictions sorted by confidence descending (Property 15)
 * - Includes full category path breadcrumbs (Requirement 5.4)
 * - Flags manual review when all scores < 0.3 (Requirement 5.5)
 * - Maps to marketplace taxonomy when specified (Requirement 5.3)
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export class CategoryPredictor {
  private readonly bedrockClient: BedrockClient;

  /**
   * Creates a new CategoryPredictor instance.
   *
   * @param bedrockClient - Optional Bedrock client instance (defaults to new BedrockClient)
   */
  constructor(bedrockClient?: BedrockClient) {
    this.bedrockClient = bedrockClient ?? new BedrockClient();
  }

  /**
   * Predicts category classifications for a product.
   *
   * Invokes Bedrock with the product data to classify into categories,
   * then processes the response to ensure:
   * 1. At least 3 predictions are returned
   * 2. Predictions are sorted by confidence descending
   * 3. Full breadcrumb paths are included
   * 4. Manual review is flagged when all scores < 0.3
   * 5. Category IDs are mapped to marketplace taxonomy when specified
   *
   * @param request - The category prediction input with product data and optional marketplace
   * @returns The category prediction result with ranked predictions and review flag
   * @throws BedrockUnavailableError if Bedrock invocation fails after all retries
   *
   * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.5
   */
  async predict(request: CategoryPredictionInput): Promise<CategoryPredictionResult> {
    const { marketplace } = request;
    const modelConfig = getModelConfig('category');

    // Build the classification prompt
    const prompt = buildCategoryPrompt(request);

    // Invoke Bedrock with model configuration for category tasks
    const invocationParams: BedrockInvocationParams = {
      modelId: modelConfig.modelId,
      prompt,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    };

    const bedrockResult = await this.bedrockClient.invoke(invocationParams);

    // Parse the model response into structured predictions
    let predictions = parseBedrockResponse(bedrockResult.content);

    // Ensure minimum number of predictions
    predictions = ensureMinimumPredictions(predictions, marketplace);

    // Map to marketplace taxonomy if specified
    predictions = mapToMarketplaceTaxonomy(predictions, marketplace);

    // Sort by confidence descending (Property 15)
    predictions = sortByConfidenceDescending(predictions);

    // Determine if manual review is recommended (all scores < 0.3)
    const manualReviewRecommended = predictions.every(
      (p) => p.confidenceScore < MANUAL_REVIEW_THRESHOLD,
    );

    return {
      predictions: predictions.map((p) => ({
        categoryId: p.categoryId,
        categoryPath: p.categoryPath,
        confidenceScore: p.confidenceScore,
      })),
      manualReviewRecommended,
    };
  }
}

// ---------------------------------------------------------------------------
// Exported Utilities (for testing)
// ---------------------------------------------------------------------------

export {
  buildCategoryPrompt,
  parseBedrockResponse,
  ensureMinimumPredictions,
  sortByConfidenceDescending,
  mapToMarketplaceTaxonomy,
  MANUAL_REVIEW_THRESHOLD,
  MIN_PREDICTIONS,
};

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared CategoryPredictor instance */
export const categoryPredictor = new CategoryPredictor();
