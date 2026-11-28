/**
 * Shared rules for the store adapters: prices, stock, units, barcodes,
 * descriptions, handles and tags. Pure and deterministic.
 *
 * Invariant (as for Takealot): never invent data. A value MerchOS does not
 * have is left blank, and anything a store would reject is reported as a
 * finding instead of being silently changed.
 */

import type { CanonicalVariant } from '@merch-os/types';
import type { ExportProduct, SellableUnit } from './types.js';

// ---------------------------------------------------------------------------
// Sellable units (variants, or the product itself)
// ---------------------------------------------------------------------------

/** The product's variants, or one unit for a single product. */
export function sellableUnits(p: ExportProduct): SellableUnit[] {
  const variants = p.product.content.variants ?? [];
  if (variants.length === 0) {
    return [
      {
        variant: null,
        sku: p.product.content.sku ?? '',
        barcode: p.product.content.barcode ?? null,
        optionValues: {},
      },
    ];
  }
  return variants.map((v) => ({
    variant: v,
    sku: v.sku ?? '',
    barcode: v.barcode ?? null,
    optionValues: v.optionValues ?? {},
  }));
}

/** Option names in a stable order: the order they first appear across variants. */
export function optionNames(p: ExportProduct): string[] {
  const names: string[] = [];
  for (const v of p.product.content.variants ?? []) {
    for (const k of Object.keys(v.optionValues ?? {})) if (!names.includes(k)) names.push(k);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * Stock for a unit: Inventory (available, all warehouses) when the SKU has an
 * inventory record; else the variant's own figure; else the product's.
 * Never copies the product figure onto several variants.
 */
export function stockFor(p: ExportProduct, unit: SellableUnit): number | null {
  if (unit.sku && unit.sku in p.stockBySku) return p.stockBySku[unit.sku]!;
  if (unit.variant) return unit.variant.stockOverride ?? null;
  const q = p.product.commercial?.stockQuantity;
  return typeof q === 'number' ? q : null;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export interface Pricing {
  /** Normal selling price. */
  regular: number | null;
  /** Sale price, when set and lower than the regular price. */
  sale: number | null;
  saleStart: string | null;
  saleEnd: string | null;
  /** True when the sale applies on `today`. */
  saleActiveToday: boolean;
  /** RRP, when the seller chose to show it as the was-price and it is higher. */
  rrpAsWas: number | null;
}

/** YYYY-MM-DD part of an ISO date, or null. */
function day(v: string | null | undefined): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

export function pricingFor(
  p: ExportProduct,
  variant: CanonicalVariant | null,
  opts: { useRrpAsCompareAt: boolean; today: string }
): Pricing {
  const c = p.product.commercial;
  const regular = variant?.priceOverride ?? c?.sellingPrice ?? null;
  // A sale price is product-wide; it only applies where it is lower.
  const rawSale = c?.salePrice ?? null;
  const sale = rawSale != null && regular != null && rawSale < regular ? rawSale : null;
  const saleStart = sale != null ? day(c?.saleStartDate) : null;
  const saleEnd = sale != null ? day(c?.saleEndDate) : null;
  const saleActiveToday =
    sale != null && (!saleStart || saleStart <= opts.today) && (!saleEnd || opts.today <= saleEnd);
  const rrp = c?.rrp ?? null;
  const base = saleActiveToday ? sale : regular;
  const rrpAsWas = opts.useRrpAsCompareAt && rrp != null && base != null && rrp > base ? rrp : null;
  return { regular, sale, saleStart, saleEnd, saleActiveToday, rrpAsWas };
}

/** 129 -> "129.00". Blank for no value. */
export function money(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '';
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

const GRAMS_PER: Record<string, number> = { g: 1, kg: 1000, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 };

/** Product weight in grams (exact), or null. */
export function weightInGrams(p: ExportProduct): number | null {
  const w = p.product.content.weight;
  const u = p.product.content.weightUnit;
  if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || !u) return null;
  return w * (GRAMS_PER[u] ?? NaN);
}

/** Weight in a store unit, trimmed to at most 3 decimals ("0.35"). */
export function weightIn(p: ExportProduct, unit: 'kg' | 'g' | 'lbs' | 'oz'): string {
  const g = weightInGrams(p);
  if (g == null || !Number.isFinite(g)) return '';
  return trim(g / GRAMS_PER[unit]!, 3);
}

const MM_PER: Record<string, number> = { mm: 1, cm: 10, m: 1000, in: 25.4, yd: 914.4 };

/** A dimension (length/width/height) in a store unit, or blank. */
export function dimensionIn(
  p: ExportProduct,
  which: 'length' | 'width' | 'height',
  unit: 'cm' | 'm' | 'mm' | 'in' | 'yd'
): string {
  const v = p.product.content[which];
  const u = p.product.content.dimensionUnit;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || !u) return '';
  return trim((v * MM_PER[u]!) / MM_PER[unit]!, 2);
}

function trim(n: number, decimals: number): string {
  return String(Number(n.toFixed(decimals)));
}

// ---------------------------------------------------------------------------
// Barcodes
// ---------------------------------------------------------------------------

/** True for a GTIN-8/12/13/14 with a correct check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Barcode digits-only form, or the trimmed original. */
export function cleanBarcode(v: string | null | undefined): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, '') : '';
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text -> HTML paragraphs (blank line = new paragraph, newline = <br>). */
export function paragraphsHtml(text: string | null | undefined): string {
  if (!text || !text.trim()) return '';
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((para) => `<p>${escapeHtml(para.trim()).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

/** Bullet points -> an HTML list. */
export function bulletsHtml(bullets: ReadonlyArray<string> | undefined): string {
  const items = (bullets ?? []).map((b) => b.trim()).filter(Boolean);
  if (items.length === 0) return '';
  return `<ul>${items.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`;
}

function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/** A Shopify URL handle: letters, numbers and dashes. */
export function slugify(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
    .replace(/-+$/g, '');
}

/** Tags: letters, numbers, spaces and hyphens; unique; at most `max`. */
export function cleanTags(keywords: ReadonlyArray<string>, max = 20): string[] {
  const out: string[] = [];
  for (const k of keywords) {
    const t = stripAccents(k).replace(/[^A-Za-z0-9 -]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** WooCommerce list cells: commas inside a value are escaped as "\,". */
export function wooList(values: ReadonlyArray<string>): string {
  return values.map((v) => v.replace(/,/g, '\\,')).join(', ');
}

/** "Title - Black, S" (WooCommerce variation name). */
export function variationName(title: string, unit: SellableUnit, names: string[]): string {
  const values = names.map((n) => unit.optionValues[n]).filter((v): v is string => !!v);
  return values.length ? `${title} - ${values.join(', ')}` : title;
}

/** Images of the product itself (not tied to a variant), in order. */
export function productImages(p: ExportProduct) {
  return p.images.filter((i) => i.variantId === null);
}

/** The first image tied to a variant, if any. */
export function variantImage(p: ExportProduct, variant: CanonicalVariant | null) {
  if (!variant) return undefined;
  return p.images.find((i) => i.variantId === variant.variantId);
}
