/**
 * Brand Detector service for the Product Intelligence Engine.
 *
 * Identifies and validates brand names from unstructured product data using
 * Amazon Bedrock. Differentiates between primary brands and sub-brands,
 * validates against a known brand registry when provided, and flags
 * unidentified products when no brand achieves confidence above 0.5.
 *
 * @module brand-detector
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import type { ProductData, BrandDetectionResult } from '../types/generation.types';
import { BedrockClient } from './bedrock-client';
import { getModelConfig } from './model-config';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for brand detection operations.
 */
export interface BrandDetectionInput {
  /** Unstructured text to analyze for brand mentions */
  text: string;
  /** Product data providing additional context for brand identification */
  productData: ProductData;
  /** Optional list of known brands to validate detections against */
  brandRegistry?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Confidence threshold below which a brand detection result is flagged as unidentified.
 */
const UNIDENTIFIED_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Brand Detector Class
// ---------------------------------------------------------------------------

/**
 * Brand Detector service that uses Amazon Bedrock to identify brand names
 * from unstructured product data.
 *
 * Capabilities:
 * - Identifies primary brands and sub-brands from text
 * - Validates detected brands against an optional known brand registry
 * - Flags unrecognized brands not found in the registry
 * - Sets `unidentified: true` when no brand scores above 0.5
 *
 * Uses Claude 3 Haiku (via `getModelConfig('brand')`) for entity extraction
 * due to the low complexity of the task.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */
export class BrandDetector {
  private readonly bedrockClient: BedrockClient;

  /**
   * Creates a new BrandDetector instance.
   *
   * @param bedrockClient - Optional Bedrock client instance (defaults to a new BedrockClient)
   */
  constructor(bedrockClient?: BedrockClient) {
    this.bedrockClient = bedrockClient ?? new BedrockClient();
  }

  /**
   * Detects brands from the provided text and product data using Bedrock.
   *
   * Flow:
   * 1. Constructs a brand detection prompt from the input text and product data
   * 2. Invokes Bedrock with the 'brand' model configuration
   * 3. Parses the model response into structured brand detections
   * 4. Differentiates primary brands from sub-brands
   * 5. Validates detected brands against the registry (if provided)
   * 6. Flags the result as unidentified if no brand exceeds the confidence threshold
   *
   * @param request - The brand detection input containing text, product data, and optional registry
   * @returns A BrandDetectionResult with detected brands, validation status, and identification flag
   * @throws BedrockUnavailableError if Bedrock invocation fails after all retries
   *
   * @see Requirement 6.1 — identifies brand names with confidence scores
   * @see Requirement 6.2 — differentiates primary vs sub-brands
   * @see Requirement 6.3 — validates against known brand registry
   * @see Requirement 6.4 — includes confidence scores 0-1
   * @see Requirement 6.5 — flags unidentified when no brand > 0.5
   */
  async detect(request: BrandDetectionInput): Promise<BrandDetectionResult> {
    const { text, productData, brandRegistry } = request;

    const modelConfig = getModelConfig('brand');
    const prompt = this.buildPrompt(text, productData, brandRegistry);

    const response = await this.bedrockClient.invoke({
      modelId: modelConfig.modelId,
      prompt,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    });

    const brands = this.parseResponse(response.content, brandRegistry);

    const unidentified = brands.every(
      (brand) => brand.confidenceScore <= UNIDENTIFIED_THRESHOLD,
    );

    return {
      brands,
      unidentified: brands.length === 0 || unidentified,
    };
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Builds the brand detection prompt for Bedrock invocation.
   *
   * Includes text content, product data context, and optionally the brand
   * registry for validation instructions.
   *
   * @param text - The text to analyze for brand mentions
   * @param productData - Product context for improved detection accuracy
   * @param brandRegistry - Optional list of known brands for validation
   * @returns The formatted prompt string
   */
  private buildPrompt(
    text: string,
    productData: ProductData,
    brandRegistry?: string[],
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
      contextParts.push(`Listed Brand: ${productData.brand}`);
    }
    if (productData.attributes) {
      contextParts.push(`Attributes: ${JSON.stringify(productData.attributes)}`);
    }

    const registrySection = brandRegistry && brandRegistry.length > 0
      ? `\n\nKnown Brand Registry:\n${brandRegistry.join(', ')}\n\nValidate detected brands against this registry. Mark brands found in the registry as "registryValidated": true.`
      : '';

    return `Analyze the following product text and identify all brand names mentioned. For each brand, determine:
1. The brand name
2. Whether it is the primary brand or a sub-brand (e.g., "Nike" is primary, "Nike Air Max" sub-brand of Nike)
3. Your confidence in the detection (0.0 to 1.0)

Product Text:
${text}

Product Context:
${contextParts.join('\n')}${registrySection}

Respond ONLY with a JSON array of objects with these fields:
- "name": string (the brand name)
- "type": "primary" | "sub-brand"
- "confidenceScore": number (0.0 to 1.0)

Example response format:
[{"name": "Nike", "type": "primary", "confidenceScore": 0.95}, {"name": "Air Jordan", "type": "sub-brand", "confidenceScore": 0.88}]

If no brands are detected, respond with an empty array: []`;
  }

  /**
   * Parses the Bedrock model response into structured brand detection results.
   *
   * Extracts the JSON array from the response content, validates each entry,
   * and enriches with registry validation status.
   *
   * @param content - The raw model response content
   * @param brandRegistry - Optional brand registry for validation
   * @returns Array of brand detection entries
   */
  private parseResponse(
    content: string,
    brandRegistry?: string[],
  ): BrandDetectionResult['brands'] {
    try {
      // Extract JSON array from response (handle cases where model includes extra text)
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const parsed: unknown[] = JSON.parse(jsonMatch[0]);

      if (!Array.isArray(parsed)) {
        return [];
      }

      const registryLower = brandRegistry?.map((b) => b.toLowerCase()) ?? [];
      const hasRegistry = brandRegistry !== undefined && brandRegistry.length > 0;

      return parsed
        .filter((item): item is Record<string, unknown> =>
          item !== null && typeof item === 'object',
        )
        .filter((item) =>
          typeof item['name'] === 'string' &&
          (item['type'] === 'primary' || item['type'] === 'sub-brand') &&
          typeof item['confidenceScore'] === 'number',
        )
        .map((item) => {
          const name = item['name'] as string;
          const type = item['type'] as 'primary' | 'sub-brand';
          const confidenceScore = Math.min(1.0, Math.max(0.0, item['confidenceScore'] as number));

          if (hasRegistry) {
            const isInRegistry = registryLower.includes(name.toLowerCase());
            return {
              name,
              type,
              confidenceScore,
              registryValidated: isInRegistry,
              recognized: isInRegistry,
            };
          }

          return {
            name,
            type,
            confidenceScore,
            recognized: confidenceScore > UNIDENTIFIED_THRESHOLD,
          };
        });
    } catch {
      // If JSON parsing fails, return empty brands (unidentified)
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared BrandDetector instance */
export const brandDetector = new BrandDetector();
