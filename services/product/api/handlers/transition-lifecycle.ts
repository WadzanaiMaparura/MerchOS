/**
 * Transition Lifecycle handler — POST /products/{productId}/lifecycle/transition
 *
 * Transitions a product to a target lifecycle state, enforcing the allowed
 * transition table and the EXPORT_READY gate (no flagged fields + category
 * confirmed) in the service.
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

const LIFECYCLE_STATES = [
  'DRAFT',
  'GENERATING',
  'INGESTED',
  'ENRICHED',
  'REVIEW',
  'VALIDATED',
  'EXPORT_READY',
  'PUBLISHED',
  'ARCHIVED',
] as const;

const bodySchema = z
  .object({
    targetState: z.enum(LIFECYCLE_STATES),
    reason: z.string().max(500).optional(),
  })
  .strict();

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return { statusCode: 401, body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }) };
  }

  const productId = event.pathParameters?.['productId'];
  if (!productId) {
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'productId is required' } }) };
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }) };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { statusCode: 400, body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: first?.message ?? 'targetState is required' } }) };
  }

  const actor = tenantContext.userId ?? 'system';
  try {
    await resolveProductService().transitionLifecycle(
      tenantContext.tenantId,
      productId,
      parsed.data.targetState,
      actor,
      parsed.data.reason
    );
    const product = await resolveProductService().getProductDto(tenantContext.tenantId, productId);
    return { statusCode: 200, body: JSON.stringify({ product }) };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
