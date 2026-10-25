/**
 * List Transactions Lambda handler — GET /inventory/{sku}/transactions
 *
 * Returns a SKU's immutable ledger history (newest first, paginated) for the
 * authenticated tenant. Domain field `txnId` is exposed to clients as
 * `transactionId` via DTO mapping (the shared domain type is unchanged).
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

  const parsed = paginationQuerySchema.safeParse(event.queryStringParameters ?? {});
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return ApiErrors.validation(
      first?.message ?? 'Invalid query parameters',
      first?.path.join('.')
    ) as APIGatewayProxyResultV2;
  }

  try {
    const result = await resolveService().listTransactions(tenantContext.tenantId, sku, {
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.nextToken !== undefined ? { nextToken: parsed.data.nextToken } : {}),
    });

    // DTO mapping: expose domain `txnId` as API `transactionId`.
    const transactions = result.items.map((t) => {
      const { txnId, ...rest } = t;
      return { transactionId: txnId, ...rest };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, transactions, nextToken: result.nextToken }),
    };
  } catch (error) {
    logger.error('List transactions failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'inventory', action: 'read' }))
  .use(tenantContextMiddleware());
