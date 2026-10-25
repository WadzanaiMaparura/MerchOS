/**
 * List Products Lambda handler — GET /products
 *
 * Supports pagination via limit and nextToken query parameters.
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

  // 2. Parse query parameters
  const limitParam = event.queryStringParameters?.['limit'];
  const nextToken = event.queryStringParameters?.['nextToken'];

  const limit = limitParam ? parseInt(limitParam, 10) : undefined;
  if (limitParam && (isNaN(limit!) || limit! < 1)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'limit must be a positive integer' } }),
    };
  }

  // 3. Delegate to service
  try {
    const result = await resolveProductService().listProducts(tenantContext.tenantId, { limit, nextToken });
    return {
      statusCode: 200,
      body: JSON.stringify({ products: result.items, nextToken: result.nextToken }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
