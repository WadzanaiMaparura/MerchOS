/**
 * Validation Engine Lambda — schema validation, type coercion, and price normalisation.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * Responsibilities:
 * - Validate required fields: title (non-empty), sku (non-empty), and at least one of (images[0] or description)
 * - Normalise price strings: strip currency symbols ($, €, £, ¥), remove thousand separators, parse to float
 * - Coerce string values to target types: string → number for price fields, string → date for date fields
 * - Produce a ValidationResult with totalRecords, passed, failed, per-field error counts
 * - Mark failed records as VALIDATION_FAILED with field-level error details
 */

import type { ParsedRecord } from './file-parser';
import type {
  ValidationResult,
  ValidatedRecord,
  FieldError,
  FieldCoercion,
} from '../types/validation.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Currency symbols to strip during price normalisation. */
const CURRENCY_SYMBOLS_RE = /[$€£¥]/g;

// ---------------------------------------------------------------------------
// Price Normalisation (Requirement 6.3)
// ---------------------------------------------------------------------------

/**
 * Normalise a raw price string to a numeric float.
 *
 * Steps:
 * 1. Strip leading/trailing whitespace
 * 2. Remove currency symbols ($, €, £, ¥)
 * 3. Remove thousand separators (commas that appear before groups of 3 digits)
 * 4. Parse the remaining string to float
 *
 * Returns null if the string cannot be parsed as a number after normalisation.
 *
 * The operation is idempotent: normalising an already-normalised numeric string
 * produces the same result.
 *
 * @param raw - Raw price string (e.g. "$1,299.99", "€ 19.99", "1.299,99")
 * @returns Parsed float value or null if unparseable
 */
