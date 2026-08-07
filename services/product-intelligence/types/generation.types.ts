/**
 * Core generation types for the Product Intelligence Engine.
 *
 * Defines the fundamental types used across all content generation,
 * optimization, and validation operations.
 *
 * @module generation.types
 */

/**
 * All supported generation operation types.
 * Each type maps to a dedicated service handler.
 */
export type GenerationType =
  | 'title'
  | 'description'
  | 'bullets'
  | 'seo'
  | 'category'
  | 'brand'
  | 'attributes'
  | 'keywords'
  | 'compliance';

/**
 * Supported marketplace identifiers for platform-specific content rules.
 */
export type MarketplaceId = 'amazon' | 'shopify' | 'ebay';

/**
 * Product data input for generation requests.
 * Contains all available product information used as context for AI generation.
 */
export interface ProductData {
  /** Product name or title */
  name?: string;
  /** Raw product description text */
  description?: string;
  /** Product category */
  category?: string;
  /** Brand name */
  brand?: string;
  /** Key-value pairs of product attributes (e.g., color, size, material) */
  attributes?: Record<string, string>;
  /** URLs of product images */
  images?: string[];
  /** Product price information */
  price?: { amount: number; currency: string };
  /** Existing content to optimize or validate */
  existingContent?: string;
}

/**
 * A request to generate AI-powered content for a product.
 * Submitted by sellers via the API or dashboard.
 */
export interface GenerationRequest {
  /** The type of content to generate */
  type: GenerationType;
  /** Product data used as context for generation */
  productData: ProductData;
  /** Optional target marketplace for platform-specific rules */
  marketplace?: MarketplaceId;
  /** Additional generation options (type-specific) */
  options?: Record<string, unknown>;
}

/**
 * Discriminated union representing generated content.
 * The `type` field determines the shape of the content payload.
 */
export type GeneratedContent =
  | { type: 'title'; title: string }
  | { type: 'description'; description: string; truncated: boolean }
  | { type: 'bullets'; bullets: string[] }
  | { type: 'seo'; analysis: SEOAnalysisResult }
  | { type: 'category'; predictions: CategoryPredictionResult }
  | { type: 'brand'; detection: BrandDetectionResult }
  | { type: 'attributes'; extraction: AttributeExtractionResult }
  | { type: 'keywords'; keywords: KeywordGenerationResult }
  | { type: 'compliance'; validation: ComplianceValidationResult };

/**
 * The complete result of a generation operation.
 * Includes generated content, confidence scoring, and metadata.
 */
export interface GenerationResult {
  /** Unique identifier for this result */
  resultId: string;
  /** The generation type that produced this result */
  type: GenerationType;
  /** Whether the generation completed or failed */
  status: 'completed' | 'failed';
  /** The generated content payload */
  content: GeneratedContent;
  /** AI confidence in the generated output (0.0 to 1.0) */
  confidenceScore: number;
  /** Whether manual review is recommended (true when score < 0.7) */
  reviewRecommended: boolean;
  /** Generation metadata for traceability and billing */
  metadata: {
    /** Version of the prompt template used */
    promptVersion: number;
    /** ID of the prompt template used */
    promptTemplateId: string;
    /** Token counts for billing */
    tokenUsage: { inputTokens: number; outputTokens: number };
    /** Whether the result was served from cache */
    cached: boolean;
    /** The Bedrock model ID used */
    modelId: string;
    /** End-to-end latency in milliseconds */
    latencyMs: number;
    /** Target marketplace if specified */
    marketplace?: MarketplaceId;
    /** Marketplace compliance status if applicable */
    marketplaceCompliance?: 'compliant' | 'warnings' | 'non_compliant';
  };
  /** Error details when status is 'failed' */
  error?: { code: string; message: string };
  /** ISO 8601 creation timestamp */
  createdAt: string;
}

/**
 * A batch request containing multiple generation items.
 */
export interface BatchGenerationRequest {
  /** Array of individual generation requests */
  items: GenerationRequest[];
  /** Maximum concurrent Bedrock invocations (default: 5) */
  concurrencyLimit?: number;
}

/**
 * The result of a batch generation operation.
 */
