import { describe, it, expect } from 'vitest';
import { getRawSchema } from '@merch-os/marketplace-schemas';
import type { CanonicalProduct } from '@merch-os/types';
import { serializeRow, serializeCsv } from '../csv.js';
import { generateExport, columnsForMode } from '../export-engine.js';

function product(overrides: Partial<CanonicalProduct['content']> = {}): CanonicalProduct {
  return {
    productId: 'prod-1',
    tenantId: 'tenant-1',
    content: {
      title: 'Test, Eyewear "Premium"',
      shortDescription: 'sub',
      longDescription: '<p>line1\nline2</p>',
      bulletPoints: [],
      brand: 'Acme',
      manufacturer: null,
      sku: 'SKU-1',
      barcode: null,
      mpn: null,
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      attributes: {
        eyewear_lens_type: 'Clear',
        whats_in_the_box: '1 x glasses',
        is_polarised: 'Yes',
        'merchant_packaged_dimensions.width': 10,
        'merchant_packaged_dimensions.length': 15,
        'merchant_packaged_dimensions.height': 5,
        'merchant_packaged_weight.value': 200,
        materials: 'Cellulose Acetate Butyrate',
        eyewear_type: 'Rectangle',
        'warranty.type': 'Limited',
        'warranty.period.value': 6,
      },
      imageRefs: [
        { imageId: 'i1', s3Key: 'k1', position: 0, altText: null, mimeType: 'image/jpeg', width: 1500, height: 1500, fileSize: 1, variantId: null },
        { imageId: 'i2', s3Key: 'k2', position: 1, altText: null, mimeType: 'image/jpeg', width: 1500, height: 1500, fileSize: 1, variantId: null },
      ],
      variants: [],
      ...overrides,
    },
    commercial: {
      sellingPrice: 199, rrp: 249, salePrice: null, currency: 'ZAR', stockQuantity: 7,
      lowStockThreshold: null, fulfilmentMethod: null, leadtimeDays: 3, handlingTimeDays: null,
      listingStatus: 'draft', saleStartDate: null, saleEndDate: null,
    },
    platformSpecific: {
      platformIdentifiers: {},
      categoryMappings: { takealot: 'Accessories->Eyewear (29451)' },
      metadata: {}, exportHistory: {},
    },
    lifecycleState: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('CSV serialization', () => {
  it('quotes fields containing delimiter, quote, or newline; doubles quotes', () => {
    expect(serializeRow(['a', 'b,c', 'd"e', 'f\ng'])).toBe('a,"b,c","d""e","f\ng"');
  });
  it('does not quote plain fields', () => {
    expect(serializeRow(['plain', '123'])).toBe('plain,123');
  });
  it('uses CRLF and a trailing newline', () => {
    const csv = serializeCsv(['h1', 'h2'], [['a', 'b']]);
    expect(csv).toBe('h1,h2\r\na,b\r\n');
  });
  it('respects a custom delimiter', () => {
    expect(serializeRow(['a', 'b'], { delimiter: '\t' })).toBe('a\tb');
  });
});

describe('Export Engine (template 248)', () => {
  const schema = getRawSchema('248')!;

  it('full-create uses the schema full column order', () => {
    const cols = columnsForMode(schema, 'full-create');
    expect(cols).toEqual(schema.columnOrder);
    expect(cols[0]).toBe('Variant.ProductVariant');
  });

  it('inventory-sync uses the minimal stock subset', () => {
    const cols = columnsForMode(schema, 'inventory-sync');
    expect(cols).toEqual(['ProductID.Value', 'SKU', 'StockOnHand']);
  });

  it('generates a full-create CSV with mapped values and correct header', () => {
    const out = generateExport({
      schema,
      mode: 'full-create',
      items: [{ product: product(), mapOptions: { topCategory: 'Women (29434)', category: 'Accessories->Eyewear (29451)' } }],
    });
    expect(out.format).toBe('CSV');
    expect(out.rowCount).toBe(1);
    const [header, row1] = out.content.split('\r\n');
    expect(header.split(',')[0]).toBe('Variant.ProductVariant');
    // The quoted title with comma + embedded quotes must be escaped.
    expect(out.content).toContain('"Test, Eyewear ""Premium"""');
  });

  it('generates an inventory-sync CSV from commercial data', () => {
    const out = generateExport({
      schema,
      mode: 'inventory-sync',
      items: [{ product: product() }],
    });
    expect(out.columns).toEqual(['ProductID.Value', 'SKU', 'StockOnHand']);
    const [header, row] = out.content.trim().split('\r\n');
    expect(header).toBe('ProductID.Value,SKU,StockOnHand');
    expect(row).toBe(',SKU-1,7'); // no barcode, sku SKU-1, stock 7
  });

  it('is deterministic — identical inputs produce byte-identical output', () => {
    const input = {
      schema,
      mode: 'full-create' as const,
      items: [{ product: product(), mapOptions: { topCategory: 'Women (29434)', category: 'Accessories->Eyewear (29451)' } }],
    };
    expect(generateExport(input).content).toBe(generateExport(input).content);
  });

  it('resolves image columns via the imageUrlResolver', () => {
    const out = generateExport({
      schema,
      mode: 'full-create',
      items: [{ product: product(), mapOptions: { imageUrlResolver: (k) => `https://cdn/${k}` } }],
    });
    expect(out.content).toContain('https://cdn/k1');
    expect(out.content).toContain('https://cdn/k2');
  });
});
