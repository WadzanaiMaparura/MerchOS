/**
 * GET /billing/profile - the seller's invoicing details (or null if not set).
 * RBAC: subscription:read. tenantId comes only from the trusted JWT.
 */
import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { getBillingProfile } from '../../services/billing-profile';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }
  try {
    const profile = await getBillingProfile(tenantContext.tenantId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    };
  } catch (error) {
    logger.error('Get billing profile failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'read' }))
  .use(tenantContextMiddleware());
