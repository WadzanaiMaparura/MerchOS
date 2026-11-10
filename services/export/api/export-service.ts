/**
 * ExportService — the service boundary for export generation.
 *
 * Enforces the pipeline order (architecture §6.1): Schema Lookup → Validation
 * (hard gate) → Export Generation. It validates every product first and only
 * exports those that pass. A batch is blocked if ANY product fails, unless the
 * caller opts into a partial batch (export passing products, report the rest).
 */

import {
  getRawSchema,
  findTemplateForCategoryNode,
  parseNodeId,
  type RawTakealotSchema,
} from '@merch-os/marketplace-schemas';
import type { CanonicalProduct, ExportMode, ValidationResult } from '@merch-os/types';
import { ValidationService, type SchemaRegistryPort } from '@merch-os/validation';
import {
  generateExport,
  generateExportXlsx,
  type ExportItem,
  type ExportOutput,
  type XlsxExportOutput,
} from '../engine/index.js';
import {
  deliverExport,
  type ObjectStoragePort,
  type DeliveryArtifact,
} from '../delivery/index.js';

export class ExportSchemaNotFoundError extends Error {
  constructor(public readonly detail: string) {
    super(`No Takealot schema found: ${detail}`);
    this.name = 'ExportSchemaNotFoundError';
  }
}

export class ExportBlockedError extends Error {
  constructor(public readonly validationResults: ValidationResult[]) {
    super('Export blocked: one or more products failed validation.');
    this.name = 'ExportBlockedError';
  }
}

export type ExportFormat = 'CSV' | 'XLSX';

export interface ExportRequest {
  products: ReadonlyArray<{
    product: CanonicalProduct;
    topCategory?: string;
    category?: string;
    offer?: ExportItem['offer'];
  }>;
  mode: ExportMode;
  /** Output format. Default CSV; XLSX for native product-creation loadsheets. */
  format?: ExportFormat;
  /** Explicit template id; otherwise resolved from the first product's category. */
  templateId?: string;
  /**
   * When true, products that fail validation are excluded from the export and
   * returned in `excluded` instead of blocking the whole batch.
   */
  partial?: boolean;
  /** Resolve a canonical image s3Key to a public URL for the export. */
  imageUrlResolver?: (s3Key: string) => string;
  /** When provided (with tenantId), the export is delivered to object storage. */
  delivery?: {
    tenantId: string;
    exportId: string;
    expiresInSeconds?: number;
  };
}

export interface ExportResponse {
  output: ExportOutput | XlsxExportOutput;
  /** Validation result per exported product (all exportAllowed === true). */
  validated: ValidationResult[];
  /** Products excluded in a partial batch, with their failing validation. */
  excluded: ValidationResult[];
  /** Present when delivery was requested and succeeded. */
  artifact?: DeliveryArtifact;
}

export class ExportService {
  private readonly validation: ValidationService;

  constructor(
    private readonly registry: SchemaRegistryPort = {
      getByTemplateId: (id) => getRawSchema(id),
      findTemplateForNode: (node) => findTemplateForCategoryNode(node),
    },
    validation?: ValidationService,
    /** Optional object storage; required only when delivery is requested. */
    private readonly storage?: ObjectStoragePort
  ) {
    this.validation = validation ?? new ValidationService(this.registry);
  }

  private resolveSchema(req: ExportRequest): RawTakealotSchema {
    let templateId = req.templateId;
    if (!templateId) {
      const first = req.products[0];
      const category =
        first?.category ?? first?.product.platformSpecific?.categoryMappings?.takealot;
      const node = parseNodeId(category);
      if (node) templateId = this.registry.findTemplateForNode(node) ?? undefined;
    }
    if (!templateId) {
      throw new ExportSchemaNotFoundError('could not resolve a template for the request');
    }
    const schema = this.registry.getByTemplateId(templateId);
    if (!schema) throw new ExportSchemaNotFoundError(`template "${templateId}" not in registry`);
    return schema;
  }

  async export(req: ExportRequest): Promise<ExportResponse> {
    if (req.products.length === 0) {
      throw new ExportSchemaNotFoundError('no products supplied');
    }
    const schema = this.resolveSchema(req);

    // Stage 5: validate every product (hard gate).
    const validated: ValidationResult[] = [];
    const excluded: ValidationResult[] = [];
    const exportItems: ExportItem[] = [];

    for (const entry of req.products) {
      const validateReq: Parameters<ValidationService['validate']>[0] = {
        product: entry.product,
      };
      if (schema.templateId) validateReq.templateId = schema.templateId;
      if (entry.topCategory !== undefined) validateReq.topCategory = entry.topCategory;
      if (entry.category !== undefined) validateReq.category = entry.category;
      const result = this.validation.validate(validateReq);
      if (result.exportAllowed) {
        validated.push(result);
        const mapOptions: ExportItem['mapOptions'] = {};
        if (entry.topCategory !== undefined) mapOptions.topCategory = entry.topCategory;
        const cat = entry.category ?? entry.product.platformSpecific?.categoryMappings?.takealot;
        if (cat) mapOptions.category = cat;
        if (req.imageUrlResolver) mapOptions.imageUrlResolver = req.imageUrlResolver;
        const item: ExportItem = { product: entry.product, mapOptions };
        if (entry.offer) item.offer = entry.offer;
        exportItems.push(item);
      } else {
        excluded.push(result);
      }
    }

    // Block the batch unless the caller opted into a partial export.
    if (excluded.length > 0 && !req.partial) {
      throw new ExportBlockedError(excluded);
    }
    if (exportItems.length === 0) {
      throw new ExportBlockedError(excluded);
    }

    // Stage 6: generate (CSV or XLSX).
    const genInput = { schema, mode: req.mode, items: exportItems };
    const output: ExportOutput | XlsxExportOutput =
      req.format === 'XLSX'
        ? await generateExportXlsx(genInput)
        : generateExport(genInput);

    // Stage 7: delivery (optional).
    const response: ExportResponse = { output, validated, excluded };
    if (req.delivery) {
      if (!this.storage) {
        throw new ExportSchemaNotFoundError(
          'delivery was requested but no object storage is configured'
        );
      }
      response.artifact = await deliverExport(this.storage, {
        tenantId: req.delivery.tenantId,
        exportId: req.delivery.exportId,
        filename: output.filename,
        format: output.format,
        body: output.content,
        ...(req.delivery.expiresInSeconds !== undefined
          ? { expiresInSeconds: req.delivery.expiresInSeconds }
          : {}),
      });
    }
    return response;
  }
}
