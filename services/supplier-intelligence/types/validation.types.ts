/**
 * Validation Engine types — schema validation, type coercion, and error reporting.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { Product } from '@merch-os/types';

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

/**
 * Overall validation result for a batch of extracted product records.
 * Satisfies the invariant: totalRecords === passed + failed.
 */
export interface ValidationResult {
  totalRecords: number;
  passed: number;
  failed: number;
  records: ValidatedRecord[];
  /** Count of errors per field name across all failed records */
  fieldErrorCounts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Validated Record
// ---------------------------------------------------------------------------

/** Validation status for an individual record. */
export type ValidationStatus = 'VALID' | 'VALIDATION_FAILED';

/**
 * A single product record after validation, including any errors and coercions applied.
 */
export interface ValidatedRecord {
  record: Partial<Product>;
  status: ValidationStatus;
  errors: FieldError[];
  coercions: FieldCoercion[];
}

// ---------------------------------------------------------------------------
// Field Error
// ---------------------------------------------------------------------------

/**
 * A field-level validation error indicating why a specific field failed validation.
 */
export interface FieldError {
  /** Name of the field that failed validation */
  field: string;
  /** Machine-readable error code (e.g. 'REQUIRED', 'INVALID_FORMAT', 'TYPE_MISMATCH') */
  code: string;
  /** Human-readable error description */
  message: string;
  /** The invalid value that was provided, if available */
  value?: unknown;
}

// ---------------------------------------------------------------------------
// Field Coercion
// ---------------------------------------------------------------------------

/**
 * A record of a type coercion applied to a field during validation.
 * Tracks what was converted and whether the coercion succeeded.
 */
export interface FieldCoercion {
  /** Name of the field that was coerced */
  field: string;
  /** Original value before coercion */
  originalValue: unknown;
  /** Value after coercion (undefined if coercion failed) */
  coercedValue?: unknown;
  /** Source type of the original value */
  fromType: string;
  /** Target type the value was coerced to */
  toType: string;
  /** Whether the coercion was successful */
  success: boolean;
}
