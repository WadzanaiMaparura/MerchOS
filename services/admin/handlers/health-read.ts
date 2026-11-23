/**
 * Health (read only). Admin dashboard JWT authorizer, then RBAC `infrastructure`
 * read (Admin, and Support view only).
 *
 *   GET /admin/health?range=24h|7d
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { listAlerts } from '../lib/alerts';
import { listSellerUsers } from '../lib/cognito';
import { RANGE, getHealth, type HealthRange } from '../lib/health';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    if (event.routeKey !== 'GET /admin/health') return notFound();
    const range = (event.queryStringParameters?.['range'] ?? '24h') as HealthRange;
    if (!(range in RANGE)) return badRequest('Unknown range');
    const now = new Date();
    const [report, open, sellers] = await Promise.all([
      getHealth(process.env['ENVIRONMENT'] || 'dev', range, { paymentsLive: process.env['PAYMENTS_LIVE'] === 'true', now }),
      listAlerts('OPEN'),
      listSellerUsers(),
    ]);

    // An area with an open alert is never shown as fully working.
    const alertAreas = new Set(open.map((a) => a.area).filter(Boolean));
    const areas = report.areas.map((a) => ({
      ...a,
      openAlerts: open.filter((x) => x.area === a.id).length,
      status: alertAreas.has(a.id) && (a.status === 'working' || a.status === 'no_activity') ? 'some_errors' : a.status,
    }));

    // Seller businesses and new sign-ups in the range (first person to join each business).
    const firstJoin = new Map<string, string>();
    for (const u of sellers) {
      if (!u.tenantId) continue;
      const prev = firstJoin.get(u.tenantId);
      if (!prev || u.createdAt < prev) firstJoin.set(u.tenantId, u.createdAt);
    }
    const since = new Date(now.getTime() - RANGE[range].seconds * 1000).toISOString();

    return json(200, {
      ...report,
      areas,
      openAlerts: open.length,
      sellers: { businesses: firstJoin.size, newInRange: [...firstJoin.values()].filter((t) => t >= since).length },
    });
  } catch (err) {
    console.error('Health read failed', { error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'infrastructure', action: 'read' }));
