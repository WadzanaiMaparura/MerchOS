/**
 * Validation Engine (architecture §4).
 *
 * The deterministic gatekeeper for marketplace exports. Given a canonical
 * product and a target Takealot schema, it:
 *   1. maps the canonical product onto the Takealot field-map,
 *   2. runs the schema-driven deterministic rules (presence, enum, length,
 *      range) via the marketplace-schemas rule kernel,
 *   3. applies canonical-level rules the raw field-map cannot express
 *      (barcode check digit, commercial sanity, images),
 *   4. emits a typed `ValidationResult`.
 *
 * Validation is a HARD GATE: `exportAllowed` is true only when there are zero
 * ERROR findings. The engine never mutates the product and never invents data.
 */

import type {
  CanonicalProduct,
  ValidationResult,
  ValidationFinding,
  ValidationSeverity,
  ChannelId,
} from '@merch-os/types';
import type { RawTakealotSchema } from '@merch-os/marketplace-schemas';
import { validateProduct, parseNodeId, type SchemaFinding } from '@merch-os/marketplace-schemas';
import { mapCanonicalToTakealot, type MapOptions } from './canonical-to-takealot.js';

export interface ValidateInput {
  product: CanonicalProduct;
  schema: RawTakealotSchema;
  /** Resolved category display values + node id for category-aware rules. */
  categoryNodeId?: string;
  topCategory?: string;
  category?: string;
}

/** Build an empty finding and let callers fill specifics. */
function finding(
  severity: ValidationSeverity,
  code: string,
  field: string,
  platformField: string,
  message: string,
  extra: Partial<ValidationFinding> = {}
): ValidationFinding {
  return {
    severity,
    code,
    field,
    platformField,
    message,
    currentValue: extra.currentValue ?? null,
    expectedFormat: extra.expectedFormat ?? null,
    allowedValues: extra.allowedValues ?? null,
    suggestion: extra.suggestion ?? '',
  };
}

/**
 * EAN-13 / UPC-A check-digit validation. Returns true if the barcode is a
 * valid 8/12/13/14-digit GTIN. Non-numeric or wrong-length → false.
 */
export function isValidGtin(barcode: string): boolean {
  const digits = barcode.trim();
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  const nums = digits.split('').map(Number);
  const check = nums.pop()!;
  // Weights alternate 3,1,... from the rightmost data digit.
  let sum = 0;
  for (let i = nums.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += nums[i]! * (pos % 2 === 0 ? 3 : 1);
  }
  const computed = (10 - (sum % 10)) % 10;
  return computed === check;
}

function countBySeverity(findings: ValidationFinding[], sev: ValidationSeverity): number {
  return findings.filter((f) => f.severity === sev).length;
}

/**
 * Validate a canonical product against a Takealot schema. Pure and
 * deterministic: same inputs always yield the same result.
 */
export function validate(input: ValidateInput): ValidationResult {
  const { product, schema } = input;
  const platform: ChannelId = 'takealot';

  const mapOptions: MapOptions = {};
  if (input.topCategory !== undefined) mapOptions.topCategory = input.topCategory;
  if (input.category !== undefined) mapOptions.category = input.category;

  const fieldMap = mapCanonicalToTakealot(product, schema, mapOptions);

  // Resolve the category node for conditional requiredness: explicit wins, else
  // parse from the mapped Category cell ("Parent->Child (id)").
  const categoryNodeId =
    input.categoryNodeId ?? parseNodeId(fieldMap['Category'] ?? undefined) ?? undefined;

  // ── Stage 1: schema-driven deterministic rules (the kernel) ───────────────
  const kernel = validateProduct(
    schema,
    fieldMap,
    categoryNodeId ? { categoryNodeId } : {}
  );

  const findings: ValidationFinding[] = kernel.findings.map((f: SchemaFinding) =>
    finding(f.severity, f.code, f.fieldId, f.fieldId, f.message, {
      currentValue: fieldMap[f.fieldId] ?? null,
      allowedValues:
        schema.fields.find((x: RawTakealotSchema['fields'][number]) => x.fieldId === f.fieldId)
          ?.allowedValues ?? null,
    })
  );

  // ── Stage 2: canonical-level rules not expressible on the raw field-map ───

  // Barcode check digit — only when a barcode is supplied (it is optional).
  const barcode = product.content.barcode;
  if (barcode && barcode.trim() !== '' && !isValidGtin(barcode)) {
    findings.push(
      finding(
        'ERROR',
        'BARCODE_CHECK_DIGIT',
        'content.barcode',
        'ProductID.Value',
        `Barcode "${barcode}" is not a valid GTIN (check digit / length).`,
        {
          currentValue: barcode,
          expectedFormat: '8, 12, 13 or 14 digit GTIN with valid check digit',
          suggestion: 'Verify the barcode on the physical product, or leave blank to receive a Takealot product label.',
        }
      )
    );
  }

  // Commercial sanity — price must be positive; selling price must not exceed
  // RRP (a Takealot-specific rule noted in the architecture doc §4.4).
  const commercial = product.commercial;
  if (commercial) {
    if (commercial.sellingPrice != null && commercial.sellingPrice <= 0) {
      findings.push(
        finding('ERROR', 'PRICE_NON_POSITIVE', 'commercial.sellingPrice', 'SellingPrice', 'Selling price must be greater than 0.', {
          currentValue: commercial.sellingPrice,
          suggestion: 'Set a selling price above 0.',
        })
      );
    }
    if (
      commercial.sellingPrice != null &&
      commercial.rrp != null &&
      commercial.sellingPrice > commercial.rrp
    ) {
      findings.push(
        finding('WARNING', 'PRICE_EXCEEDS_RRP', 'commercial.sellingPrice', 'SellingPrice', 'Selling price exceeds the recommended retail price (RRP).', {
          currentValue: commercial.sellingPrice,
          suggestion: 'Confirm the selling price is intentional; it is higher than the RRP.',
        })
      );
    }
    if (commercial.stockQuantity != null && commercial.stockQuantity < 0) {
      findings.push(
        finding('ERROR', 'STOCK_NEGATIVE', 'commercial.stockQuantity', 'StockOnHand', 'Stock quantity cannot be negative.', {
          currentValue: commercial.stockQuantity,
        })
      );
    }
  }

  // Images — Takealot requires a primary image. If the schema defines an image
  // column as required (via NODEREQ) the kernel already covers presence of the
  // URL cell; here we check the canonical image references as a WARNING when the
  // product carries none, since images are resolved to URLs at export time.
  if (!product.content.imageRefs || product.content.imageRefs.length === 0) {
    findings.push(
      finding('WARNING', 'NO_IMAGES', 'content.imageRefs', 'Images.image_url_1', 'Product has no images; at least one is expected for a listing.', {
        suggestion: 'Add at least one product image before export.',
      })
    );
  }

  const errorCount = countBySeverity(findings, 'ERROR');
  const warningCount = countBySeverity(findings, 'WARNING');
  const infoCount = countBySeverity(findings, 'INFO');

  return {
    productId: product.productId,
    targetPlatform: platform,
    targetCategory: input.category ?? schema.templateId ?? 'unknown',
    schemaVersion: '1.0.0',
    timestamp: new Date().toISOString(),
    exportAllowed: errorCount === 0,
    errorCount,
    warningCount,
    infoCount,
    findings,
  };
}
