/**
 * Synthesize Product Lambda handler — POST /products/{productId}/synthesize
 *
 * Orchestrates AI synthesis for a product:
 *   1. Transition DRAFT → GENERATING (append lifecycle history).
 *   2. Call the Product Intelligence API (server-to-server, forwarding the
 *      caller's JWT) for the requested generation types.
 *   3. Run the synthesis glue and persist updated content + enrichment.
 *   4. Transition GENERATING → REVIEW.
 *   5. On failure, transition back to DRAFT with the reason recorded; no prior
 *      product data is lost.
 *
 * Runs orchestration server-side (not in the browser) so tenant/budget
 * enforcement stays on the backend and the GENERATING → REVIEW transition is
 * not racy.
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { LifecycleTransition, LifecycleState } from '@merch-os/types';
import {
  ProductService,
  getProductService,
  getIntelligenceCaller,
  assertTransition,
  type GlueGenerationResult,
} from '../../service';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { mapErrorToResponse } from '../error-mapper';

let productService: ProductService | undefined;

/** Inject the ProductService instance (test seam). */
export function setProductService(service: ProductService): void {
  productService = service;
}

function resolveProductService(): ProductService {
  return productService ?? getProductService();
}

/** Default generation types requested when the caller does not specify. */
const DEFAULT_TYPES = ['title', 'description', 'bullets', 'attributes', 'category'] as const;

/** Extract the raw bearer token from the Authorization header. */
function extractBearer(event: APIGatewayProxyEventV2): string | null {
  const auth =
    event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1]! : null;
}

function transition(
  from: LifecycleState,
  to: LifecycleState,
  actor: string,
  reason?: string
): LifecycleTransition {
  return {
    fromState: from,
    toState: to,
    transitionedAt: new Date().toISOString(),
    actor,
    ...(reason ? { reason } : {}),
  };
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // 1. Tenant context
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing tenant context' } }),
    };
  }
  const { tenantId } = tenantContext;
  const actor = tenantContext.userId ?? 'system';

  // 2. Path param
  const productId = event.pathParameters?.['productId'];
  if (!productId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'VALIDATION_ERROR', message: 'productId path parameter is required' } }),
    };
  }

  // 3. Bearer token to forward to the Intelligence API
  const token = extractBearer(event);
  if (!token) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } }),
    };
  }

  // 4. Parse optional body: { types?: string[], marketplace?: string }
  let types: readonly string[] = DEFAULT_TYPES;
  let marketplace: string | undefined;
  if (event.body) {
    try {
      const body = JSON.parse(event.body) as { types?: string[]; marketplace?: string };
      if (Array.isArray(body.types) && body.types.length > 0) types = body.types;
      if (typeof body.marketplace === 'string') marketplace = body.marketplace;
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } }),
      };
    }
  }

  const service = resolveProductService();

  // 5. Load product + current lifecycle state
  let dto;
  try {
    dto = await service.getProductDto(tenantId, productId);
  } catch (error) {
    return mapErrorToResponse(error);
  }
  const currentState = dto.lifecycleState;

  // 6. Transition → GENERATING
  try {
    assertTransition(currentState, 'GENERATING');
  } catch (error) {
    return mapErrorToResponse(error);
  }
  const history = [...dto.lifecycleHistory];
  history.push(transition(currentState, 'GENERATING', actor));
  await service.appendLifecycleTransition(tenantId, productId, history[history.length - 1]!, 'GENERATING');

  // 7. Call the Intelligence API for each type (server-to-server, JWT forwarded)
  const caller = getIntelligenceCaller();
  const productData: Record<string, unknown> = {
    name: dto.title,
    description: dto.description,
    brand: dto.brand,
    attributes: dto.attributes,
    images: dto.images.map((i) => i.s3Key),
  };

  const results: GlueGenerationResult[] = [];
  let anyFailure = false;
  for (const type of types) {
    const result = await caller.generate(
      { type, productData, ...(marketplace ? { marketplace } : {}) },
      token
    );
    if (result && result.status === 'completed') {
      results.push(result);
    } else {
      anyFailure = true;
    }
  }

  // 8. If nothing generated, revert to DRAFT with a reason.
  if (results.length === 0) {
    history.push(
      transition('GENERATING', 'DRAFT', 'system', 'Synthesis produced no results')
    );
    await service.appendLifecycleTransition(
      tenantId,
      productId,
      history[history.length - 1]!,
      'DRAFT'
    );
    return {
      statusCode: 502,
      body: JSON.stringify({
        error: {
          code: 'SYNTHESIS_FAILED',
          message: 'The synthesis engine returned no usable results. The product was returned to draft.',
        },
      }),
    };
  }

  // 9. Apply glue + persist, then transition → REVIEW.
  try {
    history.push(transition('GENERATING', 'REVIEW', 'system'));
    await service.applyAndPersistSynthesis(
      tenantId,
      productId,
      results,
      'REVIEW',
      history
    );
  } catch (error) {
    // Persistence failed after generation — revert to DRAFT.
    const revert = [...dto.lifecycleHistory];
    revert.push(transition('GENERATING', 'DRAFT', 'system', 'Failed to persist synthesis results'));
    await service.appendLifecycleTransition(tenantId, productId, revert[revert.length - 1]!, 'DRAFT');
    return mapErrorToResponse(error);
  }

  // 10. Return the assembled product DTO (now in REVIEW with enrichment).
  try {
    const updated = await service.getProductDto(tenantId, productId);
    return {
      statusCode: 200,
      body: JSON.stringify({
        product: updated,
        partial: anyFailure,
      }),
    };
  } catch (error) {
    return mapErrorToResponse(error);
  }
}
