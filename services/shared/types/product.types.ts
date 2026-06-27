/**
 * Canonical product data model interfaces for the MerchOS platform.
 * Requirements: 14.1, 14.2
 */

import { ChannelId, LanguageCode } from './common.types';
import { InventoryRecord } from './inventory.types';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Valid states in the product lifecycle state machine.
 * Transitions: DRAFT → INGESTED → ENRICHED → REVIEW → VALIDATED → EXPORT_READY → PUBLISHED → ARCHIVED
 * Any state may transition back to REVIEW on tenant attribute edit.
 */
export type LifecycleState =
  | 'DRAFT'
  | 'INGESTED'
  | 'ENRICHED'
  | 'REVIEW'
  | 'VALIDATED'
  | 'EXPORT_READY'
  | 'PUBLISHED'
  | 'ARCHIVED';

/** A single recorded state transition stored in the product's audit history. */
export interface LifecycleTransition {
  fromState: LifecycleState;
  toState: LifecycleState;
  /** ISO 8601 timestamp */
  transitionedAt: string;
  /** Identifier of the actor (user ID or system service) that triggered the transition */
  actor: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/** Moderation status assigned to an image by Rekognition. */
export type ModerationStatus = 'APPROVED' | 'REJECTED' | 'PENDING';

/**
 * Reference to a product image stored in S3, including per-channel processed keys.
 * The first entry in a product's images array is the Hero Image.
 */
export interface ImageReference {
  imageId: string;
  /** Source S3 key in the raw-uploads or assets bucket */
  s3Key: string;
  /** Per-channel processed S3 keys, keyed by ChannelId */
  channelKeys: Partial<Record<ChannelId, string>>;
  /** True when this image is designated the Hero Image */
  isHero: boolean;
  /** True when the image was upscaled to meet minimum channel resolution */
  isUpscaled: boolean;
  moderationStatus: ModerationStatus;
  /** ISO 8601 timestamp */
  uploadedAt: string;
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

/** Source service that produced a particular enriched attribute. */
export type EnrichmentSource = 'bedrock' | 'textract' | 'rekognition' | 'url-extract';

/**
 * An AI-enriched product attribute with confidence scoring and approval tracking.
 */
export interface EnrichedAttribute {
  value: string | number | boolean;
  /** Confidence score in the range [0.0, 1.0] */
  confidence: number;
  source: EnrichmentSource;
  /** True when confidence < 0.70 and human review is required */
  flaggedForReview: boolean;
  /** User ID of the operator who approved this attribute */
  approvedBy?: string;
  /** ISO 8601 timestamp of approval */
  approvedAt?: string;
}

/**
 * Channel-specific generated content stored in the product's enrichment layer.
 */
export interface ChannelContent {
  title: string;
  description: string;
  keywords: string[];
  price?: number;
  currency?: string;
}

/**
 * Localised language version of channel content.
 */
export interface LanguageContent {
  title: string;
  description: string;
  keywords: string[];
  translatedAt: string;
}

// ---------------------------------------------------------------------------
// Category Mapping
// ---------------------------------------------------------------------------

/** A single category candidate returned by the Bedrock recommendation engine. */
export interface CategoryCandidate {
  nodeId: string;
  /** Confidence score in the range [0.0, 1.0] */
  confidence: number;
}

/**
 * Category mapping record for a single channel, stored in the product record.
 */
export interface CategoryMapping {
  channelId: ChannelId;
  recommendedNodes: CategoryCandidate[];
  /** The leaf-node taxonomy ID confirmed by the tenant */
  confirmedNodeId?: string;
  /** Actor who confirmed the category (e.g. 'user:{userId}') */
  confirmedBy?: string;
  /** ISO 8601 timestamp */
  confirmedAt?: string;
  /** Taxonomy snapshot date used for this mapping */
  taxonomyVersion?: string;
}

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

/** A single rule violation found during compliance validation. */
export interface ComplianceViolation {
  ruleId: string;
  violationCode: string;
  fieldValue?: string;
  remediation: string;
}

/**
 * Compliance validation report for a product on a specific channel.
 */
export interface ComplianceReport {
  productId: string;
  channelId: ChannelId;
  ruleSetVersion: string;
  result: 'PASS' | 'FAIL' | 'PENDING';
  violations: ComplianceViolation[];
  /** ISO 8601 timestamp */
  evaluatedAt: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * A record of a single export operation for a product or listing.
 */
export interface ExportRecord {
  exportId: string;
  channelId: ChannelId;
  format: 'CSV' | 'JSON';
  /** S3 key of the generated export file */
  s3Key: string;
  /** ISO 8601 timestamp */
  generatedAt: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  recordCount: number;
}

// InventoryRecord is imported from inventory.types.ts and re-exported
// so Variant can embed it without duplicating the definition.
export type { InventoryRecord };

// ---------------------------------------------------------------------------
// Variant
// ---------------------------------------------------------------------------

/**
 * A specific variant of a product differentiated by attributes such as size or colour.
 */
export interface Variant {
  variantId: string;
  sku: string;
  /** Attribute key-value pairs specific to this variant (e.g. { colour: 'red', size: 'M' }) */
  attributes: Record<string, string>;
  images: ImageReference[];
  inventory: InventoryRecord;
}

// ---------------------------------------------------------------------------
// Enrichment Layer
// ---------------------------------------------------------------------------

/**
 * All AI-generated and enriched data for a product, stored separately
 * from the tenant-supplied canonical fields to preserve immutability.
 */
export interface EnrichmentLayer {
  /** AI-extracted attributes keyed by attribute name */
  attributes: Record<string, EnrichedAttribute>;
  /** Per-channel generated content */
  channelContent: Partial<Record<ChannelId, ChannelContent>>;
  /** Translated content versions keyed by LanguageCode */
  languageVersions: Partial<Record<LanguageCode, LanguageContent>>;
  /** ISO 639-1 language code detected from source content */
  detectedLanguage: string;
  /** ISO 8601 timestamp of the last enrichment run */
  enrichedAt: string;
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------

/**
 * Canonical Product record — the central data model for MerchOS.
 * Stored in DynamoDB Products table: PK TENANT#<tenantId>, SK PRODUCT#<productId>.
 * Requirements: 14.1
 */
export interface Product {
  /** UUID v4 */
  productId: string;
  tenantId: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  /** Raw tenant-supplied attributes; values may be string, number, or boolean */
  attributes: Record<string, string | number | boolean>;
  /** Ordered image array; index 0 is the Hero Image */
  images: ImageReference[];
  variants: Variant[];
  lifecycleState: LifecycleState;
  lifecycleHistory: LifecycleTransition[];
  enrichmentLayer: EnrichmentLayer;
  /** Per-channel category mappings */
  categoryMappings: Partial<Record<ChannelId, CategoryMapping>>;
  /** Per-channel compliance validation reports */
  complianceReports: Partial<Record<ChannelId, ComplianceReport>>;
  /** ISO 8601 timestamp */
  createdAt: string;
  /** ISO 8601 timestamp */
  updatedAt: string;
  /** ISO 8601 timestamp; set when soft-deleted */
  deletedAt?: string;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/**
 * A channel-specific representation of a Product, extending the canonical
 * Product with channel-specific fields required for marketplace listing.
 * Requirements: 14.2
 */
export interface Listing extends Product {
  channelId: ChannelId;
  /** Additional channel-specific fields not covered by the canonical schema */
  channelSpecificFields: Record<string, unknown>;
  complianceStatus: 'PASSING' | 'FAILING' | 'PENDING';
  exportHistory: ExportRecord[];
  channelPrice: number;
  channelCurrency: string;
  /** The listing ID assigned by the channel (e.g. Shopify product ID) */
  channelListingId?: string;
  /** ISO 8601 timestamp of when the listing was published to the channel */
  publishedAt?: string;
}
