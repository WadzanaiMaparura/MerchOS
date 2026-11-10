/**
 * Raw extraction types — the exact shape of the JSON produced by
 * `scripts/extract-takealot.mjs` under `generated/takealot-za/*.json`.
 *
 * These mirror the authoritative Takealot loadsheet contents verbatim. They are
 * intentionally lossless and low-level; the registry (see `registry.ts`) maps
 * them onto the canonical `MarketplaceSchema` contract from `@merch-os/types`.
 *
 * Do NOT hand-edit the generated JSON — regenerate it from the `.xlsm` sources.
 */

/** How a field's `list` dropdown values were sourced. */
export type RawAllowedValuesSource =
  | { kind: 'namedRange'; name: string; note?: string }
  | { kind: 'inline' }
  | { kind: 'dynamic'; formula: string };

/** Numeric bounds extracted from a whole/decimal data validation. */
export interface RawNumericBounds {
  min?: number;
  max?: number;
}

/** A single extracted loadsheet column. */
export interface RawField {
  /** Platform field id from Loadsheet header row 1 (e.g. "title", "Attribute.whats_in_the_box"). */
  fieldId: string;
  /** The exact CSV/column header Takealot expects (same as fieldId). */
  platformFieldName: string;
  /** Human label from header row 3. */
  label: string | null;
  /** Short key from header row 5. */
  shortKey: string | null;
  /** Format hint from header row 4 (e.g. "id_in_brackets"). */
  formatHint: string | null;
  /** Full instructions from header row 6. */
  instructions: string | null;
  /** "core" = structural field; "category-attribute" = category-specific attribute. */
  fieldClass: 'core' | 'category-attribute';
  /** Required for EVERY category node this loadsheet covers (or a core mandatory field). */
  requiredForAllCategories: boolean;
  /** Required for at least one — but not all — category nodes (conditionally required). */
  requiredForSomeCategories: boolean;
  /** Recommended (from NODEREC) for at least one category node. */
  recommended: boolean;
  /** Max character length from a textLength data validation, else null. */
  maxLength: number | null;
  /** Numeric bounds from a whole/decimal data validation, else null. */
  numericBounds: RawNumericBounds | null;
  /** Inferred data type. */
  dataType: 'string' | 'integer' | 'decimal' | 'date' | 'enum';
  /** Resolved allowed values for static list dropdowns, else null. */
  allowedValues: string[] | null;
  /** Where the dropdown values came from (named range / inline / dynamic). */
  allowedValuesSource: RawAllowedValuesSource | null;
  /** 1-based column index in the Loadsheet sheet. */
  columnIndex: number;
}

/** Per-category-node required/recommended attribute sets. */
export interface RawCategoryRule {
  required: string[];
  recommended: string[];
}

/** A row of the "Category Tree Lookup" sheet. */
export interface RawCategoryTreeEntry {
  mainCategory: string | null;
  mainCategoryId: string | null;
  leafPath: string | null;
  leafCategory: string | null;
  leafNodeId: string | null;
}

/** A complete extracted loadsheet schema (one generated JSON file). */
export interface RawTakealotSchema {
  platform: 'takealot';
  country: 'ZA';
  templateId: string | null;
  sourceFile: string;
  exportFormat: 'XLSX';
  delimiter: string;
  encoding: string;
  extractedAt: string;
  requireFlags: Record<string, boolean>;
  fieldCount: number;
  categoryNodeCount: number;
  categoryTreeCount: number;
  requiredUniformAcrossNodes: boolean;
  baseRequiredFields: string[];
  columnOrder: string[];
  fields: RawField[];
  categoryTree: RawCategoryTreeEntry[];
  /** nodeId → { required[], recommended[] }. */
  categoryRules: Record<string, RawCategoryRule>;
}

/** An entry in the generated `_index.json`. */
export interface RawIndexEntry {
  templateId: string | null;
  sourceFile: string;
  schemaFile: string;
  fieldCount: number;
  categoryNodeCount: number;
  categoryTreeCount: number;
}
