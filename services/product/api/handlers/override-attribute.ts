/**
 * Override Attribute handler — POST /products/{productId}/attributes/{name}/override
 *
 * Sets a seller-provided value on an attribute (source 'manual'), clears the
 * review flag, and writes known top-level fields through to canonical content.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
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

const bodySchema = z
  .object({ newValue: z.union([z.string(), z.number(), z.boolean()]) })
  .strict();

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

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }) };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'newValue is required' } }) };
  }

  const actor = tenantContext.userId ?? 'system';
  try {
    await resolveProductService().overrideAttribute(
      tenantContext.tenantId,
      productId,
      attributeName,
      parsed.data.newValue,
      actor
    );
    const product = await resolveProductService().getProductDto(tenantContext.tenantId, productId);
    return { statusCode: 200, body: JSON.stringify({ product }) };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
