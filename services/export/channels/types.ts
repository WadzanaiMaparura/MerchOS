/**
 * Store export adapters (Shopify, WooCommerce; Takealot keeps its own schema
 * pipeline). Each store has its own columns, mapping and checks; they all read
 * the same prepared product (one MerchOS record, translated per store).
 */

import type { CanonicalProduct, CanonicalVariant } from '@merch-os/types';

/** Stores a seller can export to from the Exports page. */
export type ExportChannel = 'takealot' | 'shopify' | 'woocommerce';

/** A check result shown to the seller before download. */
export interface ChannelFinding {
  severity: 'ERROR' | 'WARNING';
  /** Stable code (tests, analytics). */
  code: string;
  /** What it is about, in the seller's words (e.g. "Price", "Variant MOS-1-S"). */
  field: string;
  /** Plain message for the seller. */
  message: string;
}

/** A product image ready for a file: a link the store can download. */
export interface ExportImage {
  url: string;
  alt: string;
  /** Variant this image belongs to (null = the product). */
  variantId: string | null;
}

/**
 * One product, loaded on the server and prepared for any store: the stored
 * record plus the pieces that live elsewhere (approved suggestions, stock,
 * image links).
 */
export interface ExportProduct {
  product: CanonicalProduct;
  /** Approved/suggested attributes (enrichment), merged over content.attributes. */
  attributes: Record<string, string>;
  /** Saved keywords (tags). */
  keywords: string[];
  /** Readable MerchOS category path ("Home & Kitchen > Drinkware > Mugs"), if known. */
  categoryPath: string | null;
  /** Available stock per SKU from Inventory (summed over warehouses). */
  stockBySku: Record<string, number>;
  /** Images in position order, already turned into downloadable links. */
  images: ExportImage[];
}

/** Settings for a Shopify file. */
export interface ShopifyOptions {
  /** Status on import. Default draft (the seller reviews before it is live). */
  status: 'draft' | 'active';
  /** Show the RRP as the "compare-at" (was) price. Default false. */
  useRrpAsCompareAt: boolean;
  /** Export day (YYYY-MM-DD, South Africa), for active-sale checks. */
  today: string;
}

/** Settings for a WooCommerce file. */
export interface WooOptions {
  /** Status on import. Default draft. */
  status: 'draft' | 'published';
  /** The store's weight unit (WooCommerce > Settings > Products). */
  weightUnit: 'kg' | 'g' | 'lbs' | 'oz';
  /** The store's dimension unit. */
  dimensionUnit: 'cm' | 'm' | 'mm' | 'in' | 'yd';
  useRrpAsCompareAt: boolean;
  today: string;
}

/** The sellable units of a product: its variants, or the product itself. */
export interface SellableUnit {
  variant: CanonicalVariant | null;
  sku: string;
  barcode: string | null;
  optionValues: Record<string, string>;
}

/** A built file before CSV serialisation. */
export interface ChannelTable {
  columns: string[];
  rows: string[][];
}

/** Template versions written into the export history (formats change over time). */
export const TEMPLATE_VERSIONS: Record<ExportChannel, string> = {
  takealot: 'takealot-loadsheet@bundled',
  shopify: 'shopify-product-csv@2026-11',
  woocommerce: 'woocommerce-product-csv@3.1',
};
