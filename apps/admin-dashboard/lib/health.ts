/** Health and Alerts clients (Admin API). Support: view only; Admin: also resolve and add notes. */

import { fetchAuthSession } from 'aws-amplify/auth';
import { ADMIN_API_URL, AdminApiError } from './customers';

export type AreaStatus = 'working' | 'some_errors' | 'down' | 'not_live' | 'no_activity';
export type HealthRange = '24h' | '7d';

export interface AreaHealth {
  id: string;
  label: string;
  covers: string;
  status: AreaStatus;
  requests: number;
  errors: number;
  sent?: number;
  bounced?: number;
  openAlerts: number;
}

export interface HealthReport {
  range: HealthRange;
  checkedAt: string;
  areas: AreaHealth[];
  errorSeries: Array<{ at: string; errors: number }>;
  writing: { requests: number; inputTokens: number; outputTokens: number; approxCostCents: number };
  openAlerts: number;
  sellers: { businesses: number; newInRange: number };
}

export interface AlertNote {
  at: string;
  by: string;
  byEmail?: string;
  text: string;
}

export interface Alert {
  alertId: string;
  key: string;
  source: 'area' | 'alarm';
  area?: string;
  title: string;
  description: string;
  whatToDo: string;
  status: 'OPEN' | 'RESOLVED';
  startedAt: string;
  lastSeenAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolvedByEmail?: string;
  resolutionNote?: string;
  notes: AlertNote[];
}

export interface Check {
  key: string;
  label: string;
  area: string;
  kind: 'health' | 'alarm';
  state: 'ok' | 'alert' | 'no_data';
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new AdminApiError('Your session has expired. Please sign in again.', 401);
  const res = await fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new AdminApiError(res.status === 403 ? 'Your role cannot do this.' : (body.error?.message ?? `Request failed (${res.status})`), res.status);
  }
  return body;
}

export const healthApi = {
  health: (range: HealthRange) => call<HealthReport>(`/admin/health?range=${range}`),
  alerts: (status: 'open' | 'resolved') =>
    call<{ alerts: Alert[]; openCount: number; checks: Check[] }>(`/admin/alerts?status=${status}`),
  resolve: (alertId: string, note: string) =>
    call(`/admin/alerts/${encodeURIComponent(alertId)}/resolve`, { method: 'POST', body: JSON.stringify(note ? { note } : {}) }),
  addNote: (alertId: string, note: string) =>
    call(`/admin/alerts/${encodeURIComponent(alertId)}/notes`, { method: 'POST', body: JSON.stringify({ note }) }),
};
