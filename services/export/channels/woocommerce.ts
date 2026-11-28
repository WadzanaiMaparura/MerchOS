/**
 * WooCommerce product CSV adapter (the built-in Product CSV Importer, 3.1+).
 * Reference: https://github.com/woocommerce/woocommerce/wiki/Product-CSV-Import-Schema
 *
 * Layout:
 *   single product   one "simple" row
 *   with variants    one "variable" parent row (all values per attribute, plus
 *                    defaults) and one "variation" row per variant, linked to
 *                    the parent by its SKU ("Parent" column)
 *
 * Weights and sizes are written in the store's own units: WooCommerce copies
 * the numbers as they are, so 0.35 imported into a store set to grams would be
 * 0.35 g. Lists use ", " with commas inside values escaped as "\,".
 * Attributes are created as local (not global) so an import never adds
 * store-wide attributes.
 */

import {
  bulletsHtml,
  cleanTags,
  dimensionIn,
  money,
  optionNames,
  paragraphsHtml,
  pricingFor,
  productImages,
  sellableUnits,
  stockFor,
  variantImage,
  variationName,
  weightIn,
  wooList,
} from './common.js';
import type { ChannelFinding, ChannelTable, ExportProduct, SellableUnit, WooOptions } from './types.js';

/** WooCommerce variable products: at most this many variation attributes in v1. */
const MAX_VARIATION_ATTRIBUTES = 3;
/** Approved product attributes added to single products (visible extras). */
const MAX_EXTRA_ATTRIBUTES = 5;

/** Attribute keys that are MerchOS content, not product facts. */
const NOT_PRODUCT_ATTRIBUTES = new Set([
  'title',
  'description',
  'bullets',
  'brand',
  'category',
  'categorypath',
  'keywords',
  'seotitle',
  'seodescription',
]);

function baseColumns(opts: WooOptions): string[] {
  return [
    'Type',
    'SKU',
    'Name',
    'Published',
    'Short description',
    'Description',
    'Date sale price starts',
    'Date sale price ends',
    'Tax status',
    'Tax class',
    'In stock?',
    'Stock',
    'Backorders allowed?',
    `Weight (${opts.weightUnit})`,
    `Length (${opts.dimensionUnit})`,
    `Width (${opts.dimensionUnit})`,
    `Height (${opts.dimensionUnit})`,
    'Sale price',
    'Regular price',
    'Categories',
    'Tags',
    'Images',
    'Parent',
  ];
}

function attributeColumns(count: number): string[] {
  const out: string[] = [];
  for (let k = 1; k <= count; k++) {
    out.push(`Attribute ${k} name`, `Attribute ${k} value(s)`, `Attribute ${k} visible`, `Attribute ${k} global`, `Attribute ${k} default`);
  }
  return out;
}

/** Approved product attributes worth showing on a single product (name, value). */
export function extraAttributes(p: ExportProduct): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(p.attributes)) {
    if (NOT_PRODUCT_ATTRIBUTES.has(key.toLowerCase().replace(/[^a-z]/g, ''))) continue;
    const v = String(value ?? '').trim();
    if (!v || v.length > 200) continue;
    out.push([labelFor(key), v]);
    if (out.length >= MAX_EXTRA_ATTRIBUTES) break;
  }
  return out;
}