export function normalisePrice(raw: string): number | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  let cleaned = raw.trim();

  // Strip currency symbols
  cleaned = cleaned.replace(CURRENCY_SYMBOLS_RE, '');

  // Strip thousand separators.
  // Heuristic: if both comma and period are present, the one occurring more than once
  // (or appearing as the last separator before exactly two decimal digits) is likely
  // the decimal separator. We handle the two most common formats:
  //   • 1,299.99 — comma = thousand sep, period = decimal sep (English)
  //   • 1.299,99 — period = thousand sep, comma = decimal sep (European)
  cleaned = cleaned.trim();

  const hasComma = cleaned.includes(',');
  const hasPeriod = cleaned.includes('.');

  if (hasComma && hasPeriod) {
    // Determine which comes last — that one is the decimal separator
    const lastComma = cleaned.lastIndexOf(',');
    const lastPeriod = cleaned.lastIndexOf('.');

    if (lastComma > lastPeriod) {
      // European format: "1.299,99" — period is thousand sep, comma is decimal sep
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // English format: "1,299.99" — comma is thousand sep, period is decimal sep
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (hasComma && !hasPeriod) {
    // Could be "1,299" (thousand sep only) or "1,99" (European decimal)
    const parts = cleaned.split(',');
    const lastPart = parts[parts.length - 1];
    if (parts.length === 2 && lastPart && lastPart.length <= 2) {
      // Likely a decimal comma: "19,99" → "19.99"
      cleaned = cleaned.replace(',', '.');
    } else {
      // Likely a thousand separator: "1,299" → "1299"
      cleaned = cleaned.replace(/,/g, '');
    }
  }
  // If only period — leave as-is (standard decimal notation)

  const value = parseFloat(cleaned);
  return isNaN(value) ? null : value;
}

// ---------------------------------------------------------------------------
// Type Coercion (Requirement 6.2)
// ---------------------------------------------------------------------------

/**
 * Coerce a string value to the specified target type.
 *
 * For 'number': attempts to parse using normalisePrice logic.
 * For 'date': attempts to parse via Date constructor; returns ISO 8601 string on success.
 *
 * Returns the coerced value on success, or undefined on failure.
 *
 * @param value      - The raw string value to coerce
 * @param targetType - The type to coerce to ('number' | 'date')
 * @returns Coerced value (number or ISO date string) or undefined if coercion fails
 */
export function coerceField(
  value: string,
  targetType: 'number' | 'date'
): number | string | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  if (targetType === 'number') {
    const result = normalisePrice(value);
    return result !== null ? result : undefined;
  }

  if (targetType === 'date') {
    // Try the string as-is first (ISO 8601 etc.)
    const parsed = new Date(value.trim());
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }

    // Try common date formats by normalising separators
    // e.g. "12/31/2024", "31-12-2024", "2024.12.31"
    const normalised = value.trim().replace(/[./]/g, '-');
    const parsedNorm = new Date(normalised);
    if (!isNaN(parsedNorm.getTime())) {
      return parsedNorm.toISOString();
    }

    return undefined;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Required Field Validation (Requirement 6.1)
// ---------------------------------------------------------------------------

/**
 * Validate required fields on a single parsed record.
 * Required: title (non-empty), sku (non-empty), and at least one of (images[0] or description).
 *
 * @param record - The parsed product record to validate
 * @returns Array of FieldError objects; empty array means all required fields pass
 */
function validateRequiredFields(record: ParsedRecord): FieldError[] {
  const errors: FieldError[] = [];

  // Validate title
  if (!record.title || record.title.trim() === '') {
    errors.push({
      field: 'title',
      code: 'REQUIRED',
      message: 'Product title is required and must not be empty',
      value: record.title,
    });
  }

  // Validate sku
  if (!record.sku || record.sku.trim() === '') {
    errors.push({
      field: 'sku',
      code: 'REQUIRED',
      message: 'SKU is required and must not be empty',
      value: record.sku,
    });
  }

  // Validate that at least one of (images[0] or description) is present
  const hasImage = Array.isArray(record.images) && record.images.length > 0 && record.images[0] != null && record.images[0].trim() !== '';
  const hasDescription = typeof record.description === 'string' && record.description.trim() !== '';

  if (!hasImage && !hasDescription) {
    errors.push({
      field: 'images_or_description',
      code: 'REQUIRED',
      message: 'At least one of images[0] or description must be provided',
      value: undefined,
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Price Field Coercion
// ---------------------------------------------------------------------------

/**
 * Attempt to coerce the price field of a parsed record to a number.
 * Records a FieldCoercion entry regardless of success.
 *
 * @param record     - The parsed product record
 * @param coercions  - Array to append the FieldCoercion record to
 * @param errors     - Array to append a FieldError if coercion fails
 * @returns Coerced numeric price value or undefined
 */
function coercePriceField(
  record: ParsedRecord,
  coercions: FieldCoercion[],
  errors: FieldError[]
): number | undefined {
  if (!record.price || record.price.trim() === '') {
    // Price is optional — no coercion needed
    return undefined;
  }

  const coerced = coerceField(record.price, 'number');
  const success = coerced !== undefined;

  coercions.push({
    field: 'price',
    originalValue: record.price,
    coercedValue: coerced,
    fromType: 'string',
    toType: 'number',
    success,
  });

  if (!success) {
    errors.push({
      field: 'price',
      code: 'TYPE_MISMATCH',
      message: `Price value "${record.price}" could not be coerced to a number`,
      value: record.price,
    });
  }

  return coerced as number | undefined;
}

// ---------------------------------------------------------------------------
// Single Record Validation
// ---------------------------------------------------------------------------

/**
 * Validate and coerce a single parsed record.
 * Applies required-field checks and type coercions.
 *
 * @param record - The parsed product record to validate
 * @returns A ValidatedRecord with status, errors, and coercions applied
 */
function validateRecord(record: ParsedRecord): ValidatedRecord {
  const errors: FieldError[] = [];
  const coercions: FieldCoercion[] = [];

  // --- Required field validation ---
  const requiredErrors = validateRequiredFields(record);
  errors.push(...requiredErrors);

  // --- Price coercion ---
  const coercedPrice = coercePriceField(record, coercions, errors);

  // --- Build the output product record ---
  const productRecord: Record<string, unknown> = {};

  if (record.title) productRecord['title'] = record.title.trim();
  if (record.sku) productRecord['sku'] = record.sku.trim();
  if (record.description) productRecord['description'] = record.description;
  if (record.brand) productRecord['brand'] = record.brand;
  if (record.category) productRecord['category'] = record.category;
  if (Array.isArray(record.images) && record.images.length > 0) {
    productRecord['images'] = record.images;
  }

  // Use coerced price if available; otherwise keep raw string as-is (will be flagged)
  if (coercedPrice !== undefined) {
    productRecord['price'] = coercedPrice;
  } else if (record.price != null && record.price.trim() !== '') {
    // Keep raw value — the coercion failure is already recorded
    productRecord['price'] = record.price;
  }

  const status = errors.length > 0 ? 'VALIDATION_FAILED' : 'VALID';

  return {
    record: productRecord as ValidatedRecord['record'],
    status,
    errors,
    coercions,
  };
}

// ---------------------------------------------------------------------------
// Batch Validation (Requirement 6.4, 6.5)
// ---------------------------------------------------------------------------

/**
 * Validate a batch of parsed records, applying required-field checks and type coercions.
 *
 * Produces a ValidationResult satisfying:
 *   totalRecords === passed + failed
 *   fieldErrorCounts[field] === sum of errors for that field across all failed records
 *
 * @param records - Array of ParsedRecord objects from the file/image/URL parser
 * @returns ValidationResult with per-record status and aggregate statistics
 */
export function validateRecords(records: ParsedRecord[]): ValidationResult {
  const validatedRecords: ValidatedRecord[] = [];
  let passed = 0;
  let failed = 0;
  const fieldErrorCounts: Record<string, number> = {};

  for (const record of records) {
    const validated = validateRecord(record);
    validatedRecords.push(validated);

    if (validated.status === 'VALID') {
      passed++;
    } else {
      failed++;
      // Tally per-field error counts
      for (const err of validated.errors) {
        fieldErrorCounts[err.field] = (fieldErrorCounts[err.field] ?? 0) + 1;
      }
    }
  }

  return {
    totalRecords: records.length,
    passed,
    failed,
    records: validatedRecords,
    fieldErrorCounts,
  };
}
