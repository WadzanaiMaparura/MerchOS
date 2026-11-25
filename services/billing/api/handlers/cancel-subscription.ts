/**
 * Cancel automatic billing — POST /billing/subscription/cancel
 *
 * Stops the monthly card charges at PayFast. The seller keeps their plan until
 * the end of the month already paid for; after that the usual grace / pause /
 * close cycle applies (they can pay again at any time).
 *
 * RBAC: subscription:update (the account owner). tenantId comes only from the JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import { tenantContextMiddleware, extractTenantContext } from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { setAutoRenew } from '../../../shared/entitlements/trial-gate';
import { loadPayFastConfig } from '../../providers/payfast';
import { PayFastSubscriptionsApi, isCardSubscriptionsOn, type SubscriptionsApi } from '../../providers/payfast-subscriptions';
import { getSubscription, updateCardSubscription } from '../../services/subscription-store';
import { ApiErrors, mapErrorToResponse } from '../error-mapper';

let injectedApi: SubscriptionsApi | undefined;
/** Test seam. */
export function setCancelSubscriptionsApi(api: SubscriptionsApi | undefined): void {
  injectedApi = api;
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const ctx = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!ctx) return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  if (!isCardSubscriptionsOn()) return ApiErrors.checkoutDisabled() as APIGatewayProxyResultV2;
  const { tenantId } = ctx;
  try {
    const sub = await getSubscription(tenantId);
    if (!sub?.payfastToken || sub.autoRenew !== true) {
      return json(409, { error: { code: 'NOT_AUTOMATIC', message: 'Automatic billing is not on for this account.' } });
    }
    const api = injectedApi ?? new PayFastSubscriptionsApi(await loadPayFastConfig());
    await api.cancel(sub.payfastToken);
    await updateCardSubscription(
      tenantId,
      { autoRenew: false, cancelledAt: new Date().toISOString(), nextPlanId: null },
      sub.payfastToken,
    );
    await setAutoRenew(tenantId, false).catch((error: unknown) =>
      logger.warn('Auto-renew flag not cleared on the entitlement', { error: String(error) }),
    );
    logger.info('Automatic billing cancelled by the seller', { tenantId });
    return json(200, { cancelled: true, paidUntil: sub.currentPeriodEnd ?? null });
  } catch (error) {
    logger.error('Cancel automatic billing failed', { error: error instanceof Error ? error.message : String(error) });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'update' }))
  .use(tenantContextMiddleware());
