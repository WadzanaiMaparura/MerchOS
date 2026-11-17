/**
 * Minimal deterministic schema validator.
 *
 * Validates a flat product field-map (fieldId → raw string value, as it would
 * appear in a Takealot loadsheet cell) against a generated `RawTakealotSchema`.
 * This checks only the machine-decidable rules the schema encodes — the same
 * class Takealot reports under "SystemValidation": required-field presence,
 * enum membership, max length, and numeric bounds.
 *
 * It intentionally does NOT attempt content/review judgements (e.g. "attribute
 * & description mismatch"), which Takealot reports separately under
 * "RejectionReason" and which are not deterministically decidable.
 *
 * This is the seed of the Validation Engine (architecture §4); it lives here so
 * the generated schemas can be reconciled against real submission outcomes.
 */

import type { RawTakealotSchema, RawField } from './raw-schema.js';

export type FindingSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface SchemaFinding {
  severity: FindingSeverity;
  code: string;
  fieldId: string;
  message: string;
}

export interface SchemaValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  findings: SchemaFinding[];
}

export interface ValidateOptions {
  /**
   * The Takealot leaf category node id for this product (parsed from the
   * "Lowest Category (id)" value). When provided, conditional requiredness is
   * resolved against that node's NODEREQ set; otherwise conditional fields are
   * treated as recommended (WARNING), never hard errors.
   */
  categoryNodeId?: string;
}

/** Parse a trailing "... (12345)" node id out of a category cell value. */
export function parseNodeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /\((\d+)\)\s*$/.exec(String(value).trim());
  return m ? m[1]! : null;
}

function present(value: unknown): boolean {
  return value != null && String(value).trim() !== '';
}

/** Strip a trailing " (12345)" id suffix from an enum label, if present. */
function enumLabel(s: string): string {
  return s.replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();
}

/** Boolean synonyms Takealot normalises interchangeably (e.g. True ↔ Yes). */
const BOOL_SYNONYMS: Record<string, string[]> = {
  yes: ['yes', 'true', 'y', '1'],
  no: ['no', 'false', 'n', '0'],
  true: ['yes', 'true', 'y', '1'],
  false: ['no', 'false', 'n', '0'],
};

/**
 * Enum membership, tolerant in the ways Takealot's ingestion is:
 *  - case / whitespace insensitive
 *  - matches the label portion of "Label (id)" values (the id_in_brackets form)
 *  - treats boolean synonyms (True/Yes, False/No) as equivalent for Yes/No lists
 */
function inEnum(value: string, allowed: string[]): boolean {
  const v = value.trim().toLowerCase();
  const vLabel = enumLabel(value);
  for (const a of allowed) {
    const aLower = a.trim().toLowerCase();
    const aLabel = enumLabel(a);
    if (aLower === v || aLabel === vLabel) return true;
    // Boolean synonym match (only when the allowed value is itself a yes/no).
    const syn = BOOL_SYNONYMS[aLabel];
    if (syn && syn.includes(v)) return true;
  }
  return false;
}

export function validateProduct(
  schema: RawTakealotSchema,
  product: Record<string, string | null | undefined>,
  options: ValidateOptions = {}
): SchemaValidationResult {
  const findings: SchemaFinding[] = [];
  const fieldsById = new Map<string, RawField>(schema.fields.map((f) => [f.fieldId, f]));

  // Resolve category-conditional requiredness, if we know the node.
  const node = options.categoryNodeId ?? null;
  const requiredForNode = new Set<string>(
    node ? (schema.categoryRules[node]?.required ?? []) : []
  );

  for (const field of schema.fields) {
    const value = product[field.fieldId];
    const has = present(value);

    // ── Presence ──────────────────────────────────────────────────────────
    const hardRequired =
      field.requiredForAllCategories ||
      (field.requiredForSomeCategories && requiredForNode.has(field.fieldId));

    if (!has) {
      if (hardRequired) {
        findings.push({
          severity: 'ERROR',
          code: 'REQUIRED_MISSING',
          fieldId: field.fieldId,
          message: `Required field "${field.fieldId}" is missing.`,
        });
      } else if (field.requiredForSomeCategories && !node) {
        // Conditionally required but category unknown → advise, don't block.
        findings.push({
          severity: 'WARNING',
          code: 'CONDITIONAL_UNKNOWN_CATEGORY',
          fieldId: field.fieldId,
          message: `Field "${field.fieldId}" is required for some categories; category node not supplied.`,
        });
      }
      continue; // nothing further to check on an empty value
    }

    const str = String(value);

    // ── Length ────────────────────────────────────────────────────────────
    if (field.maxLength != null && str.length > field.maxLength) {
      findings.push({
        severity: 'ERROR',
        code: 'MAX_LENGTH',
        fieldId: field.fieldId,
        message: `"${field.fieldId}" length ${str.length} exceeds max ${field.maxLength}.`,
      });
    }

    // ── Enumeration (static lists only) ─────────────────────────────────────
    if (
      field.dataType === 'enum' &&
      Array.isArray(field.allowedValues) &&
      field.allowedValues.length > 0 &&
      !inEnum(str, field.allowedValues)
    ) {
      findings.push({
        severity: 'ERROR',
        code: 'ENUM_INVALID',
        fieldId: field.fieldId,
        message: `"${str}" is not an allowed value for "${field.fieldId}".`,
      });
    }

    // ── Numeric bounds ──────────────────────────────────────────────────────
    if (field.numericBounds && (field.dataType === 'integer' || field.dataType === 'decimal')) {
      const num = Number(str);
      if (Number.isNaN(num)) {
        findings.push({
          severity: 'ERROR',
          code: 'NOT_NUMERIC',
          fieldId: field.fieldId,
          message: `"${field.fieldId}" expects a number but got "${str}".`,
        });
      } else {
        const { min, max } = field.numericBounds;
        if (min != null && num < min) {
          findings.push({ severity: 'ERROR', code: 'MIN_VALUE', fieldId: field.fieldId, message: `"${field.fieldId}" ${num} < min ${min}.` });
        }
        if (max != null && num > max) {
          findings.push({ severity: 'ERROR', code: 'MAX_VALUE', fieldId: field.fieldId, message: `"${field.fieldId}" ${num} > max ${max}.` });
        }
      }
    }
  }

  // Flag any supplied field the schema does not define (a schema-coverage gap).
  for (const key of Object.keys(product)) {
    if (present(product[key]) && !fieldsById.has(key)) {
      findings.push({
        severity: 'INFO',
        code: 'UNKNOWN_FIELD',
        fieldId: key,
        message: `Supplied field "${key}" is not defined in the schema.`,
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === 'ERROR').length;
  const warningCount = findings.filter((f) => f.severity === 'WARNING').length;
  return { ok: errorCount === 0, errorCount, warningCount, findings };
}
