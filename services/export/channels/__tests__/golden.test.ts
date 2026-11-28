/**
 * Golden tests: the two reviewed templates (a mug with two images; a T-shirt
 * with four colour/size variants) built from MerchOS products must match the
 * templates cell for cell on every column both files have, apart from the
 * deliberate differences listed (and explained) below.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CanonicalProduct } from '@merch-os/types';
import { buildShopifyTable } from '../shopify.js';
import { buildWooTable } from '../woocommerce.js';
import { serializeCsv } from '../../engine/csv.js';
import { assertRectangular, parseCsv } from '../../engine/csv-parse.js';
import type { ExportProduct } from '../types.js';

const fixture = (name: string) => parseCsv(readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
const IMG = 'https://example.com/images';

function product(over: Partial<CanonicalProduct['content']>, commercial: Partial<CanonicalProduct['commercial']>, platform: Partial<CanonicalProduct['platformSpecific']> = {}): CanonicalProduct {
  return {
    productId: `p-${over.sku}`,
    tenantId: 't-1',
    content: {
      title: '',
      shortDescription: null,
      longDescription: null,
      bulletPoints: [],
      brand: 'MerchOS Demo',
      manufacturer: null,
      sku: '',
      barcode: null,
      mpn: null,
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      attributes: {},
      imageRefs: [],
      variants: [],
      ...over,
    },
    commercial: {
      sellingPrice: null,
      rrp: null,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 0,
      lowStockThreshold: null,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'active',
      saleStartDate: null,
      saleEndDate: null,
      ...commercial,
    },
    platformSpecific: { platformIdentifiers: {}, categoryMappings: {}, metadata: {}, exportHistory: {}, ...platform },
    lifecycleState: 'ready',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

const variant = (sku: string, colour: string, size: string) => ({
  variantId: `v-${sku}`,
  sku,
  barcode: null,
  optionValues: { Colour: colour, Size: size },
  priceOverride: null,
  stockOverride: null,
  imageRefs: [],
});

const mug: ExportProduct = {
  product: product(
    {
      title: 'Ceramic Coffee Mug 350ml',
      sku: 'MOS-MUG-001',
      barcode: '6001234567890',
      shortDescription: 'Dishwasher-safe 350ml ceramic mug.',
      longDescription: 'Durable ceramic mug, 350ml, microwave and dishwasher safe.',
      weight: 350,
      weightUnit: 'g',
      length: 12,
      width: 9,
      height: 10,
      dimensionUnit: 'cm',
    },
    { sellingPrice: 149, salePrice: 129, stockQuantity: 50 },
    { categoryMappings: { shopify: 'hg-11-10-5-5', woocommerce: 'Home & Kitchen > Drinkware' } }
  ),
  attributes: { Colour: 'White', category: 'tklot-123' },
  keywords: ['mug', 'ceramic', 'kitchen'],
  categoryPath: 'Kitchen > Mug',
  stockBySku: {},
  images: [
    { url: `${IMG}/mug-front.jpg`, alt: 'White ceramic coffee mug, front view', variantId: null },
    { url: `${IMG}/mug-side.jpg`, alt: 'White ceramic coffee mug, side view', variantId: null },
  ],
};

const tee: ExportProduct = {
  product: product(
    {
      title: 'Cotton Crew T-Shirt',
      sku: 'MOS-TEE-001',
      shortDescription: '100% cotton crew-neck tee.',
      longDescription: 'Soft 100% cotton crew-neck T-shirt.',
      weight: 0.2,
      weightUnit: 'kg',
      variants: [
        variant('MOS-TEE-001-BLA-S', 'Black', 'S'),
        variant('MOS-TEE-001-BLA-M', 'Black', 'M'),
        variant('MOS-TEE-001-WHI-S', 'White', 'S'),
        variant('MOS-TEE-001-WHI-M', 'White', 'M'),
      ],
    },
    { sellingPrice: 249 },
    { categoryMappings: { shopify: 'aa-1-13-8', woocommerce: 'Clothing > T-Shirts' } }
  ),
  attributes: {},
  keywords: ['t-shirt', 'cotton'],
  categoryPath: 'Clothing > T-Shirt',
  // Each variant's own stock from Inventory (never the product figure copied).
  stockBySku: { 'MOS-TEE-001-BLA-S': 20, 'MOS-TEE-001-BLA-M': 20, 'MOS-TEE-001-WHI-S': 20, 'MOS-TEE-001-WHI-M': 20 },
  images: [
    { url: `${IMG}/tee-main.jpg`, alt: 'Cotton crew T-shirt', variantId: null },
    { url: `${IMG}/tee-black.jpg`, alt: '', variantId: 'v-MOS-TEE-001-BLA-S' },
    { url: `${IMG}/tee-black.jpg`, alt: '', variantId: 'v-MOS-TEE-001-BLA-M' },
    { url: `${IMG}/tee-white.jpg`, alt: '', variantId: 'v-MOS-TEE-001-WHI-S' },
    { url: `${IMG}/tee-white.jpg`, alt: '', variantId: 'v-MOS-TEE-001-WHI-M' },
  ],
};

type Diff = { row: number; column: string; ours: string; template: string };

/** Cells that differ on the columns both files share (rows 1-based, data only). */
function differences(template: string[][], ours: string[][]): Diff[] {
  const [th, ...trows] = template;
  const [oh, ...orows] = ours;
  expect(orows.length).toBe(trows.length);
  const shared = th!.filter((c) => oh!.includes(c));
  const out: Diff[] = [];
  trows.forEach((trow, r) => {
    for (const col of shared) {
      const t = trow[th!.indexOf(col)] ?? '';
      const o = orows[r]![oh!.indexOf(col)] ?? '';
      if (t !== o) out.push({ row: r + 1, column: col, ours: o, template: t });
    }
  });
  return out;
}

