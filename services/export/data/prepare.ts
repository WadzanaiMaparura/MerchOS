/**
 * Turns a stored product (+ its enrichment record, stock and image links) into
 * the ExportProduct every store adapter reads. Pure.
 *
 * Images: the image pipeline stores one main image (variantId null) plus a
 * resized copy per store, recorded with the STORE name in variantId
 * ("shopify", "takealot", ...). A file for store X gets X's copy when there is
 * one, else the main image; never another store's copy. Refs whose variantId
 * is one of the product's own variants are variant images.
 */

import type { CanonicalImageRef, CanonicalProduct } from '@merch-os/types';
import type { ExportChannel, ExportImage, ExportProduct } from '../channels/types.js';

/** The enrichment record fields the export reads (SK PRODUCT#<id>#ENRICHMENT). */
export interface EnrichmentRecordLike {
  enrichment?: {
    attributes?: Record<string, { value?: unknown } | undefined>;
  };
}

/** Store names the image pipeline may write into imageRefs[].variantId. */
const STORE_IMAGE_TAGS = new Set(['takealot', 'amazon', 'makro', 'shopify', 'woocommerce', 'custom']);

/** Image refs for one store's file (see file comment), in position order. */
export function imageRefsFor(product: CanonicalProduct, channel: ExportChannel): CanonicalImageRef[] {
  const refs = [...(product.content.imageRefs ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const variantIds = new Set((product.content.variants ?? []).map((v) => v.variantId));
  const storeCopies = refs.filter((r) => r.variantId === channel);
  const main = refs.filter((r) => r.variantId === null || r.variantId === undefined);
  const variantImages = [
    ...refs.filter((r) => r.variantId && variantIds.has(r.variantId)),
    ...(product.content.variants ?? []).flatMap((v) =>
      (v.imageRefs ?? []).map((r) => ({ ...r, variantId: v.variantId }))
    ),
  ];
  // Refs tagged with another store (or an unknown tag) are left out.
  const own = storeCopies.length > 0 ? storeCopies : main;
  return [...own.map((r) => ({ ...r, variantId: null })), ...variantImages.filter((r) => !STORE_IMAGE_TAGS.has(String(r.variantId)))];
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** "a, b; c" -> ["a","b","c"]. */
function splitList(v: string | null): string[] {
  return v ? v.split(/[,;|\n]/).map((s) => s.trim()).filter(Boolean) : [];
}

export function toExportProduct(
  product: CanonicalProduct,
  enrichment: EnrichmentRecordLike | null,
  stockBySku: Record<string, number>,
  channel: ExportChannel,
  imageLink: (s3Key: string) => string
): ExportProduct {
  const enriched = enrichment?.enrichment?.attributes ?? {};
  // Values the seller set on the product win; suggestions fill the gaps.
  const attributes: Record<string, string> = {};
  for (const [k, a] of Object.entries(enriched)) {
    const v = text(a?.value);
    if (v) attributes[k] = v;
  }
  for (const [k, v] of Object.entries(product.content.attributes ?? {})) {
    const t = text(v);
    if (t) attributes[k] = t;
  }

  const images: ExportImage[] = imageRefsFor(product, channel).map((r) => ({
    url: imageLink(r.s3Key),
    alt: r.altText ?? '',
    variantId: r.variantId ?? null,
  }));

  return {
    product,
    attributes,
    keywords: splitList(attributes['keywords'] ?? null),
    categoryPath: attributes['categoryPath'] ?? null,
    stockBySku,
    images,
  };
}
