/**
 * Archive Product Lambda handler — DELETE /products/{productId}
 *
 * Performs a soft delete (archive), not a physical delete.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ProductService, getProductService } from '../../service';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { mapErrorToResponse } from '../error-mapper';

let productService: ProductService | undefined;

/** Inject the ProductService instance (test seam; overrides the production factory). */
export function setProductService(service: ProductService): void {
  productService = service;
}

/** Resolve the ProductService: test-injected instance if present, else the production factory. */
function resolveProductService(): ProductService {
  return productService ?? getProductService();
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

  // 2. Extract productId from path
  const productId = event.pathParameters?.['productId'];
  if (!productId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'productId path parameter is required' } }),
    };
  }

  // 3. Delegate to service (archive = soft delete)
  try {
    const product = await resolveProductService().archiveProduct(tenantContext.tenantId, productId);
    return {
      statusCode: 200,
      body: JSON.stringify({ product }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
