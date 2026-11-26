/**
 * Seller referral API (seller dashboard). Cognito JWT authorizer on every
 * route, then RBAC resource `referrals` and the tenant from the token.
 *
 *   GET  /referrals/me      my personal link and how my referrals are doing
 *   POST /referrals/claim   { code }: this new account signed up through someone's link
 *
 * notificationsHandler (RBAC `notifications`): the seller's bell, see below.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { extractTenantContext, tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { ensureProfile } from '../lib/accounts';
import { badRequest, conflict, json, notFound, readJson, serverError, tooMany, type HttpResult } from '../lib/http';
import { ensureReferralCode, referralLink } from '../lib/lifecycle';
import { normaliseCode } from '../lib/referral-code';
import { listNotifications, markAllRead, markRead, touchActivity } from '../lib/notifications';
import { createReferral, listReferralsBy, tenantForReferralCode, withinRateLimit } from '../lib/store';
import { z } from 'zod';

interface Caller {
  tenantId: string;
  userId: string;
}

function callerOf(event: APIGatewayProxyEventV2): Caller | null {
  const tenant = extractTenantContext(event as unknown as Record<string, unknown>);
  const ctx = event.requestContext as unknown as { authorizer?: { rbac?: { userId?: string } } };
  const userId = ctx.authorizer?.rbac?.userId;
  return tenant && userId ? { tenantId: tenant.tenantId, userId } : null;
}

async function me(caller: Caller): Promise<HttpResult> {
  const profile = await ensureProfile(caller.tenantId);
  if (!profile) return notFound('Account not found');
  const code = await ensureReferralCode(profile);
  const referrals = await listReferralsBy(caller.tenantId);
  const link = referralLink(code);
  return json(200, {
    code,
    link: link.url,
    linkLabel: link.label,
    // No details of the referred sellers: just how far each one has got.
    referrals: referrals
      .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt))
      .map((r) => ({ status: r.status, claimedAt: r.claimedAt, reward: r.reward ?? null })),
    freeMonthsEarned: referrals.filter((r) => r.reward === 'EARNED' || r.reward === 'APPLIED').length,
    freeMonthsApplied: referrals.filter((r) => r.reward === 'APPLIED').length,
  });
}

async function claim(event: APIGatewayProxyEventV2, caller: Caller): Promise<HttpResult> {
  if (!(await withinRateLimit('refclaim', caller.tenantId, 10, 3600))) return tooMany('Please try again later.');
  const code = normaliseCode((readJson(event) as { code?: unknown } | undefined)?.code);
  if (!code) return badRequest('That referral code is not valid.');

  const referrer = await tenantForReferralCode(code);
  if (!referrer) return notFound('That referral code was not found.');
  if (referrer === caller.tenantId) return badRequest('You cannot use your own referral link.');

  // The profile is the tenant's owner (emails go to the account that signed up).
  const profile = await ensureProfile(caller.tenantId);
  if (!profile) return notFound('Account not found');
  if (profile.referredByTenantId) {
    return json(200, { claimed: profile.referredByTenantId === referrer, alreadyReferred: true });
  }
  if (profile.subscribedAt) return conflict('Referral links are for new sellers who have not subscribed yet.');

  const created = await createReferral({
    referrerTenantId: referrer,
    referredTenantId: caller.tenantId,
    referredBusiness: profile.businessName,
    code,
    status: 'PENDING',
    claimedAt: new Date().toISOString(),
  });
  if (!created) return conflict('This account has already been referred, or has subscribed.');
  console.info('Referral claimed', { referrerTenantId: referrer, referredTenantId: caller.tenantId });
  return json(201, { claimed: true });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const caller = callerOf(event);
    if (!caller) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in again.' } });
    switch (event.routeKey) {
      case 'GET /referrals/me':
        return await me(caller);
      case 'POST /referrals/claim':
        return await claim(event, caller);
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Referral API failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'referrals', action: 'read' }))
  .use(tenantContextMiddleware());

// ─── Notifications (the bell) ────────────────────────────────────────────────
//   GET  /notifications        last 50, newest first, with the unread count
//   POST /notifications/read   { ids: [...] } or { all: true }

const readSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(z.string().min(1).max(260)).min(1).max(50) }),
]);

async function notificationsRoute(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const caller = callerOf(event);
    if (!caller) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in again.' } });
    switch (event.routeKey) {
      case 'GET /notifications':
        // The bell checks every minute while the dashboard is open: the account is in use.
        await touchActivity(caller.tenantId);
        return json(200, await listNotifications(caller.tenantId));
      case 'POST /notifications/read': {
        const parsed = readSchema.safeParse(readJson(event));
        if (!parsed.success) return badRequest('Nothing to mark as read.');
        if ('all' in parsed.data) await markAllRead(caller.tenantId);
        else await markRead(caller.tenantId, parsed.data.ids);
        return json(200, await listNotifications(caller.tenantId));
      }
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Notifications API failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

/** Own notifications only (tenant from the token); marking them read needs no more than reading. */
export const notificationsHandler = middy(notificationsRoute)
  .use(rbacMiddleware({ resource: 'notifications', action: 'read' }))
  .use(tenantContextMiddleware());
