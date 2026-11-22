import { describe, it, expect } from 'vitest';
import { buildProductData, isValidGtin } from '../handlers/synthesize-product';

describe('isValidGtin', () => {
  it('accepts real EAN-13 / UPC-A / EAN-8 codes', () => {
    expect(isValidGtin('6001087340663')).toBe(true); // EAN-13
    expect(isValidGtin('036000291452')).toBe(true); // UPC-A
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
  });

  it('rejects a wrong check digit or bad length', () => {
    expect(isValidGtin('6001087340664')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('60010873406AB')).toBe(false);
  });
});

describe('buildProductData', () => {
  it('sends only values the writing service accepts', () => {
    const data = buildProductData({
      title: ' Kettle ',
      description: 'Boil-dry protection, 1 year guarantee',
      shortDescription: null,
      brand: null,
      category: '',
      attributes: { capacity: 1.7, cordless: true, colour: 'Silver', empty: '', none: null },
      images: [{ s3Key: 'tenants/t1/products/p1/a.jpg' }],
      barcode: '6001087340663',
    });
    expect(data).toEqual({
      name: 'Kettle',
      description: 'Boil-dry protection, 1 year guarantee',
      attributes: { capacity: '1.7', cordless: 'true', colour: 'Silver' },
      barcode: '6001087340663',
    });
  });

  it('leaves out an invalid barcode', () => {
    expect(buildProductData({ title: 'X', barcode: '1234567890123' })['barcode']).toBeUndefined();
  });
});
