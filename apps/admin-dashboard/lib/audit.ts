/** Audit log client (Admin API, read only). Admin staff only. */

import { fetchAuthSession } from 'aws-amplify/auth';
import { ADMIN_API_URL, AdminApiError } from './customers';

export interface AuditEvent {
  id: string;
  at: string;
  action: string;
  label: string;
  byId: string;
  byEmail?: string;
  byRole?: string;
  tenantId?: string;
  subject?: string;
  reason?: string;
  detail?: string;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  action?: string;
  staff?: string;
  q?: string;
  page: number;
  pageSize: number;
}

export interface AuditResponse {
  events: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  staff: Array<{ id: string; email: string; role: string }>;
  actions: Array<{ id: string; label: string }>;
}

export async function fetchAudit(query: AuditQuery): Promise<AuditResponse> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new AdminApiError('Your session has expired. Please sign in again.', 401);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
  const res = await fetch(`${ADMIN_API_URL}/admin/audit?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & AuditResponse;
  if (!res.ok) {
    throw new AdminApiError(res.status === 403 ? 'The audit log is for Admin staff.' : (body.error?.message ?? `Request failed (${res.status})`), res.status);
  }
  return body;
}
