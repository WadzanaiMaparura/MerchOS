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

/**
 * Bedrock model identifiers — EU cross-region INFERENCE PROFILE ids.
 *
 * The Claude models in eu-west-1 support only INFERENCE_PROFILE inference,
 * not ON_DEMAND, so they MUST be invoked via an inference-profile id (the
 * `eu.` cross-region profile), not a bare `anthropic.*` foundation-model id.
 * Verified via `bedrock list-inference-profiles`. Keep in sync with the IAM
 * policy in infrastructure/lib/product-intelligence-stack.ts.
 *
 * WHICH GENERATION, AND WHY (Nov 2026): Haiku 4.5 / Sonnet 4.5.
 * This account is denied the 5.5 models (AccessDeniedException; AWS Support
 * confirmed access is unchanged pending a Sales review), while the 4.5 models are
 * entitled (Marketplace agreement accepted) and only blocked by an account-wide
 * 0-token quota. Targeting 4.5 means AI works the moment that quota is lifted.
 *
 * Sonnet 4.5 is LEGACY with Bedrock end-of-life 2027-04-08, so move to 5.5 once
 * AWS grants access. That is a configuration change, not a code change: set
 * BEDROCK_HAIKU_MODEL_ID / BEDROCK_SONNET_MODEL_ID on the Lambdas, e.g.
 *   eu.anthropic.claude-haiku-5-5 / eu.anthropic.claude-sonnet-5-5
 */
export const DEFAULT_HAIKU_MODEL_ID = 'eu.anthropic.claude-haiku-4-5-20251001-v1:0';
export const DEFAULT_SONNET_MODEL_ID = 'eu.anthropic.claude-sonnet-4-5-20250929-v1:0';

/** Only EU cross-region inference-profile ids are valid here (see above). */
function modelIdFromEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value && /^eu\.[a-z0-9.:-]+$/i.test(value) ? value : fallback;
}

const CLAUDE_HAIKU = modelIdFromEnv('BEDROCK_HAIKU_MODEL_ID', DEFAULT_HAIKU_MODEL_ID);
const CLAUDE_SONNET = modelIdFromEnv('BEDROCK_SONNET_MODEL_ID', DEFAULT_SONNET_MODEL_ID);

/**
 * Default model configuration for each generation type.
 *
 * Model selection rationale:
 * - title: Haiku — short output, low complexity
 * - description: Haiku — 4.5 handles long-form well; keeps the per-product cost low
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
    modelId: CLAUDE_HAIKU,
    maxTokens: 512,
    temperature: 0.7,
  },
  description: {
    generationType: 'description',
    modelId: CLAUDE_HAIKU, // Haiku 4.5 writes good descriptions at ~1/3 of Sonnet's cost (launch pricing depends on it)
    maxTokens: 2048,
    temperature: 0.7,
  },
  bullets: {
    generationType: 'bullets',
    modelId: CLAUDE_HAIKU,
    maxTokens: 1024,
    temperature: 0.5,
  },
  seo: {
    generationType: 'seo',
    modelId: CLAUDE_SONNET,
    maxTokens: 2048,
    temperature: 0.3,
  },
  category: {
    generationType: 'category',
    modelId: CLAUDE_HAIKU,
    maxTokens: 512,
    temperature: 0.3,
  },
  brand: {
    generationType: 'brand',
    modelId: CLAUDE_HAIKU,
    maxTokens: 512,
    temperature: 0.3,
  },
  attributes: {
    generationType: 'attributes',
    modelId: CLAUDE_HAIKU,
    maxTokens: 1024,
    temperature: 0.3,
  },
  keywords: {
    generationType: 'keywords',
    modelId: CLAUDE_HAIKU,
    maxTokens: 1024,
    temperature: 0.5,
  },
  compliance: {
    generationType: 'compliance',
    modelId: CLAUDE_SONNET,
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
