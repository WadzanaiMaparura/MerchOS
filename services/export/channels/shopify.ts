/**
 * Shopify product CSV adapter (Shopify's current product CSV format, with the
 * plural "Barcodes" column). Reference:
 * https://help.shopify.com/en/manual/products/import-export/using-csv
 *
 * Layout per product (rows share the URL handle):
 *   row 1        product fields + first variant + first product image
 *   rows 2..n    further variants and/or further product images
 * Option names are only on the first row; option values on every variant row.
 *
 * Columns MerchOS has no data for (cost per item, gift card, fulfilment
 * service, SEO) are left OUT of the file: on a re-import Shopify wipes a value
 * whose column is present but blank, and keeps it when the column is absent.
 */

import {
  bulletsHtml,
  cleanBarcode,
  cleanTags,
  isValidGtin,
  money,
  optionNames,
  paragraphsHtml,
  pricingFor,
  productImages,
  sellableUnits,
  slugify,
  stockFor,
  variantImage,
  weightInGrams,
} from './common.js';
import { shopifyCategoryPath } from './shopify-taxonomy.js';
import type { ChannelFinding, ChannelTable, ExportProduct, ShopifyOptions } from './types.js';

export const SHOPIFY_COLUMNS = [
  'Title',
  'URL handle',
  'Description',
  'Vendor',
  'Product category',
  'Type',
  'Tags',
  'Published on online store',
  'Status',
  'SKU',
  'Barcodes',
  'Option1 name',
  'Option1 value',
  'Option2 name',
  'Option2 value',
  'Option3 name',
  'Option3 value',
  'Price',
  'Compare-at price',
  'Charge tax',
  'Inventory tracker',
  'Inventory quantity',
  'Continue selling when out of stock',
  'Weight value (grams)',
  'Weight unit for display',
  'Requires shipping',
  'Product image URL',
  'Image position',
  'Image alt text',
  'Variant image URL',
] as const;

type Column = (typeof SHOPIFY_COLUMNS)[number];

/** Shopify's limit on product options (Option1..Option3). */
const MAX_OPTIONS = 3;

/** Barcodes cell: "gtin:<code>" for a valid GTIN, else the plain value (escaped). */
export function shopifyBarcode(raw: string | null | undefined): string {
  const code = cleanBarcode(raw);
  if (!code) return '';
  if (isValidGtin(code)) return `gtin:${code}`;
  return code.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/:/g, '\\:');
}

/** The product's handle: remembered from an earlier export, else from the title. */
export function shopifyHandle(p: ExportProduct): string {
  const saved = p.product.platformSpecific?.platformIdentifiers?.shopify;
  if (typeof saved === 'string' && saved) return saved;
  return slugify(p.product.content.title || p.product.content.sku || p.product.productId);
}

function displayUnit(p: ExportProduct): string {
  const u = p.product.content.weightUnit;
  return u === 'lb' ? 'lb' : u === 'oz' ? 'oz' : 'kg';
}

function descriptionHtml(p: ExportProduct): string {
  const c = p.product.content;
  return paragraphsHtml(c.longDescription ?? c.shortDescription) + bulletsHtml(c.bulletPoints);
}

/** Checks for one product (file-wide checks such as duplicate SKUs are in the service). */
export function checkShopify(p: ExportProduct, opts: ShopifyOptions): ChannelFinding[] {
  const out: ChannelFinding[] = [];
  const c = p.product.content;
  const err = (code: string, field: string, message: string) => out.push({ severity: 'ERROR', code, field, message });
  const warn = (code: string, field: string, message: string) => out.push({ severity: 'WARNING', code, field, message });

  if (!c.title?.trim()) err('TITLE_MISSING', 'Title', 'The product has no title.');
  if (!shopifyHandle(p)) err('HANDLE_MISSING', 'URL handle', 'A web address cannot be made from this title. Add letters or numbers to the title.');

  const names = optionNames(p);
  if (names.length > MAX_OPTIONS) {
    err('TOO_MANY_OPTIONS', 'Variants', `Shopify allows at most ${MAX_OPTIONS} options (such as colour and size); this product has ${names.length}.`);
  }
  const combos = new Set<string>();
  for (const unit of sellableUnits(p)) {
    const label = unit.variant ? `Variant ${unit.sku || unit.variant.variantId}` : 'Product';
    if (unit.variant) {
      const missing = names.filter((n) => !unit.optionValues[n]);
      if (missing.length) err('OPTION_VALUE_MISSING', label, `No value for ${missing.join(', ')}.`);
      const key = names.map((n) => unit.optionValues[n] ?? '').join('|');
      if (combos.has(key)) err('DUPLICATE_VARIANT', label, 'Another variant has the same options.');
      combos.add(key);
    }
    const price = pricingFor(p, unit.variant, opts);
    if (price.regular == null) err('PRICE_MISSING', label, 'There is no selling price. Shopify would list it at R0.00.');
    const code = cleanBarcode(unit.barcode);
    if (code && /^\d+$/.test(code) && !isValidGtin(code)) {
      warn('BARCODE_NOT_GTIN', label, `The barcode ${code} is not a valid EAN/UPC (its check digit is wrong). It is exported as a plain barcode.`);
    }
  }
  const pr = pricingFor(p, null, opts);
  if (pr.sale != null && !pr.saleActiveToday) {
    warn('SALE_NOT_ACTIVE', 'Sale price', 'The sale is not on today, so the normal price is exported. Shopify cannot schedule a sale from a file.');
  }

  const category = p.product.platformSpecific?.categoryMappings?.shopify;
  if (category && !shopifyCategoryPath(category)) {
    err('CATEGORY_UNKNOWN', 'Product category', 'The chosen Shopify category is not in Shopify\'s category list. Choose it again.');
  }
  if (productImages(p).length === 0) warn('NO_IMAGES', 'Images', 'The product has no images.');
  for (const img of p.images) {
    if (!/^https:\/\//i.test(img.url)) {
      warn('IMAGE_NOT_HTTPS', 'Images', 'An image link is not secure (https), so Shopify may not download it.');
      break;
    }
  }
  if (weightInGrams(p) == null) warn('WEIGHT_MISSING', 'Weight', 'There is no weight, so shipping rates by weight will not work.');
  return out;
}

