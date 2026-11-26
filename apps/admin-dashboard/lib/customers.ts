/**
 * Customers client (Admin API, NEXT_PUBLIC_ADMIN_API_URL). Cognito access token
 * from the admin session on every call.
 */

import { fetchAuthSession } from 'aws-amplify/auth';

export const ADMIN_API_URL = (process.env.NEXT_PUBLIC_ADMIN_API_URL ?? '').replace(/\/$/, '');

export type PlanKind = 'not_started' | 'trial' | 'paid' | 'exempt';
export type AccountStatus = 'active' | 'disabled' | 'not_verified' | 'profile_incomplete';
export type CustomerFilter = 'all' | 'trial' | 'paid' | 'exempt' | 'not_verified' | 'disabled';

export interface CustomerRow {
  key: string;
  kind: 'tenant' | 'signup';
  tenantId?: string;
  sellerId?: string;
  businessName?: string;
  ownerUserId: string;
  ownerName?: string;
  ownerEmail: string;
  phone?: string;
  signedUpAt: string;
  plan: { kind: PlanKind; label: string; planId?: string };
  products: number;
  account: AccountStatus;
  teamSize: number;
}

export interface AuditEntry {
  at: string;
  action: 'resend-verification' | 'disable' | 'enable' | 'exempt' | 'remove-exempt' | 'data-hold' | 'data-hold-removed' | 'data-deleted';
  by: string;
  byRole: string;
  reason?: string;
  detail?: string;
}

export interface CustomerDetail extends CustomerRow {
  team: Array<{ userId: string; email: string; role?: string; status: string; enabled: boolean; emailVerified: boolean }>;
  marketingConsent: { granted: boolean; capturedAt?: string } | null;
  subscription?: { planId: string; status: string; currentPeriodEnd?: string };
  invoices: Array<{ invoiceId: string; invoiceNumber?: string; amountCents: number; createdAt?: string }>;
  engagement: {
    emailsSent: Array<{ email: string; sentAt?: string }>;
    marketingOptOut: boolean;
    referralCode?: string;
    referredByBusiness?: string;
    referralsMade: number;
    freeMonthsEarned: number;
    review?: { rating: number; status: string };
  };
  audit: AuditEntry[];
  /** Data retention (older API responses may not have it). */
  dataRetention?: {
    hold: { by: string; reason: string; at: string } | null;
    plannedOn: string | null;
    reason: 'closed' | 'inactive' | null;
    note?: string;
    warnedAt?: string;
  };
}

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
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
    const message =
      res.status === 403 ? 'Your role cannot do this.' : (body.error?.message ?? `Request failed (${res.status})`);
    throw new AdminApiError(message, res.status);
  }
  return body;
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) });
const id = (tenantId: string) => encodeURIComponent(tenantId);

export const customersApi = {
  list: (q: string, filter: CustomerFilter) =>
    call<{ customers: CustomerRow[]; counts: Record<CustomerFilter, number> }>(
      `/admin/customers?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  get: async (tenantId: string) => (await call<{ customer: CustomerDetail }>(`/admin/customers/${id(tenantId)}`)).customer,
  resendVerification: (userId: string) => post('/admin/customers/resend-verification', { userId }),
  disable: (tenantId: string, reason: string) => post(`/admin/customers/${id(tenantId)}/disable`, { reason }),
  enable: (tenantId: string, reason: string) => post(`/admin/customers/${id(tenantId)}/enable`, { reason }),
  setExempt: (tenantId: string, exempt: boolean, reason: string) =>
    post(`/admin/customers/${id(tenantId)}/exempt`, { exempt, reason }),
  setHold: (tenantId: string, hold: boolean, reason: string) =>
    post(`/admin/customers/${id(tenantId)}/hold`, { hold, reason }),
};
