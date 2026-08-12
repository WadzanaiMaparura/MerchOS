/**
 * Create Product Lambda handler — POST /products
 *
 * Validates request body, extracts tenant context, delegates to ProductService.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ProductService } from '../../service';
import { extractTenantContext } from '../tenant-context';
import { mapErrorToResponse } from '../error-mapper';
import type { CreateProductRequest } from '../types';

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
  let body: CreateProductRequest;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }),
    };
  }

  // 3. Basic presence validation (service does deeper validation)
  if (!body.title || !body.sku || !body.brand) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'title, sku, and brand are required' },
      }),
    };
  }

  // 4. Delegate to service
  try {
    const product = await productService.createProduct(tenantContext.tenantId, body);
    return {
      statusCode: 201,
      body: JSON.stringify({ product }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
