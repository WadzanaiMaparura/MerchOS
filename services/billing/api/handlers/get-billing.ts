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
import type { BillingAccountState, BillingOverview } from '@merch-os/types';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { getPlan, PLAN_CATALOGUE } from '../../config/plans';
import { getBalance } from '../../services/credit-ledger';
import { getSubscription, type SubscriptionRecord } from '../../services/subscription-store';
import { getEntitlement } from '../../../shared/entitlements/trial-gate';
import {
  billingStage,
  comebackOffer,
  isBillingLifecycleOn,
  stageDates,
} from '../../../shared/entitlements/billing-stage';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

/** Current billing month in YYYYMM (UTC). */
function currentBillingMonth(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}${m}`;
}

/**
 * The payment-cycle stage. Read from the entitlement (it also knows "free
 * unlimited" accounts, which never pause); falls back to the subscription's
 * paid-until if the entitlement cannot be read.
 */
export async function accountState(
  tenantId: string,
  subscription: SubscriptionRecord | null,
  now: Date = new Date(),
): Promise<BillingAccountState> {
  let entitlement: { status: string; subscribedUntil?: string } | null = null;
  try {
    entitlement = await getEntitlement(tenantId);
  } catch (error) {
    logger.warn('Billing stage: entitlement not readable, using the subscription', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const source =
    entitlement ??
    (subscription?.status === 'active' && subscription.currentPeriodEnd
      ? { status: 'subscribed', subscribedUntil: subscription.currentPeriodEnd }
      : null);
  const stage = billingStage(source, now);
  const paidUntil = source?.subscribedUntil;
  const dates = paidUntil && stage !== 'exempt' ? stageDates(paidUntil) : undefined;
  const offer = comebackOffer(subscription?.currentPeriodEnd, subscription?.comebackUsedAt, now);
  return {
    stage,
    lifecycleEnabled: isBillingLifecycleOn(),
    ...(subscription?.planId ? { lastPlanId: subscription.planId } : {}),
    ...(dates
      ? {
          paidUntil: dates.paidUntil,
          graceEndsAt: dates.graceEndsAt,
          closesAt: dates.closesAt,
          dataKeptUntil: dates.dataKeptUntil,
        }
      : {}),
    ...(offer && isBillingLifecycleOn() ? { comeback: offer } : {}),
  };
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
      account: await accountState(tenantId, subscription),
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
