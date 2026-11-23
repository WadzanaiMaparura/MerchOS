/**
 * Alerts (read only). RBAC `alerts` read (Admin, and Support view only).
 *
 *   GET /admin/alerts?status=open|resolved     alerts, plus every automatic check and its state
 *   GET /admin/alerts/unresolved-count         a number (nav badge)
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { countOpen, listAlerts, type Alert } from '../lib/alerts';
import { alarmWording } from '../lib/alarm-catalogue';
import { staffDirectory } from '../lib/audit-feed';
import { AREAS } from '../lib/health';
import { badRequest, json, notFound, serverError, type HttpResult } from '../lib/http';

let cw: CloudWatchClient | undefined;
/** @internal tests only */
export function _setCloudWatch(value: CloudWatchClient | undefined): void {
  cw = value;
}

export interface Check {
  key: string;
  label: string;
  area: string;
  kind: 'health' | 'alarm';
  state: 'ok' | 'alert' | 'no_data';
}

async function existingAlarms(env: string): Promise<Check[]> {
  cw ??= new CloudWatchClient({});
  const out: Check[] = [];
  let token: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await cw.send(new DescribeAlarmsCommand({ AlarmNamePrefix: 'merch-os-', MaxRecords: 100, ...(token ? { NextToken: token } : {}) }));
    for (const a of res.MetricAlarms ?? []) {
      if (!a.AlarmName?.endsWith(`-${env}`)) continue;
      const w = alarmWording(a.AlarmName, env, a.AlarmDescription);
      out.push({
        key: `alarm:${a.AlarmName}`,
        label: w.title,
        area: w.area,
        kind: 'alarm',
        state: a.StateValue === 'ALARM' ? 'alert' : a.StateValue === 'OK' ? 'ok' : 'no_data',
      });
    }
    token = res.NextToken;
    if (!token) break;
  }
  return out;
}

async function list(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const status = (event.queryStringParameters?.['status'] ?? 'open').toLowerCase();
  if (status !== 'open' && status !== 'resolved') return badRequest('Unknown status');
  const env = process.env['ENVIRONMENT'] || 'dev';
  const [alerts, open, alarms, staff] = await Promise.all([
    listAlerts(status === 'open' ? 'OPEN' : 'RESOLVED'),
    status === 'open' ? Promise.resolve<Alert[] | null>(null) : listAlerts('OPEN'),
    existingAlarms(env),
    staffDirectory(),
  ]);
  const openNow = open ?? alerts;
  const openKeys = new Set(openNow.map((a) => a.key));
  const checks: Check[] = [
    ...AREAS.map((a) => ({
      key: `area:${a.id}`,
      label: `${a.label}: errors every 15 minutes`,
      area: a.id,
      kind: 'health' as const,
      state: openKeys.has(`area:${a.id}`) ? ('alert' as const) : ('ok' as const),
    })),
    ...alarms,
  ];
  const who = (id?: string) => (id && id !== 'auto' ? staff.get(id)?.email ?? 'Former staff member' : undefined);
  return json(200, {
    alerts: alerts.map((a) => ({
      ...a,
      resolvedByEmail: who(a.resolvedBy),
      notes: (a.notes ?? []).map((n) => ({ ...n, byEmail: who(n.by) })),
    })),
    openCount: openNow.length,
    checks,
  });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    switch (event.routeKey) {
      case 'GET /admin/alerts':
        return await list(event);
      case 'GET /admin/alerts/unresolved-count':
        // The shared nav badge hook expects a bare number.
        return json(200, await countOpen());
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Alerts read failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'alerts', action: 'read' }));
