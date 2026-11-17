/**
 * @merch-os/marketplace-schemas
 *
 * Marketplace content-file Schema Registry for MerchOS. Data-only: the schemas
 * are extracted from authoritative platform templates (Takealot `.xlsm`
 * loadsheets) into JSON under `generated/`, then exposed through the canonical
 * `MarketplaceSchema` contract from `@merch-os/types`.
 *
 * @see docs/architecture/schema-validation-architecture.md
 */

export type {
  RawTakealotSchema,
  RawField,
  RawCategoryRule,
  RawCategoryTreeEntry,
  RawIndexEntry,
  RawNumericBounds,
  RawAllowedValuesSource,
} from './raw-schema.js';

export { toMarketplaceSchema } from './mapper.js';

export {
  validateProduct,
  parseNodeId,
  type SchemaFinding,
  type SchemaValidationResult,
  type FindingSeverity,
  type ValidateOptions,
} from './validate.js';

export {
  listTakealotSchemas,
  getRawSchema,
  getSchema,
  findTemplateForCategoryNode,
  getCategoryRule,
  listGeneratedFiles,
} from './registry.js';
