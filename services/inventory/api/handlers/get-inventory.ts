/**
 * Get Inventory Lambda handler — GET /inventory/{sku}
 *
 * Returns all warehouse records for a SKU within the authenticated tenant.
 * Returns 404 INVENTORY_NOT_FOUND when the SKU has no inventory records.
 * RBAC: inventory:read. tenantId comes only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../../shared/middleware/tenant-context';
import { extractTenantContext } from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { InventoryService, getInventoryService } from '../../service';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

let injected: InventoryService | undefined;

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

  const sku = event.pathParameters?.['sku'];
  if (!sku) {
    return ApiErrors.validation('sku path parameter is required', 'sku') as APIGatewayProxyResultV2;
  }

  try {
    const records = await resolveService().getBySku(tenantContext.tenantId, sku);
    if (records.length === 0) {
      return ApiErrors.inventoryNotFound(sku) as APIGatewayProxyResultV2;
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, records }),
    };
  } catch (error) {
    logger.error('Get inventory failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'inventory', action: 'read' }))
  .use(tenantContextMiddleware());
