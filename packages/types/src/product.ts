/**
 * Product-related API DTOs for the MerchOS seller-dashboard frontend.
 *
 * This file contains **API response/request DTOs** — the wire format returned by
 * the REST API and consumed by frontend components. These types are NOT the
 * canonical domain model.
 *
 * - `Product` is the API response shape for full product detail views.
 * - `ProductSummary` is the lightweight list-view representation.
 * - Request payloads (`ApproveAttributePayload`, `OverrideAttributePayload`,
 *   `TransitionPayload`) define the wire format for mutations.
 *
 * The **authoritative canonical domain model** is `CanonicalProduct` in
 * `./marketplace.ts`. That model is marketplace-independent, persisted in
 * DynamoDB, and serves as input to the export pipeline.
 *
 * Conversion between the domain model and these DTOs happens at the service
 * layer boundary:
 *
 *   CanonicalProduct (domain) → Product (API DTO) → Frontend
 *   Frontend → Request DTOs → CanonicalProduct (domain)
 *
 * Do NOT conflate these DTOs with the canonical model. DTOs include
 * computed/enriched fields (enrichmentLayer, lifecycleHistory, complianceReports)
 * that are assembled at query time from multiple data sources.
 */

import { ChannelId, LifecycleState } from './common';

/** Summary representation of a product for list views. */
export interface ProductSummary {
  productId: string;
  tenantId: string;
  sku: string;
  title: string;
  thumbnailUrl: string | null;
  lifecycleState: LifecycleState;
  updatedAt: string; // ISO 8601
}

/** Enrichment source that produced a particular attribute. */
export type EnrichmentSource = 'bedrock' | 'textract' | 'rekognition' | 'url-extract';

/** An AI-enriched product attribute with confidence scoring. */
export interface EnrichedAttribute {
  value: string | number | boolean;
  confidence: number;
  source: EnrichmentSource;
  flaggedForReview: boolean;
  approvedBy?: string;
  approvedAt?: string;
}

/** Image moderation status. */
export type ModerationStatus = 'APPROVED' | 'REJECTED' | 'PENDING';

/** Reference to a product image. */
export interface ImageReference {
  imageId: string;
  s3Key: string;
  channelKeys: Partial<Record<ChannelId, string>>;
  isHero: boolean;
  isUpscaled: boolean;
  moderationStatus: ModerationStatus;
  uploadedAt: string;
}

/** Channel-specific generated content. */
export interface ChannelContent {
  title: string;
  description: string;
  keywords: string[];
  price?: number;
  currency?: string;
}

/** Product enrichment layer (AI-generated data). */
export interface EnrichmentLayer {
  attributes: Record<string, EnrichedAttribute>;
  channelContent: Partial<Record<ChannelId, ChannelContent>>;
  detectedLanguage: string;
  enrichedAt: string;
}

/** A single lifecycle state transition in the audit history. */
export interface LifecycleTransition {
  fromState: LifecycleState;
  toState: LifecycleState;
  transitionedAt: string;
  actor: string;
  reason?: string;
}

/** Compliance violation entry. */
export interface ComplianceViolation {
  ruleId: string;
  violationCode: string;
  fieldValue?: string;
  remediation: string;
}

/** Compliance validation report for a product on a channel. */
export interface ComplianceReport {
  productId: string;
  channelId: ChannelId;
  ruleSetVersion: string;
  result: 'PASS' | 'FAIL' | 'PENDING';
  violations: ComplianceViolation[];
  evaluatedAt: string;
}

/** Category mapping for a channel. */
export interface CategoryMapping {
  channelId: ChannelId;
  recommendedNodes: { nodeId: string; confidence: number }[];
  confirmedNodeId?: string;
  confirmedBy?: string;
  confirmedAt?: string;
}

/** A specific product variant. */
export interface Variant {
  variantId: string;
  sku: string;
  attributes: Record<string, string>;
  images: ImageReference[];
  inventory: {
    onHand: number;
    reserved: number;
    available: number;
  };
}

/**
 * Full product detail as returned by the REST API.
 *
 * This is an **API response DTO** — not the canonical domain model and not a persistence
 * model. It is assembled at query time from `CanonicalProduct` (domain) plus enrichment
 * data, compliance reports, and lifecycle history from auxiliary data sources.
 *
 * `Partial<Product>` is used in supplier-intelligence validation (`ValidatedRecord`) as a
 * loose record shape during import validation — this is acceptable since validation operates
 * on incoming data that may not yet have all fields populated.
 *
 * @see {@link file://./marketplace.ts} — `CanonicalProduct` (authoritative domain model)
 */
export interface Product {
  productId: string;
  tenantId: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  attributes: Record<string, string | number | boolean>;
  images: ImageReference[];
  variants: Variant[];
  lifecycleState: LifecycleState;
  lifecycleHistory: LifecycleTransition[];
  enrichmentLayer: EnrichmentLayer;
  categoryMappings: Partial<Record<ChannelId, CategoryMapping>>;
  complianceReports: Partial<Record<ChannelId, ComplianceReport>>;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** Generic paginated API response wrapper. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/** Query parameters for fetching a paginated product list. */
export interface ProductListParams {
  page?: number;
  pageSize?: number; // default: 50
  search?: string;
  lifecycleState?: LifecycleState;
  sortBy?: 'title' | 'createdAt' | 'updatedAt' | 'lifecycleState';
  sortOrder?: 'asc' | 'desc';
}

/** Payload to approve an AI-enriched attribute. */
export interface ApproveAttributePayload {
  productId: string;
  attributeName: string;
}

/** Payload to override an AI-enriched attribute with a new value. */
export interface OverrideAttributePayload {
  productId: string;
  attributeName: string;
  newValue: string | number | boolean;
}

/** Payload to transition a product to a new lifecycle state. */
export interface TransitionPayload {
  productId: string;
  targetState: LifecycleState;
  reason?: string;
}
