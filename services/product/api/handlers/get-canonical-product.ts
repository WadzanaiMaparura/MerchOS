/**
 * Get Canonical Product Lambda handler — GET /products/{productId}/canonical
 *
 * Returns the fullest `CanonicalProduct` (stored canonical product with the AI
 * enrichment layer's attribute values merged into content.attributes). This is
 * the shape the export/validation pipeline consumes — it preserves variants,
 * platformSpecific, and the full typed content that the `Product` DTO drops.
 *
 * Tenant is taken from the authorizer context only (never the path/body), and
 * the repository read is physically confined to the caller's partition.
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
  // 1. Extract tenant context (authorizer-derived only).
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }),
    };
  }

  // 2. Extract productId from path parameters.
  const productId = event.pathParameters?.['productId'];
  if (!productId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'productId path parameter is required' } }),
    };
  }

  // 3. Delegate to service — canonical product with enrichment merged in.
  try {
    const product = await resolveProductService().getCanonicalProduct(
      tenantContext.tenantId,
      productId
    );
    return {
      statusCode: 200,
      body: JSON.stringify({ product }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
