/**
 * ValidationService — the service-boundary wrapper around the pure engine.
 *
 * Responsibilities (architecture §3.6 "Validate" + §4):
 *   - Schema Registry LOOKUP: resolve the target Takealot schema for the
 *     product's category (loads generated schema JSON).
 *   - Delegate to the deterministic engine.
 *   - Surface a clear error when no schema covers the requested target.
 *
 * Keeping lookup here (not in the engine) preserves the engine's purity and
 * testability: the engine receives a schema; the service decides which one.
 */

import {
  getRawSchema,
  findTemplateForCategoryNode,
  type RawTakealotSchema,
} from '@merch-os/marketplace-schemas';
import type { CanonicalProduct, ValidationResult } from '@merch-os/types';
import { validate, type ValidateInput } from '../engine/index.js';
import { parseNodeId } from '@merch-os/marketplace-schemas';

export class SchemaNotFoundError extends Error {
  constructor(public readonly detail: string) {
    super(`No Takealot schema found: ${detail}`);
    this.name = 'SchemaNotFoundError';
  }
}

export interface ValidateRequest {
  product: CanonicalProduct;
  /** Explicit template id (e.g. "248"). If omitted, resolved from category. */
  templateId?: string;
  /** Resolved category display values (optional; parsed from product if absent). */
  topCategory?: string;
  category?: string;
}

/** A thin, injectable registry port so the service can be unit-tested. */
export interface SchemaRegistryPort {
  getByTemplateId(templateId: string): RawTakealotSchema | null;
  findTemplateForNode(nodeId: string): string | null;
}

const defaultRegistry: SchemaRegistryPort = {
  getByTemplateId: (id) => getRawSchema(id),
  findTemplateForNode: (nodeId) => findTemplateForCategoryNode(nodeId),
};

export class ValidationService {
  constructor(private readonly registry: SchemaRegistryPort = defaultRegistry) {}

  /** Resolve the schema for a request, then run deterministic validation. */
  validate(req: ValidateRequest): ValidationResult {
    const category =
      req.category ?? req.product.platformSpecific?.categoryMappings?.takealot ?? undefined;
    const categoryNodeId = parseNodeId(category) ?? undefined;

    // 1. Resolve the template: explicit id wins, else map category node → template.
    let templateId = req.templateId;
    if (!templateId && categoryNodeId) {
      templateId = this.registry.findTemplateForNode(categoryNodeId) ?? undefined;
    }
    if (!templateId) {
      throw new SchemaNotFoundError(
        category
          ? `could not resolve a loadsheet template for category "${category}"`
          : 'no templateId or Takealot category supplied'
      );
    }

    const schema = this.registry.getByTemplateId(templateId);
    if (!schema) {
      throw new SchemaNotFoundError(`template "${templateId}" is not in the registry`);
    }

    // 2. Delegate to the pure engine.
    const input: ValidateInput = { product: req.product, schema };
    if (categoryNodeId !== undefined) input.categoryNodeId = categoryNodeId;
    if (req.topCategory !== undefined) input.topCategory = req.topCategory;
    if (category !== undefined) input.category = category;
    return validate(input);
  }
}