/** The rows for one product (aligned to SHOPIFY_COLUMNS). */
export function shopifyRows(p: ExportProduct, opts: ShopifyOptions, handle: string): string[][] {
  const c = p.product.content;
  const names = optionNames(p).slice(0, MAX_OPTIONS);
  const units = sellableUnits(p);
  const images = productImages(p);
  const grams = weightInGrams(p);
  const category = p.product.platformSpecific?.categoryMappings?.shopify;
  const categoryPath = category ? shopifyCategoryPath(category) ?? '' : '';
  const typeLabel = p.categoryPath ? p.categoryPath.split('>').pop()!.trim() : '';

  const rows: string[][] = [];
  const count = Math.max(units.length, images.length, 1);
  for (let i = 0; i < count; i++) {
    const cell: Partial<Record<Column, string>> = { 'URL handle': handle };
    if (i === 0) {
      cell['Title'] = c.title ?? '';
      cell['Description'] = descriptionHtml(p);
      cell['Vendor'] = c.brand ?? '';
      cell['Product category'] = categoryPath;
      cell['Type'] = typeLabel;
      cell['Tags'] = cleanTags(p.keywords).join(', ');
      cell['Published on online store'] = 'true';
      cell['Status'] = opts.status;
    }
    const unit = units[i];
    if (unit) {
      const price = pricingFor(p, unit.variant, opts);
      const current = price.saleActiveToday ? price.sale : price.regular;
      const was = price.saleActiveToday ? price.regular : price.rrpAsWas;
      cell['SKU'] = unit.sku;
      cell['Barcodes'] = shopifyBarcode(unit.barcode);
      if (unit.variant) {
        names.forEach((n, k) => {
          if (i === 0) cell[`Option${k + 1} name` as Column] = n;
          cell[`Option${k + 1} value` as Column] = unit.optionValues[n] ?? '';
        });
      } else {
        cell['Option1 name'] = 'Title';
        cell['Option1 value'] = 'Default Title';
      }
      cell['Price'] = money(current);
      cell['Compare-at price'] = money(was);
      cell['Charge tax'] = 'true';
      const stock = stockFor(p, unit);
      cell['Inventory tracker'] = 'shopify';
      cell['Inventory quantity'] = stock == null ? '' : String(Math.max(0, Math.floor(stock)));
      cell['Continue selling when out of stock'] = 'deny';
      cell['Weight value (grams)'] = grams == null ? '' : String(Math.round(grams));
      cell['Weight unit for display'] = displayUnit(p);
      cell['Requires shipping'] = 'true';
      cell['Variant image URL'] = variantImage(p, unit.variant)?.url ?? '';
    }
    const image = images[i];
    if (image) {
      cell['Product image URL'] = image.url;
      cell['Image position'] = String(i + 1);
      cell['Image alt text'] = (image.alt || c.title || '').slice(0, 512);
    }
    rows.push(SHOPIFY_COLUMNS.map((col) => cell[col] ?? ''));
  }
  return rows;
}

/** Builds the whole Shopify table, with handles unique within the file. */
export function buildShopifyTable(products: ReadonlyArray<ExportProduct>, opts: ShopifyOptions): ChannelTable & { handles: string[] } {
  const used = new Set<string>();
  const handles: string[] = [];
  const rows: string[][] = [];
  for (const p of products) {
    const base = shopifyHandle(p);
    let handle = base;
    for (let n = 2; used.has(handle); n++) handle = `${base}-${n}`;
    used.add(handle);
    handles.push(handle);
    rows.push(...shopifyRows(p, opts, handle));
  }
  return { columns: [...SHOPIFY_COLUMNS], rows, handles };
}
