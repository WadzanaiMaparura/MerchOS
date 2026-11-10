/**
 * Validate Product Lambda handler — POST /validate
 *
 * Body: { product: CanonicalProduct, templateId?, topCategory?, category? }
 * Returns the deterministic ValidationResult. A 200 is returned even when the
 * product fails validation — the result's `exportAllowed`/`errorCount` convey
 * the verdict. Malformed requests return 400; unknown schema returns 422.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { CanonicalProduct } from '@merch-os/types';
import {
  ValidationService,
  SchemaNotFoundError,
  type ValidateRequest,
} from '../validation-service.js';

let service: ValidationService | undefined;

/** Test seam: inject a ValidationService (e.g. with a stub registry). */
export function setValidationService(s: ValidationService): void {
  service = s;
}

function resolveService(): ValidationService {
  return (service ??= new ValidationService());
}

function errorResponse(statusCode: number, code: string, message: string): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify({ error: { code, message } }) };
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  // 1. Parse body.
  let body: Partial<ValidateRequest>;
  try {
    body = event.body ? (JSON.parse(event.body) as Partial<ValidateRequest>) : {};
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
  }

  const product = body.product as CanonicalProduct | undefined;
  if (!product || typeof product !== 'object' || !product.productId) {
    return errorResponse(400, 'VALIDATION_ERROR', 'A canonical "product" with a productId is required.');
  }

  // 2. Validate.
  try {
    const req: ValidateRequest = { product };
    if (body.templateId !== undefined) req.templateId = body.templateId;
    if (body.topCategory !== undefined) req.topCategory = body.topCategory;
    if (body.category !== undefined) req.category = body.category;

    const result = resolveService().validate(req);
    return { statusCode: 200, body: JSON.stringify({ result }) };
  } catch (err) {
    if (err instanceof SchemaNotFoundError) {
      return errorResponse(422, 'SCHEMA_NOT_FOUND', err.message);
    }
    return errorResponse(500, 'INTERNAL_ERROR', 'Validation failed unexpectedly.');
  }
}
