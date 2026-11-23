/**
 * Audit log (read only). Admin dashboard JWT authorizer, then RBAC `audit-log`
 * read (Admin only).
 *
 *   GET /admin/audit?from=YYYY-MM-DD&to=YYYY-MM-DD&action=&staff=&q=&page=&pageSize=
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { AUDIT_ACTIONS, loadAudit, type AuditActionType } from '../lib/audit-feed';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A South African calendar day as an ISO range (SAST is UTC+2, no daylight saving). */
export function sastDayStart(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00+02:00`)).toISOString();
}
export function sastDayEnd(date: string): string {
  return new Date(Date.parse(`${date}T23:59:59.999+02:00`)).toISOString();
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    if (event.routeKey !== 'GET /admin/audit') return notFound();
    const p = event.queryStringParameters ?? {};
    for (const d of [p['from'], p['to']]) if (d && !DATE.test(d)) return badRequest('Dates must be YYYY-MM-DD');
    const action = p['action'] as AuditActionType | undefined;
    if (action && !(action in AUDIT_ACTIONS)) return badRequest('Unknown action');
    const page = Math.max(1, Number(p['page'] ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(p['pageSize'] ?? 50) || 50));

    const { events, staff } = await loadAudit({
      from: p['from'] ? sastDayStart(p['from']) : undefined,
      to: p['to'] ? sastDayEnd(p['to']) : undefined,
      action,
      staff: p['staff'] || undefined,
      q: (p['q'] ?? '').slice(0, 100) || undefined,
    });
    return json(200, {
      events: events.slice((page - 1) * pageSize, page * pageSize),
      total: events.length,
      page,
      pageSize,
      staff,
      actions: Object.entries(AUDIT_ACTIONS).map(([id, label]) => ({ id, label })),
    });
  } catch (err) {
    console.error('Audit read failed', { error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'audit-log', action: 'read' }));
