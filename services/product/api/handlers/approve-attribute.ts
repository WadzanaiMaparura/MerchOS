/**
 * Approve Attribute handler — POST /products/{productId}/attributes/{name}/approve
 *
 * Clears the review flag on an AI-enriched attribute and records the approver.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ProductService, getProductService } from '../../service';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { mapErrorToResponse } from '../error-mapper';

let productService: ProductService | undefined;
export function setProductService(service: ProductService): void {
  productService = service;
}
function resolveProductService(): ProductService {
  return productService ?? getProductService();
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }) };
  }

  const productId = event.pathParameters?.['productId'];
  const attributeName = event.pathParameters?.['name'];
  if (!productId || !attributeName) {
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'productId and attribute name are required' } }) };
  }

  const actor = tenantContext.userId ?? 'system';
  try {
    await resolveProductService().approveAttribute(tenantContext.tenantId, productId, attributeName, actor);
    const product = await resolveProductService().getProductDto(tenantContext.tenantId, productId);
    return { statusCode: 200, body: JSON.stringify({ product }) };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
