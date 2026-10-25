/**
 * List Inventory Lambda handler — GET /inventory
 *
 * Returns the authenticated tenant's inventory records (paginated).
 * RBAC: inventory:read. tenantId comes only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../../shared/middleware/tenant-context';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { InventoryService, getInventoryService } from '../../service';
import { paginationQuerySchema } from '../schemas';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

let injected: InventoryService | undefined;

/** Test seam: inject a service instance (overrides the production factory). */
export function setInventoryService(service: InventoryService): void {
  injected = service;
}

function resolveService(): InventoryService {
  return injected ?? getInventoryService();
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }

  const parsed = paginationQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return ApiErrors.validation(
      first?.message ?? 'Invalid query parameters',
      first?.path.join('.')
    ) as APIGatewayProxyResultV2;
  }

  try {
    const result = await resolveService().listInventory(tenantContext.tenantId, {
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.nextToken !== undefined ? { nextToken: parsed.data.nextToken } : {}),
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: result.items, nextToken: result.nextToken }),
    };
  } catch (error) {
    logger.error('List inventory failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'inventory', action: 'read' }))
  .use(tenantContextMiddleware());
