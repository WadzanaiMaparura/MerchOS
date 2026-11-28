import { describe, it, expect } from 'vitest';
import type { CanonicalProduct } from '@merch-os/types';
import {
  cleanTags,
  dimensionIn,
  isValidGtin,
  paragraphsHtml,
  bulletsHtml,
  pricingFor,
  slugify,
  stockFor,
  sellableUnits,
  weightIn,
  weightInGrams,
  wooList,
} from '../common.js';
import { checkShopify, shopifyBarcode, shopifyHandle, buildShopifyTable, SHOPIFY_COLUMNS } from '../shopify.js';
import { checkWoo, buildWooTable, extraAttributes } from '../woocommerce.js';
import { searchShopifyCategories, shopifyCategoryCount, shopifyCategoryPath } from '../shopify-taxonomy.js';
import type { ExportProduct } from '../types.js';

function ep(content: Partial<CanonicalProduct['content']> = {}, commercial: Partial<CanonicalProduct['commercial']> = {}, extra: Partial<ExportProduct> = {}): ExportProduct {
  const product = {
    productId: 'p1',
    tenantId: 't1',
    content: {
      title: 'Ceramic Mug',
      shortDescription: null,
      longDescription: 'A mug.',
      bulletPoints: [],
      brand: 'Acme',
      manufacturer: null,
      sku: 'MUG-1',
      barcode: null,
      mpn: null,
      weight: 350,
      weightUnit: 'g',
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      attributes: {},
      imageRefs: [],
      variants: [],
      ...content,
    },
    commercial: {
      sellingPrice: 100,
      rrp: null,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 5,
      lowStockThreshold: null,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'active',
      saleStartDate: null,
      saleEndDate: null,
      ...commercial,
    },
    platformSpecific: { platformIdentifiers: {}, categoryMappings: {}, metadata: {}, exportHistory: {} },
    lifecycleState: 'ready',
    createdAt: '',
    updatedAt: '',
  } as CanonicalProduct;
  return {
    product,
    attributes: {},
    keywords: [],
    categoryPath: null,
    stockBySku: {},
    images: [{ url: 'https://cdn.example/x.jpg', alt: '', variantId: null }],
    ...extra,
  };
}

const shopifyOpts = { status: 'draft' as const, useRrpAsCompareAt: false, today: '2026-11-28' };
const wooOpts = { status: 'draft' as const, weightUnit: 'kg' as const, dimensionUnit: 'cm' as const, useRrpAsCompareAt: false, today: '2026-11-28' };
const codes = (f: { code: string }[]) => f.map((x) => x.code);

describe('barcodes', () => {
  it('checks GTIN check digits (the sample 6001234567890 is wrong; ...9 is right)', () => {
    expect(isValidGtin('6001234567890')).toBe(false);
    expect(isValidGtin('6001234567899')).toBe(true);
    expect(isValidGtin('012345678905')).toBe(true); // UPC-A
    expect(isValidGtin('ABC')).toBe(false);
  });
  it('labels only valid GTINs, and escapes Shopify separators in plain barcodes', () => {
    expect(shopifyBarcode('6001234567899')).toBe('gtin:6001234567899');
    expect(shopifyBarcode('6001234567890')).toBe('6001234567890');
    expect(shopifyBarcode('INT;1:2\\3')).toBe('INT\\;1\\:2\\\\3');
    expect(shopifyBarcode(null)).toBe('');
  });
  it('warns (never blocks) on a wrong check digit', () => {
    const f = checkShopify(ep({ barcode: '6001234567890' }), shopifyOpts);
    expect(f.find((x) => x.code === 'BARCODE_NOT_GTIN')?.severity).toBe('WARNING');
  });
});

