/**
 * PUT /billing/profile - set the seller's invoicing details.
 * RBAC: subscription:update. tenantId comes only from the trusted JWT.
 *
 * The body is validated strictly (unknown fields rejected). Changing the profile
 * affects FUTURE invoices only: each invoice keeps the snapshot taken when it
 * was issued.
 */
import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { putBillingProfile, type BillingProfileInput } from '../../services/billing-profile';
import { billingProfileSchema } from '../schemas';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return ApiErrors.validation('Invalid JSON body') as APIGatewayProxyResultV2;
  }

  const parsed = billingProfileSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return ApiErrors.validation(
      first?.message ?? 'Invalid request body',
      first?.path.join('.')
    ) as APIGatewayProxyResultV2;
  }

  try {
    const profile = await putBillingProfile(tenantContext.tenantId, parsed.data as BillingProfileInput);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    };
  } catch (error) {
    logger.error('Put billing profile failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'update' }))
  .use(tenantContextMiddleware());
