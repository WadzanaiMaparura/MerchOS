/**
 * Get Product Lambda handler — GET /products/{productId}
 *
 * Extracts productId from path, tenant from authorizer, returns product.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ProductService } from '../../service';
import { extractTenantContext } from '../tenant-context';
import { mapErrorToResponse } from '../error-mapper';

let productService: ProductService;

/** Inject the ProductService instance (called during Lambda init or test setup). */
export function setProductService(service: ProductService): void {
  productService = service;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // 1. Extract tenant context
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }),
    };
  }

  // 2. Extract productId from path parameters
  const productId = event.pathParameters?.['productId'];
  if (!productId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'productId path parameter is required' } }),
    };
  }

  // 3. Delegate to service
  try {
    const product = await productService.getProduct(tenantContext.tenantId, productId);
    return {
      statusCode: 200,
      body: JSON.stringify({ product }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