describe('prices and sales', () => {
  it('a sale with no dates is on; Shopify price = sale, compare-at = normal price', () => {
    const p = ep({}, { sellingPrice: 149, salePrice: 129 });
    const row = buildShopifyTable([p], shopifyOpts).rows[0]!;
    expect(row[SHOPIFY_COLUMNS.indexOf('Price')]).toBe('129.00');
    expect(row[SHOPIFY_COLUMNS.indexOf('Compare-at price')]).toBe('149.00');
  });
  it('a future sale is not exported to Shopify (it cannot be scheduled) and is warned about', () => {
    const p = ep({}, { sellingPrice: 149, salePrice: 129, saleStartDate: '2026-12-01T00:00:00Z' });
    const row = buildShopifyTable([p], shopifyOpts).rows[0]!;
    expect(row[SHOPIFY_COLUMNS.indexOf('Price')]).toBe('149.00');
    expect(row[SHOPIFY_COLUMNS.indexOf('Compare-at price')]).toBe('');
    expect(codes(checkShopify(p, shopifyOpts))).toContain('SALE_NOT_ACTIVE');
  });
  it('WooCommerce gets the sale with its dates', () => {
    const p = ep({}, { sellingPrice: 149, salePrice: 129, saleStartDate: '2026-12-01', saleEndDate: '2026-12-24' });
    const t = buildWooTable([p], wooOpts);
    const cell = (c: string) => t.rows[0]![t.columns.indexOf(c)];
    expect([cell('Regular price'), cell('Sale price'), cell('Date sale price starts'), cell('Date sale price ends')]).toEqual(['149.00', '129.00', '2026-12-01', '2026-12-24']);
  });
  it('a sale price that is not lower is ignored', () => {
    expect(pricingFor(ep({}, { sellingPrice: 100, salePrice: 120 }), null, shopifyOpts).sale).toBeNull();
  });
  it('RRP is the was-price only when the seller ticks it, and only when higher', () => {
    const p = ep({}, { sellingPrice: 100, rrp: 130 });
    expect(pricingFor(p, null, shopifyOpts).rrpAsWas).toBeNull();
    expect(pricingFor(p, null, { ...shopifyOpts, useRrpAsCompareAt: true }).rrpAsWas).toBe(130);
    expect(pricingFor(ep({}, { sellingPrice: 100, rrp: 90 }), null, { ...shopifyOpts, useRrpAsCompareAt: true }).rrpAsWas).toBeNull();
  });
  it('no price is an error for Shopify (it would list at R0.00), a warning for WooCommerce', () => {
    const p = ep({}, { sellingPrice: null });
    expect(checkShopify(p, shopifyOpts).find((f) => f.code === 'PRICE_MISSING')?.severity).toBe('ERROR');
    expect(checkWoo(p, wooOpts).find((f) => f.code === 'PRICE_MISSING')?.severity).toBe('WARNING');
  });
});

describe('stock', () => {
  it('uses Inventory when the SKU has a record, else the product figure', () => {
    const p = ep({}, { stockQuantity: 5 }, { stockBySku: { 'MUG-1': 12 } });
    expect(stockFor(p, sellableUnits(p)[0]!)).toBe(12);
    expect(stockFor(ep(), sellableUnits(ep())[0]!)).toBe(5);
  });
  it('never copies the product figure onto variants', () => {
    const p = ep({ variants: [{ variantId: 'v1', sku: 'MUG-1-R', barcode: null, optionValues: { Colour: 'Red' }, priceOverride: null, stockOverride: null, imageRefs: [] }] });
    expect(stockFor(p, sellableUnits(p)[0]!)).toBeNull();
  });
});

describe('units', () => {
  it('converts weight to whole grams for Shopify and the store unit for WooCommerce', () => {
    expect(weightInGrams(ep({ weight: 0.35, weightUnit: 'kg' }))).toBe(350);
    expect(weightIn(ep({ weight: 350, weightUnit: 'g' }), 'kg')).toBe('0.35');
    expect(weightIn(ep({ weight: 1, weightUnit: 'lb' }), 'g')).toBe('453.592');
    expect(weightIn(ep({ weight: null }), 'kg')).toBe('');
  });
  it('converts dimensions', () => {
    expect(dimensionIn(ep({ length: 12, dimensionUnit: 'cm' }), 'length', 'mm')).toBe('120');
    expect(dimensionIn(ep({ length: 10, dimensionUnit: 'in' }), 'length', 'cm')).toBe('25.4');
  });
  it('warns when there is no weight (weight-based shipping)', () => {
    expect(codes(checkShopify(ep({ weight: null }), shopifyOpts))).toContain('WEIGHT_MISSING');
  });
});

