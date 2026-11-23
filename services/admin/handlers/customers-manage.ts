/**
 * Account actions. RBAC `users` update (Admin only).
 *
 *   POST /admin/customers/{tenantId}/disable   { reason }   every person in the business:
 *                                                           sign-in blocked, signed out everywhere
 *   POST /admin/customers/{tenantId}/enable    { reason }
 *   POST /admin/customers/{tenantId}/exempt    { exempt: true|false, reason }   free unlimited account
 *
 * Data is never deleted. Every action is written to the audit log with who did it and why.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { PLAN_CATALOGUE } from '../../billing/config/plans';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { putState, recordAudit } from '../lib/audit';
import { disableUser, enableUser, listSellerUsers } from '../lib/cognito';
import { getEntitlements, getSubscriptions } from '../lib/data';
import { grantExempt, removeExempt, statusAfterExempt } from '../lib/exempt';
import { UUID, badRequest, conflict, json, notFound, readJson, serverError, staffOf, type HttpResult } from '../lib/http';

const reason = z.string().trim().min(3, 'Please give a reason (it goes in the audit log).').max(500);
const stateSchema = z.object({ reason });
const exemptSchema = z.object({ exempt: z.boolean(), reason });
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? 'Invalid request';

async function members(tenantId: string) {
  return (await listSellerUsers()).filter((u) => u.tenantId === tenantId);
}

async function setDisabled(event: APIGatewayProxyEventV2, tenantId: string, disabled: boolean): Promise<HttpResult> {
  const parsed = stateSchema.safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const staff = staffOf(event);
  const people = await members(tenantId);
  if (!people.length) return notFound('Customer not found');
  for (const p of people) {
    if (disabled) await disableUser(p.userId);
    else await enableUser(p.userId);
  }
  const at = new Date().toISOString();
  await putState(tenantId, { disabled, changedAt: at, changedBy: staff.userId, reason: parsed.data.reason });
  await recordAudit(
    { tenantId },
    {
      action: disabled ? 'disable' : 'enable',
      by: staff.userId,
      byRole: staff.role,
      reason: parsed.data.reason,
      detail: `${people.length} ${people.length === 1 ? 'person' : 'people'}`,
    },
  );
  return json(200, { disabled, people: people.length });
}

async function setExempt(event: APIGatewayProxyEventV2, tenantId: string): Promise<HttpResult> {
  const parsed = exemptSchema.safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const staff = staffOf(event);
  if (!(await members(tenantId)).length) return notFound('Customer not found');

  if (parsed.data.exempt) {
    await grantExempt(tenantId, staff.userId);
  } else {
    const subscription = (await getSubscriptions([tenantId])).get(tenantId);
    const plan = subscription
      ? (PLAN_CATALOGUE as Record<string, { monthlyProducts: number | null } | undefined>)[subscription.planId]
      : undefined;
    const current = (await getEntitlements([tenantId])).get(tenantId);
    if (current?.status !== 'exempt') return conflict('This account is not a free unlimited account.');
    if (!(await removeExempt(tenantId, statusAfterExempt(subscription, plan?.monthlyProducts)))) {
      return conflict('This account is not a free unlimited account.');
    }
  }
  await recordAudit(
    { tenantId },
    { action: parsed.data.exempt ? 'exempt' : 'remove-exempt', by: staff.userId, byRole: staff.role, reason: parsed.data.reason },
  );
  return json(200, { exempt: parsed.data.exempt });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const tenantId = event.pathParameters?.['tenantId'];
    if (!tenantId || !UUID.test(tenantId)) return badRequest('Invalid customer id');
    switch (event.routeKey) {
      case 'POST /admin/customers/{tenantId}/disable':
        return await setDisabled(event, tenantId, true);
      case 'POST /admin/customers/{tenantId}/enable':
        return await setDisabled(event, tenantId, false);
      case 'POST /admin/customers/{tenantId}/exempt':
        return await setExempt(event, tenantId);
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Customer action failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'users', action: 'update' }));