describe('Shopify golden file', () => {
  const table = buildShopifyTable([mug, tee], { status: 'active', useRrpAsCompareAt: false, today: '2026-11-28' });
  const csv = serializeCsv(table.columns, table.rows);
  const ours = parseCsv(csv);

  it('is a well-formed CSV (every row has every column)', () => {
    expect(() => assertRectangular(ours)).not.toThrow();
    expect(ours).toHaveLength(7);
  });

  it('matches the reviewed template except the corrected barcode', () => {
    expect(differences(fixture('shopify-product-import-template.csv'), ours)).toEqual([
      // The template's barcode fails the GTIN check digit (should end in 9), so
      // it is exported as a plain barcode instead of being labelled gtin:.
      { row: 1, column: 'Barcodes', ours: '6001234567890', template: 'gtin:6001234567890' },
    ]);
  });

  it('leaves out the columns MerchOS has no data for (a blank column would wipe Shopify data on re-import)', () => {
    for (const col of ['Cost per item', 'Fulfillment service', 'Gift card', 'SEO title', 'SEO description']) {
      expect(table.columns).not.toContain(col);
    }
  });
});

describe('WooCommerce golden file', () => {
  const table = buildWooTable([mug, tee], {
    status: 'published',
    weightUnit: 'kg',
    dimensionUnit: 'cm',
    useRrpAsCompareAt: false,
    today: '2026-11-28',
  });
  const ours = parseCsv(serializeCsv(table.columns, table.rows));

  it('is a well-formed CSV', () => {
    expect(() => assertRectangular(ours)).not.toThrow();
    expect(ours).toHaveLength(7);
  });

  it('matches the reviewed template except the deliberate differences', () => {
    const d = differences(fixture('woocommerce-product-import-template.csv'), ours);
    expect(d).toEqual([
      // Short descriptions are HTML in WooCommerce; MerchOS always writes paragraphs.
      { row: 1, column: 'Short description', ours: '<p>Dishwasher-safe 350ml ceramic mug.</p>', template: 'Dishwasher-safe 350ml ceramic mug.' },
      // Attributes are created local (global 0) so an import never adds store-wide attributes.
      { row: 1, column: 'Attribute 1 global', ours: '0', template: '1' },
      { row: 2, column: 'Short description', ours: '<p>100% cotton crew-neck tee.</p>', template: '100% cotton crew-neck tee.' },
      // The parent row carries no stock settings; each variation has its own.
      { row: 2, column: 'Backorders allowed?', ours: '', template: '0' },
      { row: 2, column: 'Attribute 1 global', ours: '0', template: '1' },
      { row: 2, column: 'Attribute 2 global', ours: '0', template: '1' },
      // Defaults are the first variant's values (Black, S); the template picked M.
      { row: 2, column: 'Attribute 2 default', ours: 'S', template: 'M' },
      ...[3, 4, 5, 6].flatMap((row) => [
        { row, column: 'Attribute 1 global', ours: '0', template: '1' },
        { row, column: 'Attribute 2 global', ours: '0', template: '1' },
      ]),
    ]);
  });

  it('uses the store units in the headers', () => {
    const g = buildWooTable([mug], { status: 'draft', weightUnit: 'g', dimensionUnit: 'mm', useRrpAsCompareAt: false, today: '2026-11-28' });
    const row = g.rows[0]!;
    expect(row[g.columns.indexOf('Weight (g)')]).toBe('350');
    expect(row[g.columns.indexOf('Length (mm)')]).toBe('120');
    expect(row[g.columns.indexOf('Published')]).toBe('-1');
  });
});
