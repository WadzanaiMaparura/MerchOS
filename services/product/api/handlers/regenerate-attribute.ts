/**
 * Regenerate Attribute handler —
 * POST /products/{productId}/attributes/{name}/regenerate
 *
 * Re-invokes the Product Intelligence engine for a single field (optionally with
 * a reason/context, e.g. a marketplace rejection) and merges the new result into
 * the enrichment layer. The product must be in REVIEW.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { LifecycleTransition } from '@merch-os/types';
import {
  ProductService,
  getProductService,
  getIntelligenceCaller,
  type GlueGenerationResult,
} from '../../service';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { mapErrorToResponse } from '../error-mapper';

let productService: ProductService | undefined;
export function setProductService(service: ProductService): void {
  productService = service;
}
function resolveProductService(): ProductService {
  return productService ?? getProductService();
}

/** Attribute names that map to a generation type the engine supports. */
const ATTR_TO_TYPE: Record<string, string> = {
  title: 'title',
  description: 'description',
  bullets: 'bullets',
  brand: 'brand',
  category: 'category',
};

function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const auth = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1]! : null;
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

  const type = ATTR_TO_TYPE[attributeName] ?? (attributeName ? 'attributes' : undefined);
  if (!type) {
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: `Cannot regenerate attribute '${attributeName}'` } }) };
  }

  const token = extractBearer(event);
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } }) };
  }

  // Optional { reason, marketplace } — reason is passed to the engine as context.
  let reason: string | undefined;
  let marketplace: string | undefined;
  if (event.body) {
    try {
      const b = JSON.parse(event.body) as { reason?: string; marketplace?: string };
      if (typeof b.reason === 'string') reason = b.reason;
      if (typeof b.marketplace === 'string') marketplace = b.marketplace;
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }) };
    }
  }

  const service = resolveProductService();

  let dto;
  try {
    dto = await service.getProductDto(tenantContext.tenantId, productId);
  } catch (error) {
    return mapErrorToResponse(error);
  }
  if (dto.lifecycleState !== 'REVIEW') {
    return { statusCode: 409, body: JSON.stringify({ error: { code: 'INVALID_PRODUCT_LIFECYCLE', message: 'Product must be in REVIEW to regenerate a field' } }) };
  }

  const caller = getIntelligenceCaller();
  const productData: Record<string, unknown> = {
    name: dto.title,
    description: dto.description,
    brand: dto.brand,
    attributes: dto.attributes,
    images: dto.images.map((i) => i.s3Key),
  };
  const options = reason ? { regenerationReason: reason } : undefined;

  const result = await caller.generate(
    { type, productData, ...(marketplace ? { marketplace } : {}), ...(options ? { options } : {}) },
    token
  );

  if (!result || result.status !== 'completed') {
    return { statusCode: 502, body: JSON.stringify({ error: { code: 'SYNTHESIS_FAILED', message: 'Regeneration did not produce a result' } }) };
  }

  const results: GlueGenerationResult[] = [result];
  // Keep lifecycle at REVIEW; merge the single new field over existing enrichment.
  const history: LifecycleTransition[] = dto.lifecycleHistory;
  try {
    await service.applyAndPersistSynthesis(
      tenantContext.tenantId,
      productId,
      results,
      'REVIEW',
      history
    );
    const product = await service.getProductDto(tenantContext.tenantId, productId);
    return { statusCode: 200, body: JSON.stringify({ product }) };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
