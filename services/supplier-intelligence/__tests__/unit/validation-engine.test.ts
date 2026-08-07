/**
 * Unit tests for the Validation Engine.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
import { describe, it, expect } from 'vitest';
import {
  normalisePrice,
  coerceField,
  validateRecords,
} from '../../processors/validation-engine';
import type { ParsedRecord } from '../../processors/file-parser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ParsedRecord> = {}): ParsedRecord {
  return {
    title: 'Test Product',
    sku: 'SKU001',
    description: 'A great product',
    price: '19.99',
    images: [],
    sourceRowIndex: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalisePrice (Requirement 6.3)
// ---------------------------------------------------------------------------

describe('normalisePrice', () => {
  it('parses a plain numeric string', () => {
    expect(normalisePrice('19.99')).toBe(19.99);
  });

  it('strips USD dollar sign', () => {
    expect(normalisePrice('$19.99')).toBe(19.99);
  });

  it('strips euro sign', () => {
    expect(normalisePrice('€9.99')).toBe(9.99);
  });

  it('strips pound sign', () => {
    expect(normalisePrice('£49.00')).toBe(49.0);
  });

  it('strips yen sign', () => {
    expect(normalisePrice('¥1299')).toBe(1299);
  });

  it('removes English thousand separators (commas before 3-digit groups)', () => {
    expect(normalisePrice('$1,299.99')).toBe(1299.99);
  });

  it('removes multiple thousand separators', () => {
    expect(normalisePrice('$1,000,000.00')).toBe(1000000.0);
  });

  it('handles European format with period as thousand sep and comma as decimal', () => {
    expect(normalisePrice('1.299,99')).toBeCloseTo(1299.99);
  });

  it('handles European decimal comma without thousand separator', () => {
    expect(normalisePrice('19,99')).toBeCloseTo(19.99);
  });

  it('handles integers with no separators', () => {
    expect(normalisePrice('100')).toBe(100);
  });

  it('is idempotent — normalising an already-normalised value returns same result', () => {
    const first = normalisePrice('$1,299.99');
    expect(first).not.toBeNull();
    const second = normalisePrice(String(first));
    expect(second).toBe(first);
  });

  it('returns null for an empty string', () => {
    expect(normalisePrice('')).toBeNull();
  });

  it('returns null for a non-numeric string', () => {
    expect(normalisePrice('not-a-price')).toBeNull();
  });

  it('returns null for a string with only currency symbol', () => {
    expect(normalisePrice('$')).toBeNull();
  });

  it('handles leading/trailing whitespace', () => {
    expect(normalisePrice('  $9.99  ')).toBe(9.99);
  });

  it('handles price with currency symbol and spaces', () => {
    expect(normalisePrice('€ 19.99')).toBe(19.99);
  });
});

// ---------------------------------------------------------------------------
// coerceField (Requirement 6.2)
// ---------------------------------------------------------------------------

describe('coerceField — number', () => {
  it('coerces a plain number string', () => {
    expect(coerceField('42', 'number')).toBe(42);
  });

  it('coerces a decimal string', () => {
    expect(coerceField('19.99', 'number')).toBe(19.99);
  });

  it('coerces a price string with currency symbol', () => {
    expect(coerceField('$1,299.99', 'number')).toBe(1299.99);
  });

  it('returns undefined for a non-numeric string', () => {
    expect(coerceField('abc', 'number')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(coerceField('', 'number')).toBeUndefined();
  });

  it('returns undefined for a whitespace-only string', () => {
    expect(coerceField('   ', 'number')).toBeUndefined();
  });
});

describe('coerceField — date', () => {
  it('coerces an ISO 8601 date string', () => {
    const result = coerceField('2024-01-15', 'date');
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    // Should be a valid ISO date
    expect(new Date(result as string).getFullYear()).toBe(2024);
  });

  it('coerces an ISO 8601 datetime string', () => {
    const result = coerceField('2024-01-15T10:30:00Z', 'date');
    expect(result).toBeDefined();
    expect(new Date(result as string).getFullYear()).toBe(2024);
  });

  it('coerces a slash-delimited date (MM/DD/YYYY)', () => {
    const result = coerceField('01/15/2024', 'date');
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  it('returns undefined for an invalid date string', () => {
    expect(coerceField('not-a-date', 'date')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(coerceField('', 'date')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validateRecords — required field validation (Requirement 6.1, 6.4)
// ---------------------------------------------------------------------------

describe('validateRecords — required fields', () => {
  it('marks a record VALID when title, sku, and description are present', () => {
    const records: ParsedRecord[] = [makeRecord()];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALID');
    expect(result.records[0]!.errors).toHaveLength(0);
  });

  it('marks a record VALID when title, sku, and images[0] are present (no description)', () => {
    const records: ParsedRecord[] = [
      makeRecord({
        description: undefined,
        images: ['https://img.com/product.jpg'],
      }),
    ];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALID');
    expect(result.records[0]!.errors).toHaveLength(0);
  });

  it('marks a record VALIDATION_FAILED when title is missing', () => {
    const records: ParsedRecord[] = [makeRecord({ title: undefined })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    const titleError = result.records[0]!.errors.find((e) => e.field === 'title');
    expect(titleError).toBeDefined();
    expect(titleError!.code).toBe('REQUIRED');
  });

  it('marks a record VALIDATION_FAILED when title is empty string', () => {
    const records: ParsedRecord[] = [makeRecord({ title: '' })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    expect(result.records[0]!.errors.some((e) => e.field === 'title')).toBe(true);
  });

  it('marks a record VALIDATION_FAILED when title is whitespace-only', () => {
    const records: ParsedRecord[] = [makeRecord({ title: '   ' })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    expect(result.records[0]!.errors.some((e) => e.field === 'title')).toBe(true);
  });

  it('marks a record VALIDATION_FAILED when sku is missing', () => {
    const records: ParsedRecord[] = [makeRecord({ sku: undefined })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    const skuError = result.records[0]!.errors.find((e) => e.field === 'sku');
    expect(skuError).toBeDefined();
    expect(skuError!.code).toBe('REQUIRED');
  });

  it('marks a record VALIDATION_FAILED when sku is empty string', () => {
    const records: ParsedRecord[] = [makeRecord({ sku: '' })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    expect(result.records[0]!.errors.some((e) => e.field === 'sku')).toBe(true);
  });

  it('marks a record VALIDATION_FAILED when both images and description are absent', () => {
    const records: ParsedRecord[] = [
      makeRecord({ description: undefined, images: [] }),
    ];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    const mediaError = result.records[0]!.errors.find(
      (e) => e.field === 'images_or_description'
    );
    expect(mediaError).toBeDefined();
    expect(mediaError!.code).toBe('REQUIRED');
  });

  it('marks a record VALIDATION_FAILED when images array is empty and description is empty string', () => {
    const records: ParsedRecord[] = [
      makeRecord({ description: '', images: [] }),
    ];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    expect(
      result.records[0]!.errors.some((e) => e.field === 'images_or_description')
    ).toBe(true);
  });

  it('collects multiple field errors in a single record', () => {
    const records: ParsedRecord[] = [
      makeRecord({ title: '', sku: '', description: undefined, images: [] }),
    ];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    expect(result.records[0]!.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// validateRecords — price coercion (Requirement 6.2, 6.3)
// ---------------------------------------------------------------------------

describe('validateRecords — price coercion', () => {
  it('coerces a valid price string and records a coercion entry', () => {
    const records: ParsedRecord[] = [makeRecord({ price: '$19.99' })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALID');
    const priceCoercion = result.records[0]!.coercions.find((c) => c.field === 'price');
    expect(priceCoercion).toBeDefined();
    expect(priceCoercion!.success).toBe(true);
    expect(priceCoercion!.coercedValue).toBe(19.99);
    expect(priceCoercion!.originalValue).toBe('$19.99');
  });

  it('records a coercion failure and adds a TYPE_MISMATCH error for an invalid price', () => {
    const records: ParsedRecord[] = [makeRecord({ price: 'free' })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALIDATION_FAILED');
    const priceCoercion = result.records[0]!.coercions.find((c) => c.field === 'price');
    expect(priceCoercion).toBeDefined();
    expect(priceCoercion!.success).toBe(false);
    const priceError = result.records[0]!.errors.find((e) => e.field === 'price');
    expect(priceError!.code).toBe('TYPE_MISMATCH');
  });

  it('skips price coercion when price field is absent (price is optional)', () => {
    const records: ParsedRecord[] = [makeRecord({ price: undefined })];
    const result = validateRecords(records);

    expect(result.records[0]!.status).toBe('VALID');
    expect(result.records[0]!.coercions).toHaveLength(0);
  });

  it('stores coerced numeric price on the output record', () => {
    const records: ParsedRecord[] = [makeRecord({ price: '€1.299,99' })];
    const result = validateRecords(records);

    const outputPrice = result.records[0]!.record['price' as keyof typeof result.records[0]['record']];
    expect(typeof outputPrice).toBe('number');
    expect(outputPrice as number).toBeCloseTo(1299.99);
  });
});

// ---------------------------------------------------------------------------
// validateRecords — summary statistics (Requirement 6.5)
// ---------------------------------------------------------------------------

describe('validateRecords — summary statistics', () => {
  it('produces correct totals for a batch with mixed results', () => {
    const records: ParsedRecord[] = [
      makeRecord(), // VALID
      makeRecord({ title: '' }), // VALIDATION_FAILED — missing title
      makeRecord({ sku: '' }), // VALIDATION_FAILED — missing sku
      makeRecord({
        title: 'Another Product',
        sku: 'SKU002',
        images: ['https://img.com/x.jpg'],
        description: undefined,
      }), // VALID — has image instead of description
    ];

    const result = validateRecords(records);

    expect(result.totalRecords).toBe(4);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(2);
    // Invariant: totalRecords === passed + failed
    expect(result.totalRecords).toBe(result.passed + result.failed);
  });

  it('accumulates fieldErrorCounts correctly', () => {
    const records: ParsedRecord[] = [
      makeRecord({ title: '' }), // title error
      makeRecord({ title: '', sku: '' }), // title + sku errors
    ];

    const result = validateRecords(records);

    expect(result.fieldErrorCounts['title']).toBe(2);
    expect(result.fieldErrorCounts['sku']).toBe(1);
  });

  it('returns empty fieldErrorCounts when all records pass', () => {
    const records: ParsedRecord[] = [makeRecord(), makeRecord({ sku: 'SKU002' })];
    const result = validateRecords(records);

    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(Object.keys(result.fieldErrorCounts)).toHaveLength(0);
  });

  it('handles an empty records array', () => {
    const result = validateRecords([]);

    expect(result.totalRecords).toBe(0);
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.records).toHaveLength(0);
    expect(Object.keys(result.fieldErrorCounts)).toHaveLength(0);
  });

  it('totalRecords always equals passed + failed invariant', () => {
    const records: ParsedRecord[] = [
      makeRecord(),
      makeRecord({ title: '' }),
      makeRecord({ sku: '' }),
      makeRecord({ description: undefined, images: [] }),
      makeRecord({ title: '', sku: '', description: undefined, images: [] }),
    ];

    const result = validateRecords(records);

    expect(result.totalRecords).toBe(result.passed + result.failed);
  });

  it('fieldErrorCounts sum equals total individual field errors across all failed records', () => {
    const records: ParsedRecord[] = [
      makeRecord({ title: '' }), // 1 error: title
      makeRecord({ sku: '' }), // 1 error: sku
      makeRecord({ title: '', sku: '' }), // 2 errors: title, sku
      makeRecord({ description: undefined, images: [] }), // 1 error: images_or_description
    ];

    const result = validateRecords(records);

    const countFromFieldErrorCounts = Object.values(result.fieldErrorCounts).reduce(
      (sum, count) => sum + count,
      0
    );

    const countFromRecords = result.records
      .filter((r) => r.status === 'VALIDATION_FAILED')
      .reduce((sum, r) => sum + r.errors.length, 0);

    expect(countFromFieldErrorCounts).toBe(countFromRecords);
  });
});

// ---------------------------------------------------------------------------
// validateRecords — output record structure
// ---------------------------------------------------------------------------

describe('validateRecords — output record structure', () => {
  it('trims whitespace from title and sku on the output record', () => {
    const records: ParsedRecord[] = [
      makeRecord({ title: '  Widget  ', sku: '  SKU001  ' }),
    ];
    const result = validateRecords(records);

    expect(result.records[0]!.record['title' as keyof typeof result.records[0]['record']]).toBe('Widget');
    expect(result.records[0]!.record['sku' as keyof typeof result.records[0]['record']]).toBe('SKU001');
  });

  it('passes through optional fields (brand, category, images)', () => {
    const records: ParsedRecord[] = [
      makeRecord({
        brand: 'Nike',
        category: 'Apparel',
        images: ['https://img.com/p.jpg'],
      }),
    ];
    const result = validateRecords(records);

    const rec = result.records[0]!.record as Record<string, unknown>;
    expect(rec['brand']).toBe('Nike');
    expect(rec['category']).toBe('Apparel');
    expect(rec['images']).toEqual(['https://img.com/p.jpg']);
  });
});
