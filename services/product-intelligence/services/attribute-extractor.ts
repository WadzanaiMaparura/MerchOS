/**
 * Attribute Extractor service for the Product Intelligence Engine.
 *
 * Parses structured attributes (size, color, material, weight, dimensions)
 * from unstructured product text using Amazon Bedrock. Supports normalization
 * to standard units and marketplace-specific attribute schema mapping.
 *
 * @module attribute-extractor
 * @see Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

import type {
  MarketplaceId,
  ProductData,
  AttributeExtractionResult,
} from '../types/generation.types';
import { BedrockClient } from './bedrock-client';
import { getModelConfig } from './model-config';
import { calculate as calculateConfidence } from './confidence-scorer';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Input for attribute extraction requests.
 */
export interface AttributeExtractionInput {
  /** Unstructured text to extract attributes from */
  text: string;
  /** Product data providing additional context for extraction */
  productData: ProductData;
  /** Optional target marketplace for attribute schema mapping */
  marketplace?: MarketplaceId;
}

/**
 * Raw attribute parsed from Bedrock response before normalization.
 */
interface RawExtractedAttribute {
  /** Attribute key (e.g., "color", "size", "material") */
  key: string;
  /** Raw extracted value */
  value: string;
  /** Unit if detected (e.g., "lbs", "inches") */
  unit?: string;
  /** Model confidence for this extraction */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Standard attributes the extractor targets for extraction.
 * Referenced in prompt construction and validation logic.
 */
const STANDARD_ATTRIBUTES: readonly string[] = ['size', 'color', 'material', 'weight', 'dimensions'];

/**
 * Unit normalization mappings for converting common units to standard metric units.
 * Maps source unit → { targetUnit, conversionFactor }.
 */
const UNIT_NORMALIZATION: Record<string, { targetUnit: string; factor: number }> = {
  // Weight conversions → kg
  'lbs': { targetUnit: 'kg', factor: 0.453592 },
  'lb': { targetUnit: 'kg', factor: 0.453592 },
  'pounds': { targetUnit: 'kg', factor: 0.453592 },
  'oz': { targetUnit: 'kg', factor: 0.0283495 },
  'ounces': { targetUnit: 'kg', factor: 0.0283495 },
  'g': { targetUnit: 'kg', factor: 0.001 },
  'grams': { targetUnit: 'kg', factor: 0.001 },
  'kg': { targetUnit: 'kg', factor: 1 },
  'kilograms': { targetUnit: 'kg', factor: 1 },
  // Length conversions → cm
  'in': { targetUnit: 'cm', factor: 2.54 },
  'inches': { targetUnit: 'cm', factor: 2.54 },
  'inch': { targetUnit: 'cm', factor: 2.54 },
  'ft': { targetUnit: 'cm', factor: 30.48 },
  'feet': { targetUnit: 'cm', factor: 30.48 },
  'mm': { targetUnit: 'cm', factor: 0.1 },
  'millimeters': { targetUnit: 'cm', factor: 0.1 },
  'cm': { targetUnit: 'cm', factor: 1 },
  'centimeters': { targetUnit: 'cm', factor: 1 },
  'm': { targetUnit: 'cm', factor: 100 },
  'meters': { targetUnit: 'cm', factor: 100 },
};

/**
 * Marketplace-specific attribute schema mappings.
 * Maps generic attribute keys to marketplace-specific attribute names.
 */
const MARKETPLACE_ATTRIBUTE_SCHEMAS: Record<MarketplaceId, Record<string, string>> = {
  amazon: {
    size: 'item_dimensions_size',
    color: 'color_name',
    material: 'material_type',
    weight: 'item_weight',
    dimensions: 'item_dimensions',
  },
  shopify: {
    size: 'size',
    color: 'color',
    material: 'material',
    weight: 'weight',
    dimensions: 'dimensions',
  },
  ebay: {
    size: 'Size',
    color: 'Color',
    material: 'Material',
    weight: 'Item Weight',
    dimensions: 'Item Dimensions',
  },
};

// ---------------------------------------------------------------------------
// Bedrock Client Setup
// ---------------------------------------------------------------------------

let bedrockClientInstance: BedrockClient | null = null;

/**
 * Returns or creates the shared BedrockClient instance.
 */
function getBedrockClientInstance(): BedrockClient {
  if (!bedrockClientInstance) {
    bedrockClientInstance = new BedrockClient();
  }
  return bedrockClientInstance;
}

/**
 * Override the BedrockClient instance (used for testing).
 *
 * @param client - The mock or test Bedrock client
 */
export function setBedrockClient(client: BedrockClient): void {
  bedrockClientInstance = client;
}

// ---------------------------------------------------------------------------
// Prompt Construction
// ---------------------------------------------------------------------------

/**
 * Builds the extraction prompt for Bedrock.
 *
 * Instructs the model to extract standard attributes from the provided text,
 * returning a structured JSON response.
 *
 * @param text - The unstructured text to extract attributes from
 * @param productData - Additional product context
 * @returns The formatted prompt string
 */
function buildExtractionPrompt(text: string, productData: ProductData): string {
  const contextParts: string[] = [];

  if (productData.name) {
    contextParts.push(`Product Name: ${productData.name}`);
  }
  if (productData.category) {
    contextParts.push(`Category: ${productData.category}`);
  }
  if (productData.brand) {
    contextParts.push(`Brand: ${productData.brand}`);
  }

  const contextSection = contextParts.length > 0
    ? `\nAdditional Context:\n${contextParts.join('\n')}\n`
    : '';

  return `Extract structured product attributes from the following text. Return ONLY a valid JSON array of objects.

Each object must have these fields:
- "key": one of "${STANDARD_ATTRIBUTES.join('", "')}" (or other relevant product attributes)
- "value": the raw extracted value as a string
- "unit": the unit of measurement if applicable (e.g., "lbs", "inches", "cm"), or null if not applicable
- "confidence": a number between 0 and 1 indicating your confidence in this extraction

Focus on extracting these standard attributes when present: ${STANDARD_ATTRIBUTES.join(', ')}.
Also extract any other clearly stated product attributes.
${contextSection}
Text to analyze:
"""
${text}
"""

Respond with ONLY the JSON array, no additional text or explanation.`;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Attempts to normalize an attribute value to a standard unit.
 *
 * For weight attributes, normalizes to kg.
 * For dimensions/size attributes, normalizes to cm.
 *
 * @param key - The attribute key
 * @param value - The raw value string
 * @param unit - The detected unit (if any)
 * @returns An object with normalizedValue, normalizedUnit, and whether normalization failed
 */
function normalizeValue(
  key: string,
  value: string,
  unit?: string,
): { normalizedValue?: string; normalizedUnit?: string; normalizationFailed: boolean } {
  // If no unit is provided, check if the value itself contains a unit
  const effectiveUnit = unit?.toLowerCase().trim();

  if (!effectiveUnit) {
    // Try to parse unit from value string (e.g., "5 lbs")
    const match = value.match(/^([\d.]+)\s*([a-zA-Z]+)$/);
    if (match) {
      const numericValue = parseFloat(match[1]!);
      const parsedUnit = match[2]!.toLowerCase();

      if (isNaN(numericValue)) {
        return { normalizationFailed: true };
      }

      const conversion = UNIT_NORMALIZATION[parsedUnit];
      if (conversion) {
        const converted = numericValue * conversion.factor;
        const rounded = Math.round(converted * 100) / 100;
        return {
          normalizedValue: `${rounded} ${conversion.targetUnit}`,
          normalizedUnit: conversion.targetUnit,
          normalizationFailed: false,
        };
      }
    }

    // For attributes that don't need unit normalization (color, material)
    if (key === 'color' || key === 'material') {
      return {
        normalizedValue: value.toLowerCase().trim(),
        normalizationFailed: false,
      };
    }

    // Cannot normalize — no unit found for a unit-based attribute
    if (key === 'weight' || key === 'dimensions' || key === 'size') {
      return { normalizationFailed: true };
    }

    // For other attributes, return as-is without normalization failure
    return { normalizedValue: value.trim(), normalizationFailed: false };
  }

  // Attempt unit conversion
  const conversion = UNIT_NORMALIZATION[effectiveUnit];
  if (!conversion) {
    // Unknown unit — normalization fails
    return { normalizationFailed: true };
  }

  // Parse numeric portion from value
  const numericMatch = value.match(/([\d.]+)/);
  if (!numericMatch) {
    return { normalizationFailed: true };
  }

  const numericValue = parseFloat(numericMatch[1]!);
  if (isNaN(numericValue)) {
    return { normalizationFailed: true };
  }

  const converted = numericValue * conversion.factor;
  const rounded = Math.round(converted * 100) / 100;

  return {
    normalizedValue: `${rounded} ${conversion.targetUnit}`,
    normalizedUnit: conversion.targetUnit,
    normalizationFailed: false,
  };
}

/**
 * Maps an attribute key to the marketplace-specific attribute name.
 *
 * @param key - The generic attribute key
 * @param marketplace - The target marketplace
 * @returns The marketplace-specific attribute key, or the original key if no mapping exists
 */
function mapToMarketplaceSchema(key: string, marketplace: MarketplaceId): string {
  const schema = MARKETPLACE_ATTRIBUTE_SCHEMAS[marketplace];
  return schema[key] ?? key;
}

// ---------------------------------------------------------------------------
// Response Parsing
// ---------------------------------------------------------------------------

/**
 * Parses the Bedrock model response into raw extracted attributes.
 *
 * Handles cases where the model wraps JSON in markdown code blocks
 * or includes extra text before/after the JSON array.
 *
 * @param content - The raw response content from Bedrock
 * @returns Array of raw extracted attributes
 */
function parseExtractionResponse(content: string): RawExtractedAttribute[] {
  // Strip markdown code blocks if present
  let cleaned = content.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Try to find a JSON array in the response
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) {
    return [];
  }

  try {
    const parsed = JSON.parse(arrayMatch[0]);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item: unknown): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null,
      )
      .map((item): RawExtractedAttribute => {
        const base = {
          key: String(item['key'] ?? '').toLowerCase().trim(),
          value: String(item['value'] ?? ''),
          confidence: typeof item['confidence'] === 'number'
            ? Math.min(1, Math.max(0, item['confidence']))
            : 0.5,
        };
        if (item['unit']) {
          return { ...base, unit: String(item['unit']) };
        }
        return base;
      })
      .filter((attr) => attr.key.length > 0 && attr.value.length > 0);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Input Completeness
// ---------------------------------------------------------------------------

/**
 * Calculates input completeness score for confidence scoring.
 *
 * Measures how much context data is available in the request.
 *
 * @param text - The input text
 * @param productData - The product data context
 * @returns A value between 0 and 1 representing input completeness
 */
function calculateInputCompleteness(text: string, productData: ProductData): number {
  let score = 0;
  const maxFields = 5;

  // Text presence and quality
  if (text.length > 0) score += 1;
  if (productData.name) score += 1;
  if (productData.category) score += 1;
  if (productData.brand) score += 1;
  if (productData.description || productData.attributes) score += 1;

  return score / maxFields;
}

// ---------------------------------------------------------------------------
// Attribute Extractor Class
// ---------------------------------------------------------------------------

/**
 * Attribute Extractor service that invokes Bedrock to parse structured attributes
 * from unstructured product text.
 *
 * Capabilities:
 * - Extracts standard attributes: size, color, material, weight, dimensions
 * - Normalizes values to standard units (e.g., "5 lbs" → "2.27 kg")
 * - Maps attributes to marketplace-specific schemas
 * - Sets normalizationFailed=true when normalization to standard units fails
 *
 * @see Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */
export class AttributeExtractor {
  /**
   * Extracts structured attributes from unstructured product text.
   *
   * Invokes Bedrock with a structured extraction prompt, parses the response,
   * normalizes values to standard units, and maps to marketplace-specific
   * attribute schemas when a marketplace is specified.
   *
   * @param request - The extraction input containing text, product data, and optional marketplace
   * @returns An AttributeExtractionResult with extracted attributes, confidence scores, and normalization status
   *
   * @example
   * ```typescript
   * const result = await extractor.extract({
   *   text: "Blue cotton t-shirt, size XL, weighs 5 lbs, 24x16x2 inches",
   *   productData: { name: "Classic T-Shirt", category: "Apparel" },
   *   marketplace: 'amazon',
   * });
   * // result.attributes → [{ key: "color_name", value: "Blue", normalizedValue: "blue", ... }]
   * ```
   *
   * @see Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  async extract(request: AttributeExtractionInput): Promise<AttributeExtractionResult> {
    const { text, productData, marketplace } = request;
    const modelConfig = getModelConfig('attributes');
    const bedrockClient = getBedrockClientInstance();

    // Build the extraction prompt
    const prompt = buildExtractionPrompt(text, productData);

    // Invoke Bedrock
    const invocationResult = await bedrockClient.invoke({
      modelId: modelConfig.modelId,
      prompt,
      maxTokens: modelConfig.maxTokens,
      temperature: modelConfig.temperature,
    });

    // Parse the raw response
    const rawAttributes = parseExtractionResponse(invocationResult.content);

    // Calculate input completeness for confidence scoring
    const inputCompleteness = calculateInputCompleteness(text, productData);

    // Process each attribute: normalize values and map to marketplace schema
    const attributes = rawAttributes.map((raw) => {
      // Attempt normalization
      const normalization = normalizeValue(raw.key, raw.value, raw.unit);

      // Calculate confidence score using the confidence scorer
      const confidenceScore = calculateConfidence({
        modelProbability: raw.confidence,
        inputCompleteness,
        historicalAccuracy: 0.75, // Default historical accuracy for attribute extraction
      });

      // Map key to marketplace schema if marketplace is specified
      const mappedKey = marketplace
        ? mapToMarketplaceSchema(raw.key, marketplace)
        : raw.key;

      return {
        key: mappedKey,
        value: raw.value,
        ...(normalization.normalizedValue !== undefined
          ? { normalizedValue: normalization.normalizedValue }
          : {}),
        ...(normalization.normalizedUnit !== undefined
          ? { unit: normalization.normalizedUnit }
          : raw.unit ? { unit: raw.unit } : {}),
        confidenceScore,
        normalizationFailed: normalization.normalizationFailed,
      };
    });

    return { attributes };
  }
}

// ---------------------------------------------------------------------------
// Singleton Export
// ---------------------------------------------------------------------------

/** Shared AttributeExtractor instance */
export const attributeExtractor = new AttributeExtractor();
