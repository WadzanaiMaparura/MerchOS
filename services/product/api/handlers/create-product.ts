/**
 * Create Product Lambda handler — POST /products
 *
 * Validates request body with Zod, extracts tenant context, delegates to ProductService.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ProductService } from '../../service';
import { extractTenantContext } from '../tenant-context';
import { mapErrorToResponse } from '../error-mapper';
import { createProductSchema } from '../schemas';

let productService: ProductService;

/** Inject the ProductService instance (called during Lambda init or test setup). */
export function setProductService(service: ProductService): void {
  productService = service;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // 1. Extract tenant context from trusted authorizer
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }),
    };
  }

  // 2. Parse request body
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }),
    };
  }

  // 3. Validate with Zod (strict schema rejects unknown fields including pricing & system fields)
  const parseResult = createProductSchema.safeParse(body);
  if (!parseResult.success) {
    const firstError = parseResult.error.errors[0];
    const field = firstError.path.length > 0 ? firstError.path.join('.') : undefined;
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError.message,
          ...(field && { field }),
        },
      }),
    };
  }

  // 4. Strip system-managed fields as a defense-in-depth measure
  const { tenantId, productId, createdAt, updatedAt, lifecycleState, sellingPrice, rrp, salePrice, currency, ...permitted } = body as Record<string, unknown>;

  // 5. Delegate to service
  try {
    const product = await productService.createProduct(tenantContext.tenantId, permitted);
    return {
      statusCode: 201,
      body: JSON.stringify({ product }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
