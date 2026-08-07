/**
 * Prompt template and A/B testing types for the Product Intelligence Engine.
 *
 * Defines the structure for versioned prompt templates, variable interpolation,
 * and A/B test configuration used by the Prompt Manager service.
 *
 * @module prompt.types
 */

import type { GenerationType } from './generation.types';

/**
 * A versioned prompt template stored in DynamoDB.
 * Templates use double-brace syntax for variable placeholders (e.g., {{product_name}}).
 */
export interface PromptTemplate {
  /** Unique identifier for this template */
  templateId: string;
  /** The generation type this template is designed for */
  generationType: GenerationType;
  /** Monotonically increasing version number */
  version: number;
  /** The template content with {{variable}} placeholders */
  content: string;
  /** List of variable names expected by this template */
  variables: string[];
  /** Whether this template is currently active for routing */
  active: boolean;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** Traffic percentage for A/B testing (0-100) */
  trafficPercentage?: number;
}

/**
 * Configuration for A/B testing prompt template variants.
 * Traffic percentages across all variants should sum to 100.
 */
export interface ABTestConfig {
  /** Whether A/B testing is enabled for this generation type */
  enabled: boolean;
  /** Variants with their traffic allocation */
  variants: {
    /** Template ID for this variant */
    templateId: string;
    /** Version number of the template */
    version: number;
    /** Percentage of traffic routed to this variant (0-100) */
    trafficPercentage: number;
  }[];
}

/**
 * Input for creating a new prompt template version.
 */
export interface CreatePromptTemplateInput {
  /** The generation type this template targets */
  generationType: GenerationType;
  /** Template content with {{variable}} placeholders */
  content: string;
  /** List of variable names used in the template */
  variables: string[];
  /** Whether to activate this version immediately */
  active: boolean;
  /** Traffic percentage for A/B testing (optional) */
  trafficPercentage?: number;
  /** ID of the user creating this template */
  createdBy: string;
}
