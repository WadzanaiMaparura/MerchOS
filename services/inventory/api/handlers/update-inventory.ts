/**
 * Update Inventory Lambda handler — PUT /inventory/{sku}
 *
 * Absolute on-hand stock update for a SKU + warehouse. The path {sku} is
 * authoritative; the body cannot supply or override `sku` (strict schema).
 * RBAC: inventory:update. tenantId and actor come only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../../shared/middleware/tenant-context';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { InventoryService, getInventoryService } from '../../service';
import { updateInventorySchema } from '../schemas';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

let injected: InventoryService | undefined;

export function setInventoryService(service: InventoryService): void {
  injected = service;
}

function resolveService(): InventoryService {
  return injected ?? getInventoryService();
}

/** Read the trusted actor (JWT sub) from the authorizer claims. */
function extractActor(event: APIGatewayProxyEventV2): string {
  const authorizer = (event.requestContext as unknown as Record<string, unknown>)?.['authorizer'] as
    | Record<string, unknown>
    | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as Record<string, unknown> | undefined;
  const sub = claims?.['sub'] as string | undefined;
  return sub ?? 'unknown';
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }

  const sku = event.pathParameters?.['sku'];
  if (!sku) {
    return ApiErrors.validation('sku path parameter is required', 'sku') as APIGatewayProxyResultV2;
  }

  // Parse body.
  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return ApiErrors.validation('Invalid JSON body') as APIGatewayProxyResultV2;
  }

  // Strict validation — rejects a `sku` field or any unexpected/system field.
  const parsed = updateInventorySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return ApiErrors.validation(
      first?.message ?? 'Invalid request body',
      first?.path.join('.')
    ) as APIGatewayProxyResultV2;
  }

  try {
    const record = await resolveService().updateStock(tenantContext.tenantId, {
      sku, // authoritative from the path
      warehouseId: parsed.data.warehouseId,
      onHand: parsed.data.onHand,
      actor: extractActor(event),
      source: 'api',
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    };
  } catch (error) {
    logger.error('Update inventory failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'inventory', action: 'update' }))
  .use(tenantContextMiddleware());