describe('text', () => {
  it('turns plain text into safe HTML paragraphs and lists', () => {
    expect(paragraphsHtml('One <b>\n\nTwo\nlines')).toBe('<p>One &lt;b&gt;</p><p>Two<br>lines</p>');
    expect(bulletsHtml(['A & B', ' '])).toBe('<ul><li>A &amp; B</li></ul>');
  });
  it('makes Shopify handles (letters, numbers, dashes) and keeps a remembered one', () => {
    expect(slugify('Café Mug & Saucer 350ml!')).toBe('cafe-mug-and-saucer-350ml');
    const p = ep();
    p.product.platformSpecific.platformIdentifiers = { shopify: 'old-handle' };
    expect(shopifyHandle(p)).toBe('old-handle');
  });
  it('makes handles unique within one file', () => {
    expect(buildShopifyTable([ep(), ep()], shopifyOpts).handles).toEqual(['ceramic-mug', 'ceramic-mug-2']);
  });
  it('cleans tags and escapes commas in WooCommerce lists', () => {
    expect(cleanTags(['Mug!', 'mug', 'Café', ' '])).toEqual(['Mug', 'Cafe']);
    expect(wooList(['a,b', 'c'])).toBe('a\\,b, c');
  });
});

describe('variants', () => {
  const v = (id: string, o: Record<string, string>) => ({ variantId: id, sku: `S-${id}`, barcode: null, optionValues: o, priceOverride: null, stockOverride: null, imageRefs: [] });
  it('blocks more than 3 options and duplicate option combinations', () => {
    const four = ep({ variants: [v('a', { A: '1', B: '1', C: '1', D: '1' })] });
    expect(codes(checkShopify(four, shopifyOpts))).toContain('TOO_MANY_OPTIONS');
    const dup = ep({ variants: [v('a', { Size: 'S' }), v('b', { Size: 'S' })] });
    expect(codes(checkShopify(dup, shopifyOpts))).toContain('DUPLICATE_VARIANT');
    expect(codes(checkWoo(dup, wooOpts))).toContain('DUPLICATE_VARIANT');
  });
  it('WooCommerce variations need their own SKU, different from the parent', () => {
    const p = ep({ variants: [{ ...v('a', { Size: 'S' }), sku: '' }, { ...v('b', { Size: 'M' }), sku: 'MUG-1' }] });
    expect(codes(checkWoo(p, wooOpts))).toEqual(expect.arrayContaining(['VARIANT_SKU_MISSING', 'VARIANT_SKU_DUPLICATE']));
  });
});

describe('WooCommerce extras', () => {
  it('adds approved product attributes to single products, never MerchOS content keys', () => {
    const p = ep({}, {}, { attributes: { capacity_ml: '350', keywords: 'a, b', category: 'tklot-1', categoryPath: 'X > Y', material: 'Ceramic' } });
    expect(extraAttributes(p)).toEqual([['Capacity ml', '350'], ['Material', 'Ceramic']]);
  });
  it('drafts unless the seller chooses published', () => {
    const t = buildWooTable([ep()], wooOpts);
    expect(t.rows[0]![t.columns.indexOf('Published')]).toBe('-1');
  });
});

describe('Shopify categories (bundled official list)', () => {
  it('has the released list, with the template categories', () => {
    expect(shopifyCategoryCount()).toBeGreaterThan(10000);
    expect(shopifyCategoryPath('hg-11-10-5-5')).toBe('Home & Garden > Kitchen & Dining > Tableware > Drinkware > Mugs');
    expect(shopifyCategoryPath('gid://shopify/TaxonomyCategory/aa-1-13-8')).toBe('Apparel & Accessories > Clothing > Clothing Tops > T-Shirts');
    expect(shopifyCategoryPath('made-up')).toBeUndefined();
  });
  it('search puts the category itself first', () => {
    expect(searchShopifyCategories('mugs')[0]?.id).toBe('hg-11-10-5-5');
    expect(searchShopifyCategories('t shirts clothing tops')[0]?.id).toBe('aa-1-13-8');
    expect(searchShopifyCategories('')).toEqual([]);
    // No category has both words: the best partial match still comes back.
    expect(searchShopifyCategories('coffee mug')[0]?.id).toBe('hg-11-10-5-5');
  });
  it('an unknown saved category blocks the product', () => {
    const p = ep();
    p.product.platformSpecific.categoryMappings = { shopify: 'nope-1' };
    expect(codes(checkShopify(p, shopifyOpts))).toContain('CATEGORY_UNKNOWN');
  });
});
