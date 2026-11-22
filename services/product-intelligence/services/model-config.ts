/**
 * Model selection configuration for the Product Intelligence Engine.
 *
 * Maps each generation type to its optimal Bedrock model and parameters
 * based on task complexity, output length, and cost considerations.
 *
 * Strategy:
 * - Fast model (Nova Lite): titles, bullets, classification, extraction
 * - Strong model (Nova Pro): descriptions, SEO, compliance
 *
 * @module model-config
 */

import type { GenerationType } from '../types/generation.types';
import type { ModelConfig } from '../types/usage.types';

/**
 * Bedrock model identifiers: EU cross-region INFERENCE PROFILE ids (`eu.`),
 * which keep processing inside the EU. Keep in sync with the IAM policy in
 * infrastructure/lib/product-intelligence-stack.ts.
 *
 * WHICH MODELS, AND WHY (22 Nov 2026): Amazon Nova.
 * - AWS Support declined Claude Haiku 4.5 / 5.5 and Sonnet 5.5 for this account
 *   ("account usage history"); Sonnet 4.5 is now Legacy and closed to accounts
 *   not already using it. Nova Lite/Pro work in eu-west-1 (verified by a live
 *   Converse call).
 * - Cost per million tokens (input/output, USD): Nova Lite ~0.06/0.24,
 *   Nova Pro ~0.80/3.20, both below the Haiku 4.5 (1/5) the launch pricing
 *   was sized on.
 *
 * The client uses the model-neutral Converse API, so switching model (e.g.
 * back to Claude when AWS grants access) is configuration only: set
 * BEDROCK_FAST_MODEL_ID / BEDROCK_STRONG_MODEL_ID on the Lambdas (CDK context
 * bedrockFastModelId / bedrockStrongModelId).
 */
/** Short, structured tasks (titles, bullets, extraction, classification). */
export const DEFAULT_FAST_MODEL_ID = 'eu.amazon.nova-lite-v1:0';
/** Long-form writing and reasoning (descriptions, SEO, compliance). */
export const DEFAULT_STRONG_MODEL_ID = 'eu.amazon.nova-pro-v1:0';

/** Only EU cross-region inference-profile ids are valid here (see above). */
function modelIdFromEnv(names: string[], fallback: string): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value && /^eu\.[a-z0-9.:-]+$/i.test(value)) return value;
  }
  return fallback;
}

// The *_HAIKU_* / *_SONNET_* names are still honoured for existing deployments.
const FAST_MODEL = modelIdFromEnv(['BEDROCK_FAST_MODEL_ID', 'BEDROCK_HAIKU_MODEL_ID'], DEFAULT_FAST_MODEL_ID);
const STRONG_MODEL = modelIdFromEnv(['BEDROCK_STRONG_MODEL_ID', 'BEDROCK_SONNET_MODEL_ID'], DEFAULT_STRONG_MODEL_ID);

/**
 * Default model configuration for each generation type.
 *
 * Model selection rationale:
 * - title: fast (short output)
 * - description: strong (the main listing text)
 * - bullets: fast (short structured output)
 * - seo: strong (analysis)
 * - category / brand / attributes / keywords: fast (classification and extraction)
 * - compliance: strong (policy reasoning)
 */
const MODEL_CONFIG_MAP: Record<GenerationType, ModelConfig> = {
  title: {
    generationType: 'title',
    modelId: FAST_MODEL,
    maxTokens: 512,
    temperature: 0.7,
  },
  description: {
    generationType: 'description',
    modelId: STRONG_MODEL, // the listing's main text: worth the stronger model (still below the Haiku 4.5 cost pricing assumed)
    maxTokens: 2048,
    temperature: 0.7,
  },
  bullets: {
    generationType: 'bullets',
    // Nova Lite ignored "one bullet per line" and wrote a paragraph; Pro follows it.
    modelId: STRONG_MODEL,
    maxTokens: 1024,
    temperature: 0.5,
  },
  seo: {
    generationType: 'seo',
    modelId: STRONG_MODEL,
    maxTokens: 2048,
    temperature: 0.3,
  },
  category: {
    generationType: 'category',
    modelId: FAST_MODEL,
    maxTokens: 512,
    temperature: 0.3,
  },
  brand: {
    generationType: 'brand',
    modelId: FAST_MODEL,
    maxTokens: 512,
    temperature: 0.3,
  },
  attributes: {
    generationType: 'attributes',
    modelId: FAST_MODEL,
    maxTokens: 1024,
    temperature: 0.3,
  },
  keywords: {
    generationType: 'keywords',
    modelId: FAST_MODEL,
    maxTokens: 1024,
    temperature: 0.5,
  },
  compliance: {
    generationType: 'compliance',
    modelId: STRONG_MODEL,
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
