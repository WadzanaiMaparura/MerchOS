import { describe, it, expect } from 'vitest';
import { getRawSchema } from '@merch-os/marketplace-schemas';
import type { CanonicalProduct } from '@merch-os/types';
import { validate, isValidGtin } from '../validation-engine.js';
import { mapCanonicalToTakealot } from '../canonical-to-takealot.js';

/** A minimal but valid eyewear product (mirrors real template-248 accepted data). */
function baseProduct(overrides: Partial<CanonicalProduct['content']> = {}): CanonicalProduct {
  return {
    productId: 'prod-1',
    tenantId: 'tenant-1',
    content: {
      title: 'Light Screen Protection Unisex Premium Eye Glasses',
      shortDescription: 'Premium Blue Light Blocker',
      longDescription: '<p>Blue Light Blocker Lens. UV400 Polycarbonate.</p>',
      bulletPoints: [],
      brand: '', // Takealot allows blank brand (requested in review)
      manufacturer: null,
      sku: '',
      barcode: null, // optional — label assigned by Takealot
      mpn: null,
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: ['Cellulose Acetate Butyrate'],
      // Category attributes required by NODEREQ for Eyewear (node 29451),
      // mirroring a real accepted template-248 product.
      attributes: {
        eyewear_lens_type: 'Clear',
        whats_in_the_box: '1 x Unisex Premium Eye Glasses',
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
        {
          imageId: 'img-1',
          s3Key: 'tenant-1/prod-1/1.jpg',
          position: 0,
          altText: null,
          mimeType: 'image/jpeg',
          width: 1500,
          height: 1500,
          fileSize: 200000,
          variantId: null,
        },
        {
          imageId: 'img-2',
          s3Key: 'tenant-1/prod-1/2.jpg',
          position: 1,
          altText: null,
          mimeType: 'image/jpeg',
          width: 1500,
          height: 1500,
          fileSize: 210000,
          variantId: null,
        },
      ],
      variants: [],
      ...overrides,
    },
    commercial: {
      sellingPrice: 199,
      rrp: 249,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 10,
      lowStockThreshold: null,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'draft',
      saleStartDate: null,
      saleEndDate: null,
    },
    platformSpecific: {
      platformIdentifiers: {},
      categoryMappings: { takealot: 'Accessories->Eyewear (29451)' },
      metadata: {},
      exportHistory: {},
    },
    lifecycleState: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('GTIN check-digit validation', () => {
  it('accepts a valid EAN-13', () => {
    expect(isValidGtin('4006381333931')).toBe(true); // known-valid EAN-13
  });
  it('rejects a bad check digit', () => {
    expect(isValidGtin('4006381333932')).toBe(false);
  });
  it('rejects non-numeric and wrong-length', () => {
    expect(isValidGtin('ABC')).toBe(false);
    expect(isValidGtin('123')).toBe(false);
  });
});

describe('Validation Engine (template 248)', () => {
  const schema = getRawSchema('248')!;

  it('loads the target schema', () => {
    expect(schema).toBeTruthy();
    expect(schema.templateId).toBe('248');
  });

  it('maps canonical core fields onto the Takealot field-map', () => {
    const fieldMap = mapCanonicalToTakealot(baseProduct(), schema, {
      topCategory: 'Women (29434)',
      category: 'Accessories->Eyewear (29451)',
    });
    expect(fieldMap['title']).toContain('Eye Glasses');
    expect(fieldMap['TopCategory']).toBe('Women (29434)');
    expect(fieldMap['Category']).toBe('Accessories->Eyewear (29451)');
    expect(fieldMap['subtitle']).toBe('Premium Blue Light Blocker');
  });

  it('allows export for a structurally valid product (zero ERRORs)', () => {
    const result = validate({
      product: baseProduct(),
      schema,
      topCategory: 'Women (29434)',
      category: 'Accessories->Eyewear (29451)',
    });
    if (!result.exportAllowed) {
      const errs = result.findings.filter((f) => f.severity === 'ERROR');
      throw new Error('Unexpected ERRORs:\n' + errs.map((e) => `  [${e.code}] ${e.message}`).join('\n'));
    }
    expect(result.exportAllowed).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.targetPlatform).toBe('takealot');
  });

  it('blocks export when a required core field (title) is missing', () => {
    const result = validate({
      product: baseProduct({ title: '' }),
      schema,
      topCategory: 'Women (29434)',
      category: 'Accessories->Eyewear (29451)',
    });
    expect(result.exportAllowed).toBe(false);
    expect(result.findings.some((f) => f.code === 'REQUIRED_MISSING' && f.field === 'title')).toBe(true);
  });

  it('flags an invalid barcode check digit as ERROR (but allows blank barcode)', () => {
    const bad = validate({
      product: baseProduct({ barcode: '1234567890123' }),
      schema,
      topCategory: 'Women (29434)',
      category: 'Accessories->Eyewear (29451)',
    });
    expect(bad.findings.some((f) => f.code === 'BARCODE_CHECK_DIGIT')).toBe(true);

    const blank = validate({
      product: baseProduct({ barcode: null }),
      schema,
      topCategory: 'Women (29434)',
      category: 'Accessories->Eyewear (29451)',
    });
    expect(blank.findings.some((f) => f.code === 'BARCODE_CHECK_DIGIT')).toBe(false);
  });

  it('flags non-positive price as ERROR and price>RRP as WARNING', () => {
    const p = baseProduct();
    const zeroPrice = { ...p, commercial: { ...p.commercial, sellingPrice: 0 } };
    const r1 = validate({ product: zeroPrice, schema, category: 'Accessories->Eyewear (29451)' });
    expect(r1.findings.some((f) => f.code === 'PRICE_NON_POSITIVE')).toBe(true);
    expect(r1.exportAllowed).toBe(false);

    const overRrp = { ...p, commercial: { ...p.commercial, sellingPrice: 500, rrp: 249 } };
    const r2 = validate({ product: overRrp, schema, category: 'Accessories->Eyewear (29451)' });
    expect(r2.findings.some((f) => f.code === 'PRICE_EXCEEDS_RRP' && f.severity === 'WARNING')).toBe(true);
  });

  it('warns when the product has no images', () => {
    const result = validate({
      product: baseProduct({ imageRefs: [] }),
      schema,
      category: 'Accessories->Eyewear (29451)',
    });
    expect(result.findings.some((f) => f.code === 'NO_IMAGES')).toBe(true);
  });
});
