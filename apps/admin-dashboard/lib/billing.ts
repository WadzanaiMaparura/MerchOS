/**
 * Billing client (Admin API, read only). Admin staff only.
 */

import { fetchAuthSession } from 'aws-amplify/auth';
import { ADMIN_API_URL, AdminApiError } from './customers';

export type BillingStatus = 'paid' | 'lapsed' | 'problem';
export type BillingFilter = 'paying' | 'renewing' | 'lapsed' | 'problems' | 'all';

export interface BillingRow {
  tenantId: string;
  sellerId: string;
  businessName?: string;
  planId: string;
  planName: string;
  priceCents: number;
  monthlyProducts: number | null;
  subscriptionStatus: string;
  paidUntil?: string;
  since?: string;
  lastPayment?: { amountCents: number; at?: string; voucherCode?: string };
  status: BillingStatus;
  /** Payment cycle: grace (up to 3 days late), paused (day 3 to 37), closed (day 37 on). */
  stage?: 'none' | 'exempt' | 'paid' | 'due_soon' | 'grace' | 'paused' | 'closed';
  problems: number;
}

export interface BillingSummary {
  paying: number;
  byPlan: Record<string, number>;
  monthlyListCents: number;
  monthlyAfterVouchersCents: number;
  paidThisMonthCents: number;
  paymentsThisMonth: number;
  attention: { problems: number; lapsed: number };
}

export interface Invoice {
  invoiceId: string;
  invoiceNumber?: string;
  amountCents: number;
  voucherCode?: string;
  discountCents?: number;
  periodStart?: string;
  periodEnd?: string;
  createdAt?: string;
  hasPdf: boolean;
}

export interface Payment {
  mPaymentId: string;
  amountCents?: number;
  status?: string;
  applied: boolean;
  createdAt?: string;
}

export interface BillingDetail extends BillingRow {
  monthUsage: number | null;
  freeMonthsOwed: number;
  invoices: Invoice[];
  payments: Payment[];
}

async function call<T>(path: string): Promise<T> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new AdminApiError('Your session has expired. Please sign in again.', 401);
  const res = await fetch(`${ADMIN_API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new AdminApiError(res.status === 403 ? 'Billing is for Admin staff.' : (body.error?.message ?? `Request failed (${res.status})`), res.status);
  }
  return body;
}

export const billingApi = {
  list: (q: string, filter: BillingFilter) =>
    call<{ summary: BillingSummary; customers: BillingRow[]; counts: Record<BillingFilter, number> }>(
      `/admin/billing?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  get: async (tenantId: string) =>
    (await call<{ customer: BillingDetail }>(`/admin/billing/${encodeURIComponent(tenantId)}`)).customer,
  invoicePdf: async (tenantId: string, invoiceId: string) =>
    (
      await call<{ url: string }>(
        `/admin/billing/${encodeURIComponent(tenantId)}/invoices/${encodeURIComponent(invoiceId)}/pdf`,
      )
    ).url,
};