export interface BatchGenerationResult {
  /** Individual results for each item in the batch */
  results: GenerationResult[];
  /** Aggregate summary of the batch operation */
  summary: {
    /** Total number of items in the batch */
    total: number;
    /** Number of items that completed successfully */
    succeeded: number;
    /** Number of items that failed */
    failed: number;
    /** Total tokens consumed across all items */
    totalTokens: number;
  };
}

// ─── Service-specific result interfaces referenced by GeneratedContent ───────

/**
 * Result from SEO analysis operations.
 */
export interface SEOAnalysisResult {
  /** Keyword density map: keyword → percentage of total word count */
  keywordDensity: Record<string, number>;
  /** Improvement suggestions */
  suggestions: string[];
  /** Content with SEO optimizations applied */
  optimizedContent: string;
  /** Generated meta description (≤ 155 characters) */
  metaDescription?: string;
  /** Keywords flagged for stuffing (density > 3%) */
  keywordStuffingFlags: { keyword: string; density: number }[];
  /** Confidence in the SEO analysis */
  confidenceScore: number;
}

/**
 * Result from category prediction operations.
 */
export interface CategoryPredictionResult {
  /** Ranked category predictions sorted by confidence descending */
  predictions: {
    /** Category identifier */
    categoryId: string;
    /** Full category path breadcrumb */
    categoryPath: string[];
    /** Confidence in this prediction */
    confidenceScore: number;
  }[];
  /** True if all prediction scores are below 0.3 */
  manualReviewRecommended: boolean;
}

/**
 * Result from brand detection operations.
 */
export interface BrandDetectionResult {
  /** Detected brands with classification */
  brands: {
    /** Brand name */
    name: string;
    /** Whether this is the primary brand or a sub-brand */
    type: 'primary' | 'sub-brand';
    /** Confidence in this detection */
    confidenceScore: number;
    /** Whether the brand was validated against a known registry */
    registryValidated?: boolean;
    /** Whether the brand is recognized */
    recognized: boolean;
  }[];
  /** True if no brand has confidence score above 0.5 */
  unidentified: boolean;
}

/**
 * Result from attribute extraction operations.
 */
export interface AttributeExtractionResult {
  /** Extracted attributes with values and metadata */
  attributes: {
    /** Attribute key (e.g., "color", "size", "material") */
    key: string;
    /** Raw extracted value */
    value: string;
    /** Normalized value (e.g., standardized unit) */
    normalizedValue?: string;
    /** Unit of measurement if applicable */
    unit?: string;
    /** Confidence in this extraction */
    confidenceScore: number;
    /** Whether normalization to a standard unit failed */
    normalizationFailed: boolean;
  }[];
}

/**
 * Result from keyword generation operations.
 */
export interface KeywordGenerationResult {
  /** Generated keywords with categorization */
  keywords: {
    /** The keyword or phrase */
    term: string;
    /** Keyword category by relevance */
    category: 'primary' | 'secondary' | 'long-tail';
    /** Relevance score for this keyword */
    relevanceScore: number;
  }[];
  /** Keywords not in the product's current set but used by competitors */
  gapKeywords?: string[];
  /** Overall quality score for the keyword set */
  overallQualityScore: number;
}

/**
 * Result from compliance validation operations.
 */
export interface ComplianceValidationResult {
  /** Overall compliance status */
  status: 'pass' | 'fail' | 'warnings_only';
  /** Numeric compliance score (0.0 to 1.0) */
  complianceScore: number;
  /** Individual violations found */
  violations: {
    /** Type of violation (e.g., "restricted_term", "trademark") */
    type: string;
    /** Severity level */
    severity: 'error' | 'warning';
    /** The text that triggered the violation */
    offendingText: string;
    /** Character span of the offending text */
    span: { start: number; end: number };
    /** Suggested replacement or fix */
    suggestedFix: string;
  }[];
  /** Corrected content with violations resolved (only when status is 'fail') */
  correctedContent?: string;
}

/**
 * Adapted content after marketplace rules are applied.
 */
export interface MarketplaceAdaptedContent {
  /** The adapted content string */
  content: string;
  /** Marketplace compliance status */
  complianceStatus: 'compliant' | 'warnings' | 'non_compliant';
  /** Warnings about marketplace rule violations */
  warnings: string[];
  /** Whether content was truncated to meet character limits */
  truncated: boolean;
  /** List of marketplace rules that were applied */
  appliedRules: string[];
}