/** "capacity_ml" -> "Capacity ml". */
function labelFor(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** How many attribute column groups this product needs. */
function attributeSlots(p: ExportProduct): number {
  const names = optionNames(p);
  return names.length > 0 ? Math.min(names.length, MAX_VARIATION_ATTRIBUTES) : extraAttributes(p).length;
}

export function checkWoo(p: ExportProduct, opts: WooOptions): ChannelFinding[] {
  const out: ChannelFinding[] = [];
  const c = p.product.content;
  const err = (code: string, field: string, message: string) => out.push({ severity: 'ERROR', code, field, message });
  const warn = (code: string, field: string, message: string) => out.push({ severity: 'WARNING', code, field, message });

  if (!c.title?.trim()) err('TITLE_MISSING', 'Name', 'The product has no name.');
  if (!c.sku?.trim()) err('SKU_MISSING', 'SKU', 'The product has no SKU. WooCommerce links variations to their product by SKU.');

  const names = optionNames(p);
  const hasVariants = (c.variants ?? []).length > 0;
  if (names.length > MAX_VARIATION_ATTRIBUTES) {
    err('TOO_MANY_OPTIONS', 'Variants', `At most ${MAX_VARIATION_ATTRIBUTES} variant options (such as colour and size) can be exported; this product has ${names.length}.`);
  }
  const skus = new Set<string>();
  const combos = new Set<string>();
  for (const unit of sellableUnits(p)) {
    const label = unit.variant ? `Variant ${unit.sku || unit.variant.variantId}` : 'Product';
    if (hasVariants) {
      if (!unit.sku) err('VARIANT_SKU_MISSING', label, 'The variant has no SKU.');
      else if (unit.sku === c.sku || skus.has(unit.sku)) err('VARIANT_SKU_DUPLICATE', label, `The SKU ${unit.sku} is used twice in this product.`);
      skus.add(unit.sku);
      const missing = names.filter((n) => !unit.optionValues[n]);
      if (missing.length) err('OPTION_VALUE_MISSING', label, `No value for ${missing.join(', ')}.`);
      const key = names.map((n) => unit.optionValues[n] ?? '').join('|');
      if (combos.has(key)) err('DUPLICATE_VARIANT', label, 'Another variant has the same options.');
      combos.add(key);
    }
    const price = pricingFor(p, unit.variant, opts);
    if (price.regular == null) warn('PRICE_MISSING', label, 'There is no selling price, so customers cannot buy it until a price is set in WooCommerce.');
  }
  if (productImages(p).length === 0) warn('NO_IMAGES', 'Images', 'The product has no images.');
  if (!(p.product.platformSpecific?.categoryMappings?.woocommerce || p.categoryPath)) {
    warn('CATEGORY_MISSING', 'Categories', 'No category, so WooCommerce will put it in "Uncategorized".');
  }
  return out;
}

interface RowCells {
  [column: string]: string;
}

function stockCells(p: ExportProduct, unit: SellableUnit, cell: RowCells): void {
  const stock = stockFor(p, unit);
  if (stock == null) {
    cell['In stock?'] = '1';
    return;
  }
  const n = Math.max(0, Math.floor(stock));
  cell['Stock'] = String(n);
  cell['In stock?'] = n > 0 ? '1' : '0';
  cell['Backorders allowed?'] = '0';
}

function priceCells(p: ExportProduct, unit: SellableUnit, opts: WooOptions, cell: RowCells): void {
  const price = pricingFor(p, unit.variant, opts);
  if (price.sale != null) {
    cell['Regular price'] = money(price.regular);
    cell['Sale price'] = money(price.sale);
    cell['Date sale price starts'] = price.saleStart ?? '';
    cell['Date sale price ends'] = price.saleEnd ?? '';
  } else if (price.rrpAsWas != null) {
    // RRP shown as the was-price: WooCommerce shows "regular" struck through.
    cell['Regular price'] = money(price.rrpAsWas);
    cell['Sale price'] = money(price.regular);
  } else {
    cell['Regular price'] = money(price.regular);
  }
}

function sizeCells(p: ExportProduct, opts: WooOptions, cell: RowCells): void {
  cell[`Weight (${opts.weightUnit})`] = weightIn(p, opts.weightUnit);
  cell[`Length (${opts.dimensionUnit})`] = dimensionIn(p, 'length', opts.dimensionUnit);
  cell[`Width (${opts.dimensionUnit})`] = dimensionIn(p, 'width', opts.dimensionUnit);
  cell[`Height (${opts.dimensionUnit})`] = dimensionIn(p, 'height', opts.dimensionUnit);
}

function categoryCell(p: ExportProduct): string {
  const chosen = p.product.platformSpecific?.categoryMappings?.woocommerce || p.categoryPath || '';
  // One category path; ">" marks the hierarchy. Escape commas inside names.
  return chosen
    .split('>')
    .map((s) => s.trim().replace(/,/g, '\\,'))
    .filter(Boolean)
    .join(' > ');
}

/** Rows for one product (cells keyed by column name). */
export function wooRows(p: ExportProduct, opts: WooOptions): RowCells[] {
  const c = p.product.content;
  const names = optionNames(p).slice(0, MAX_VARIATION_ATTRIBUTES);
  const images = productImages(p);
  const shared: RowCells = {
    Name: c.title ?? '',
    'Short description': c.shortDescription ? paragraphsHtml(c.shortDescription) : bulletsHtml(c.bulletPoints),
    Description: paragraphsHtml(c.longDescription),
    'Tax status': 'taxable',
    Categories: categoryCell(p),
    Tags: wooList(cleanTags(p.keywords)),
    Images: images.map((i) => i.url).join(', '),
  };
  const published = opts.status === 'published' ? '1' : '-1';

  if ((c.variants ?? []).length === 0) {
    const unit = sellableUnits(p)[0]!;
    const cell: RowCells = { ...shared, Type: 'simple', SKU: c.sku ?? '', Published: published };
    stockCells(p, unit, cell);
    priceCells(p, unit, opts, cell);
    sizeCells(p, opts, cell);
    extraAttributes(p).forEach(([name, value], i) => {
      const k = i + 1;
      cell[`Attribute ${k} name`] = name;
      cell[`Attribute ${k} value(s)`] = value.replace(/,/g, '\\,');
      cell[`Attribute ${k} visible`] = '1';
      cell[`Attribute ${k} global`] = '0';
    });
    return [cell];
  }

  const units = sellableUnits(p);
  // Weight and size go on each variation (WooCommerce ships the variation).
  const parent: RowCells = { ...shared, Type: 'variable', SKU: c.sku ?? '', Published: published, 'In stock?': '1' };
  names.forEach((n, i) => {
    const k = i + 1;
    const values: string[] = [];
    for (const u of units) {
      const v = u.optionValues[n];
      if (v && !values.includes(v)) values.push(v);
    }
    parent[`Attribute ${k} name`] = n;
    parent[`Attribute ${k} value(s)`] = wooList(values);
    parent[`Attribute ${k} visible`] = '1';
    parent[`Attribute ${k} global`] = '0';
    parent[`Attribute ${k} default`] = units[0]!.optionValues[n] ?? '';
  });

  const rows: RowCells[] = [parent];
  for (const unit of units) {
    const cell: RowCells = {
      Type: 'variation',
      SKU: unit.sku,
      Name: variationName(c.title ?? '', unit, names),
      Published: '1',
      'Tax status': 'taxable',
      'Tax class': 'parent',
      Parent: c.sku ?? '',
      Images: variantImage(p, unit.variant)?.url ?? '',
    };
    stockCells(p, unit, cell);
    priceCells(p, unit, opts, cell);
    sizeCells(p, opts, cell);
    names.forEach((n, i) => {
      const k = i + 1;
      cell[`Attribute ${k} name`] = n;
      cell[`Attribute ${k} value(s)`] = (unit.optionValues[n] ?? '').replace(/,/g, '\\,');
      cell[`Attribute ${k} global`] = '0';
    });
    rows.push(cell);
  }
  return rows;
}

/** Builds the whole WooCommerce table. Attribute columns fit the widest product. */
export function buildWooTable(products: ReadonlyArray<ExportProduct>, opts: WooOptions): ChannelTable {
  const slots = products.reduce((m, p) => Math.max(m, attributeSlots(p)), 0);
  const columns = [...baseColumns(opts), ...attributeColumns(slots)];
  const rows: string[][] = [];
  for (const p of products) {
    for (const cell of wooRows(p, opts)) rows.push(columns.map((col) => cell[col] ?? ''));
  }
  return { columns, rows };
}
