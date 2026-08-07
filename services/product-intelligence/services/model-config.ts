/**
 * Model selection configuration for the Product Intelligence Engine.
 *
 * Maps each generation type to its optimal Bedrock model and parameters
 * based on task complexity, output length, and cost considerations.
 *
 * Strategy:
 * - Claude 3 Haiku: Low-complexity tasks (titles, bullets, classification, extraction)
 * - Claude 3 Sonnet: Higher-complexity tasks requiring reasoning (descriptions, SEO, compliance)
 *
 * @module model-config
 */

import type { GenerationType } from '../types/generation.types';
import type { ModelConfig } from '../types/usage.types';

/** Bedrock model identifiers */
const CLAUDE_3_HAIKU = 'anthropic.claude-3-haiku-20240307-v1:0';
const CLAUDE_3_SONNET = 'anthropic.claude-3-sonnet-20240229-v1:0';

/**
 * Default model configuration for each generation type.
 *
 * Model selection rationale:
 * - title: Haiku — short output, low complexity
 * - description: Sonnet — longer creative output, medium complexity
 * - bullets: Haiku — short structured output
 * - seo: Sonnet — analysis requires reasoning
 * - category: Haiku — classification task, low token cost
 * - brand: Haiku — entity extraction, low complexity
 * - attributes: Haiku — structured extraction
 * - keywords: Haiku — list generation, low complexity
 * - compliance: Sonnet — policy reasoning requires deeper analysis
 */
const MODEL_CONFIG_MAP: Record<GenerationType, ModelConfig> = {
  title: {
    generationType: 'title',
    modelId: CLAUDE_3_HAIKU,
    maxTokens: 512,
    temperature: 0.7,
  },
  description: {
    generationType: 'description',
    modelId: CLAUDE_3_SONNET,
    maxTokens: 2048,
    temperature: 0.7,
  },
  bullets: {
    generationType: 'bullets',
    modelId: CLAUDE_3_HAIKU,
    maxTokens: 1024,
    temperature: 0.5,
  },
  seo: {
    generationType: 'seo',
    modelId: CLAUDE_3_SONNET,
    maxTokens: 2048,
    temperature: 0.3,
  },
  category: {
    generationType: 'category',
    modelId: CLAUDE_3_HAIKU,
    maxTokens: 512,
    temperature: 0.3,
  },
  brand: {
    generationType: 'brand',
    modelId: CLAUDE_3_HAIKU,
    maxTokens: 512,
    temperature: 0.3,
  },
  attributes: {
    generationType: 'attributes',
    modelId: CLAUDE_3_HAIKU,
    maxTokens: 1024,
    temperature: 0.3,
  },
  keywords: {
    generationType: 'keywords',
    modelId: CLAUDE_3_HAIKU,
    maxTokens: 1024,
    temperature: 0.5,
  },
  compliance: {
    generationType: 'compliance',
    modelId: CLAUDE_3_SONNET,
    maxTokens: 4096,
    temperature: 0.3,
  },
};

/**
 * Returns the model configuration for a given generation type.
 *
 * @param generationType - The type of content generation operation
 * @returns The model configuration including model ID, max tokens, and temperature
 */
export function getModelConfig(generationType: GenerationType): ModelConfig {
  return MODEL_CONFIG_MAP[generationType];
}
