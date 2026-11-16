/**
 * Get Billing Lambda handler — GET /billing
 *
 * Returns the authenticated tenant's billing overview: current plan, status,
 * billing period, usage/limits, and the credit-model balance for the current
 * month. Shaped as a `BillingOverview` (@merch-os/types) so the existing
 * seller-dashboard `useBilling` hook consumes it unchanged.
 *
 * RBAC: subscription:read. tenantId comes only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import type { BillingOverview } from '@merch-os/types';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { getPlan, PLAN_CATALOGUE } from '../../config/plans';
import { getBalance } from '../../services/credit-ledger';
import { getSubscription } from '../../services/subscription-store';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

/** Current billing month in YYYYMM (UTC). */
function currentBillingMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}${m}`;
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }
  const { tenantId } = tenantContext;

  try {
    const subscription = await getSubscription(tenantId);
    const yyyyMM = currentBillingMonth();
    const balance = await getBalance(tenantId, yyyyMM);

    // Resolve the plan catalogue entry for the active plan (default to starter
    // for display only when no subscription exists yet — status conveys reality).
    const planId = subscription?.planId ?? 'starter';
    const plan = getPlan(planId);

    // Credit model: granted/remaining are null for unmetered (enterprise).
    const unmetered = plan.monthlyCredits === null;

    const overview: BillingOverview = {
      planName: plan.name,
      planId,
      billingCycle: 'monthly',
      subscriptionStatus: subscription?.status ?? 'incomplete',
      currentPeriodStart: subscription?.currentPeriodStart ?? '',
      currentPeriodEnd: subscription?.currentPeriodEnd ?? '',
      // The credit model replaced per-feature counters; populate the legacy
      // UsageMeters best-effort from the credit balance so existing UI renders.
      usage: {
        products: 0,
        channels: 0,
        users: 0,
        aiCalls: balance.consumed,
        imageCalls: 0,
        csvExports: 0,
      },
      limits: plan.limits,
      credits: {
        granted: unmetered ? null : balance.granted,
        consumed: balance.consumed,
        overage: balance.overage,
        remaining: unmetered ? null : balance.remaining,
      },
      // The plan catalogue (ZAR, integer cents) so the plan picker renders the
      // real prices/allowances instead of hardcoded copies that can drift.
      plans: Object.values(PLAN_CATALOGUE),
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overview),
    };
  } catch (error) {
    logger.error('Get billing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'read' }))
  .use(tenantContextMiddleware());
