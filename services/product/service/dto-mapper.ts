/**
 * DTO assembly — maps the canonical domain model (+ its enrichment record) into
 * the `Product` / `ProductSummary` API DTOs the frontend consumes.
 *
 * The canonical model (CanonicalProduct) is marketplace-independent and stores
 * only the lossy simplified lifecycle. The enrichment record (stored under the
 * `#ENRICHMENT` sort key) carries the enrichment layer, lifecycle history, and
 * the precise `uiLifecycleState`. This module stitches them into one DTO.
 */

import type {
  CanonicalProduct,
  Product,
  ProductSummary,
  LifecycleState,
  EnrichmentLayer,
  ImageReference,
} from '@merch-os/types';
import type { ProductEnrichmentRecord } from '../repository/types';
import { toDto } from './lifecycle';

/** Empty enrichment layer used when a product has not been synthesised yet. */
function emptyEnrichment(): EnrichmentLayer {
  return {
    attributes: {},
    channelContent: {},
    detectedLanguage: '',
    enrichedAt: '',
  };
}

/**
 * Resolve the precise external lifecycle state for a product. Prefers the stored
 * `uiLifecycleState` from the enrichment record; falls back to mapping the
 * canonical lifecycle (for legacy products that predate enrichment).
 */
export function resolveUiLifecycleState(
  product: CanonicalProduct,
  enrichment: ProductEnrichmentRecord | null
): LifecycleState {
  if (enrichment?.uiLifecycleState) {
    return enrichment.uiLifecycleState;
  }
  return toDto(product.lifecycleState);
}

/**
 * Produce the fullest `CanonicalProduct` for export/validation by merging the
 * AI enrichment layer's attribute VALUES into `content.attributes`.
 *
 * Rationale: category-specific attributes can live in two places — written
 * through to the canonical `content.attributes` (seller/manual/synthesis), or
 * still only in the `#ENRICHMENT` record as `EnrichedAttribute.value` (AI-
 * generated but not yet written through). The canonical/manual values are
 * authoritative, so they WIN: enrichment values only fill keys that are absent
 * (or null/empty) in `content.attributes`. The returned product is otherwise an
 * unmodified copy — this never invents data, only surfaces values the product
 * already holds across its two stored items.
 */
export function mergeEnrichmentIntoCanonical(
  product: CanonicalProduct,
  enrichment: ProductEnrichmentRecord | null
): CanonicalProduct {
  const enrichedAttrs = enrichment?.enrichment?.attributes;
  if (!enrichedAttrs || Object.keys(enrichedAttrs).length === 0) {
    return product;
  }

  const merged: Record<string, string | number | boolean> = {
    ...product.content.attributes,
  };
  for (const [key, attr] of Object.entries(enrichedAttrs)) {
    const existing = merged[key];
    const isAbsent = existing === undefined || existing === null || existing === '';
    if (isAbsent && attr?.value !== undefined && attr.value !== null) {
      merged[key] = attr.value;
    }
  }

  return {
    ...product,
    content: { ...product.content, attributes: merged },
  };
}

/** Map canonical image refs to the DTO ImageReference shape. */
function toImageReferences(product: CanonicalProduct): ImageReference[] {
  return (product.content.imageRefs ?? []).map((ref, index) => ({
    imageId: ref.imageId,
    s3Key: ref.s3Key,
    channelKeys: {},
    isHero: index === 0,
    isUpscaled: false,
    moderationStatus: 'PENDING' as const,
    uploadedAt: product.createdAt,
  }));
}

/**
 * Assemble the full `Product` API DTO from the canonical product and its
 * optional enrichment record.
 */
export function assembleProductDto(
  product: CanonicalProduct,
  enrichment: ProductEnrichmentRecord | null
): Product {
  const enrichmentLayer = enrichment?.enrichment ?? emptyEnrichment();

  // Attributes DTO is a flat Record of primitives; the canonical content holds
  // the authoritative attribute values.
  const attributes: Record<string, string | number | boolean> = {
    ...product.content.attributes,
  };

  return {
    productId: product.productId,
    tenantId: product.tenantId,
    sku: product.content.sku,
    title: product.content.title,
    description: product.content.longDescription ?? product.content.shortDescription ?? '',
    brand: product.content.brand,
    attributes,
    images: toImageReferences(product),
    variants: [],
    lifecycleState: resolveUiLifecycleState(product, enrichment),
    lifecycleHistory: enrichment?.lifecycleHistory ?? [],
    enrichmentLayer,
    categoryMappings: {},
    complianceReports: {},
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/**
 * Assemble a lightweight `ProductSummary` for list views. Uses the precise UI
 * lifecycle state when an enrichment record is supplied, else the canonical
 * fallback.
 */
export function assembleProductSummary(
  product: CanonicalProduct,
  enrichment: ProductEnrichmentRecord | null
): ProductSummary {
  const heroRef = (product.content.imageRefs ?? [])[0];
  return {
    productId: product.productId,
    tenantId: product.tenantId,
    sku: product.content.sku,
    title: product.content.title,
    thumbnailUrl: heroRef ? heroRef.s3Key : null,
    lifecycleState: resolveUiLifecycleState(product, enrichment),
    updatedAt: product.updatedAt,
  };
}
