/**
 * Maps a raw extracted Takealot loadsheet (`RawTakealotSchema`) onto the
 * canonical `MarketplaceSchema` / `FieldDefinition` contract defined in
 * `@merch-os/types`.
 *
 * The raw extraction is authoritative and lossless; this layer projects it into
 * the shape the Schema Registry, Validation Engine, and Export Engine consume
 * (per docs/architecture/schema-validation-architecture.md §3).
 */

import type {
  MarketplaceSchema,
  FieldDefinition,
  FieldRequirement,
  FieldDataType,
  RequirementClassification,
} from '@merch-os/types';
import type { RawTakealotSchema, RawField } from './raw-schema.js';

/**
 * Canonical product-model mapping for Takealot's structural (core) fields.
 * Category-specific `Attribute.*` fields have no fixed canonical path — they
 * flow through `content.attributes[...]` — so they map to null here.
 */
const CORE_CANONICAL_MAPPING: Record<string, string> = {
  title: 'content.title',
  subtitle: 'content.shortDescription',
  description: 'content.longDescription',
  Brand: 'content.brand',
  SKU: 'content.sku',
  'ProductID.Value': 'content.barcode',
  TopCategory: 'platformSpecific.categoryMappings.takealot',
  Category: 'platformSpecific.categoryMappings.takealot',
};

function mapDataType(raw: RawField): FieldDataType {
  // Preserve URL/HTML hints where the field id or format makes them obvious.
  const id = raw.fieldId.toLowerCase();
  if (raw.dataType === 'enum') return 'enum';
  if (id.includes('image_url') || id.includes('.url')) return 'url';
  if (raw.dataType === 'integer') return 'integer';
  if (raw.dataType === 'decimal') return 'decimal';
  if (raw.dataType === 'date') return 'date';
  if (id === 'description') return 'html';
  return 'string';
}

function mapRequirement(raw: RawField): FieldRequirement {
  if (raw.requiredForAllCategories) return 'required';
  if (raw.requiredForSomeCategories) return 'conditional';
  return 'optional';
}

function mapClassification(raw: RawField): RequirementClassification {
  if (raw.requiredForAllCategories || raw.requiredForSomeCategories) {
    return 'OFFICIAL_REQUIREMENT';
  }
  if (raw.recommended) return 'OFFICIAL_RECOMMENDATION';
  return 'UNVERIFIED';
}

function mapField(raw: RawField): FieldDefinition {
  const canonicalMapping =
    raw.fieldClass === 'core' ? (CORE_CANONICAL_MAPPING[raw.fieldId] ?? null) : null;

  // Conditional fields are required only for specific category nodes. The exact
  // node set lives in `categoryRules`; the condition expression documents the
  // dependency on the chosen Takealot category.
  const conditionExpression = raw.requiredForSomeCategories
    ? `product.platformSpecific.categoryMappings.takealot in requiredCategoriesFor('${raw.fieldId}')`
    : null;

  return {
    fieldId: raw.fieldId,
    platformFieldName: raw.platformFieldName,
    canonicalMapping,
    required: mapRequirement(raw),
    conditionExpression,
    dataType: mapDataType(raw),
    maxLength: raw.maxLength,
    minLength: 0,
    allowedValues: raw.allowedValues,
    pattern: null,
    minValue: raw.numericBounds?.min ?? null,
    maxValue: raw.numericBounds?.max ?? null,
    transformation: null,
    dependsOn: [],
    requiredWith: [],
    requirementClassification: mapClassification(raw),
  };
}

/**
 * Convert a raw extracted loadsheet into a canonical `MarketplaceSchema`.
 *
 * Takealot loadsheets are product-creation templates. A single loadsheet spans
 * many leaf categories, so `categoryOrVertical` records the template id; the
 * precise per-category required/recommended rules remain available on the raw
 * schema (`categoryRules`) for the Validation Engine.
 */
export function toMarketplaceSchema(raw: RawTakealotSchema): MarketplaceSchema {
  return {
    platform: 'takealot',
    marketplace: raw.country.toLowerCase(), // "za"
    categoryOrVertical: `loadsheet-${raw.templateId}`,
    schemaId: `takealot-za-loadsheet-${raw.templateId}`,
    schemaVersion: '1.0.0',
    templateVersion: raw.templateId,
    sourceDocumentation: [raw.sourceFile],
    dateVerified: raw.extractedAt,
    verificationStatus: 'VERIFIED_FROM_TEMPLATE',
    requirementClassification: 'OFFICIAL_REQUIREMENT',
    notes:
      `Extracted from Takealot content loadsheet ${raw.sourceFile}. ` +
      `Covers ${raw.categoryTreeCount} leaf categories across ${raw.categoryNodeCount} nodes. ` +
      `Per-category required/recommended rules are in the raw schema's categoryRules.`,
    fields: raw.fields.map(mapField),
    exportFormat: 'XLSX',
    columnOrder: raw.columnOrder,
    encoding: raw.encoding,
    delimiter: raw.delimiter,
  };
}
