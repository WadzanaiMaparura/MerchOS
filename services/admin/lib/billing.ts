/**
 * Billing overview for staff (read only). Money moves only through PayFast and
 * the Billing API; nothing here writes to billing.
 *
 * Billing table (merch-os-billing-<env>), PK = TENANT#<tenantId>:
 *   SUBSCRIPTION#current   plan, status, paid period
 *   INVOICE#<id>           paid invoice (number + pdfKey once the PDF is issued)
 *   PAYMENT#<mPaymentId>   PayFast payment claim; applied=true once fully applied
 *
 * There is no index across tenants yet, so the overview scans the table for
 * those three item types. Fine for hundreds of customers; add a GSI before
 * thousands.
 */

import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { PLAN_CATALOGUE } from '../../billing/config/plans';
import { billingStage, type BillingStage } from '../../shared/entitlements/billing-stage';
import { config } from './config';
import { sellerIdOf } from './customers';
import { db, getTenantInfos } from './data';

type Item = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** A payment PayFast sent that was not fully applied after this long needs a look. */
export const PAYMENT_PROBLEM_AFTER_MS = 15 * 60 * 1000;
export const RENEWING_SOON_DAYS = 7;

export type BillingStatus = 'paid' | 'lapsed' | 'problem';
export type BillingFilter = 'paying' | 'renewing' | 'lapsed' | 'problems' | 'all';
export const BILLING_FILTERS: readonly BillingFilter[] = ['paying', 'renewing', 'lapsed', 'problems', 'all'];

export interface Invoice {
  invoiceId: string;
  invoiceNumber?: string | undefined;
  planId?: string | undefined;
  amountCents: number;
  listPriceCents?: number | undefined;
  voucherCode?: string | undefined;
  discountCents?: number | undefined;
  periodStart?: string | undefined;
  periodEnd?: string | undefined;
  createdAt?: string | undefined;
  hasPdf: boolean;
}

export interface Payment {
  mPaymentId: string;
  planId?: string | undefined;
  amountCents?: number | undefined;
  status?: string | undefined;
  applied: boolean;
  createdAt?: string | undefined;
  appliedAt?: string | undefined;
}

export interface BillingRow {
  tenantId: string;
  sellerId: string;
  businessName?: string | undefined;
  planId: string;
  planName: string;
  priceCents: number;
  monthlyProducts: number | null;
  subscriptionStatus: string;
  paidUntil?: string | undefined;
  since?: string | undefined;
  lastPayment?: { amountCents: number; at?: string | undefined; voucherCode?: string | undefined } | undefined;
  status: BillingStatus;
  /** Where the seller is in the payment cycle (grace, paused, closed once lapsed). */
  stage: BillingStage;
  /** Payments PayFast sent that were not fully applied (needs a look). */
  problems: number;
}

export interface BillingSummary {
  paying: number;
  byPlan: Record<string, number>;
  /** Sum of list prices of paying customers (one month). */
  monthlyListCents: number;
  /** What paying customers actually paid on their latest invoice. */
  monthlyAfterVouchersCents: number;
  /** Invoices dated this calendar month (South African time). */
  paidThisMonthCents: number;
  paymentsThisMonth: number;
  attention: { problems: number; lapsed: number };
}

interface TenantBilling {
  subscription?: Item | undefined;
  invoices: Invoice[];
  payments: Payment[];
}

export function toInvoice(i: Item): Invoice {
  return {
    invoiceId: String(i['invoiceId'] ?? String(i['SK']).slice(8)),
    invoiceNumber: str(i['invoiceNumber']),
    planId: str(i['planId']),
    amountCents: num(i['amountPaid']) ?? num(i['amountDue']) ?? 0,
    listPriceCents: num(i['listPriceCents']),
    voucherCode: str(i['voucherCode']),
    discountCents: num(i['discountCents']),
    periodStart: str(i['periodStart']),
    periodEnd: str(i['periodEnd']),
    createdAt: str(i['createdAt']),
    hasPdf: !!str(i['pdfKey']),
  };
}

export function toPayment(i: Item): Payment {
  return {
    mPaymentId: String(i['mPaymentId'] ?? String(i['SK']).slice(8)),
    planId: str(i['planId']),
    amountCents: num(i['amountGrossCents']),
    status: str(i['paymentStatus']),
    applied: i['applied'] === true,
    createdAt: str(i['createdAt']),
    appliedAt: str(i['appliedAt']),
  };
}

export function isProblem(p: Payment, now: Date): boolean {
  if (p.applied) return false;
  const at = p.createdAt ? Date.parse(p.createdAt) : NaN;
  return Number.isFinite(at) && now.getTime() - at > PAYMENT_PROBLEM_AFTER_MS;
}

/** YYYY-MM of an instant in South African time. */
export function sastMonth(d: Date): string {
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

async function scanBilling(): Promise<Map<string, TenantBilling>> {
  const out = new Map<string, TenantBilling>();
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 200; page++) {
    const res = await db().send(
      new ScanCommand({
        TableName: config.billingTable,
        FilterExpression: 'begins_with(SK, :s) OR begins_with(SK, :i) OR begins_with(SK, :p)',
        ExpressionAttributeValues: { ':s': 'SUBSCRIPTION#', ':i': 'INVOICE#', ':p': 'PAYMENT#' },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const item of res.Items ?? []) {
      const pk = String(item['PK']);
      if (!pk.startsWith('TENANT#')) continue;
      const tenantId = pk.slice(7);
      const entry = out.get(tenantId) ?? { invoices: [], payments: [] };
      const sk = String(item['SK']);
      if (sk === 'SUBSCRIPTION#current') entry.subscription = item;
      else if (sk.startsWith('INVOICE#')) entry.invoices.push(toInvoice(item));
      else if (sk.startsWith('PAYMENT#')) entry.payments.push(toPayment(item));
      out.set(tenantId, entry);
    }
    startKey = res.LastEvaluatedKey;
    if (!startKey) break;
  }
  for (const e of out.values()) {
    e.invoices.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    e.payments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  return out;
}

const plans = PLAN_CATALOGUE as Record<string, { name: string; priceZARCents: number | null; monthlyProducts: number | null } | undefined>;

export function toRow(tenantId: string, b: TenantBilling, businessName: string | undefined, now: Date): BillingRow | null {
  const s = b.subscription;
  if (!s) return null;
  const planId = String(s['planId'] ?? '');
  const plan = plans[planId];
  const paidUntil = str(s['currentPeriodEnd']);
  const active = s['status'] === 'active' && !!paidUntil && paidUntil > now.toISOString();
  const problems = b.payments.filter((p) => isProblem(p, now)).length;
  const last = b.invoices[0];
  return {
    tenantId,
    sellerId: sellerIdOf(tenantId),
    businessName,
    planId,
    planName: plan?.name ?? planId,
    priceCents: num(s['priceZARCents']) ?? plan?.priceZARCents ?? 0,
    monthlyProducts: plan?.monthlyProducts ?? null,
    subscriptionStatus: String(s['status'] ?? ''),
    paidUntil,
    since: str(s['createdAt']),
    lastPayment: last ? { amountCents: last.amountCents, at: last.createdAt, voucherCode: last.voucherCode } : undefined,
    status: problems > 0 ? 'problem' : active ? 'paid' : 'lapsed',
    stage: s['status'] === 'active' ? billingStage({ status: 'subscribed', subscribedUntil: paidUntil }, now) : 'none',
    problems,
  };
}

export function matchesBillingFilter(r: BillingRow, f: BillingFilter, now: Date): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'paying':
      return r.status !== 'lapsed';
    case 'renewing':
      return r.status === 'paid' && !!r.paidUntil && Date.parse(r.paidUntil) - now.getTime() <= RENEWING_SOON_DAYS * 86_400_000;
    case 'lapsed':
      return r.status === 'lapsed';
    case 'problems':
      return r.status === 'problem';
  }
}

export function summarise(rows: BillingRow[], all: Map<string, TenantBilling>, now: Date): BillingSummary {
  const paying = rows.filter((r) => r.status !== 'lapsed');
  const byPlan: Record<string, number> = {};
  for (const r of paying) byPlan[r.planName] = (byPlan[r.planName] ?? 0) + 1;
  const month = sastMonth(now);
  let paidThisMonthCents = 0;
  let paymentsThisMonth = 0;
  for (const b of all.values()) {
    for (const i of b.invoices) {
      if (i.createdAt && sastMonth(new Date(i.createdAt)) === month) {
        paidThisMonthCents += i.amountCents;
        paymentsThisMonth += 1;
      }
    }
  }
  return {
    paying: paying.length,
    byPlan,
    monthlyListCents: paying.reduce((s, r) => s + r.priceCents, 0),
    monthlyAfterVouchersCents: paying.reduce((s, r) => s + (r.lastPayment?.amountCents ?? r.priceCents), 0),
    paidThisMonthCents,
    paymentsThisMonth,
    attention: { problems: rows.filter((r) => r.status === 'problem').length, lapsed: rows.filter((r) => r.status === 'lapsed').length },
  };
}

export function matchesBillingSearch(r: BillingRow, q: string, invoices: Invoice[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    (r.businessName ?? '').toLowerCase().includes(s) ||
    r.sellerId.toLowerCase().includes(s) ||
    r.planName.toLowerCase().includes(s) ||
    invoices.some((i) => (i.invoiceNumber ?? '').toLowerCase().includes(s))
  );
}

export interface BillingOverview {
  rows: BillingRow[];
  summary: BillingSummary;
  invoicesBy: Map<string, Invoice[]>;
  paymentsBy: Map<string, Payment[]>;
}

export async function loadBilling(now: Date = new Date()): Promise<BillingOverview> {
  const all = await scanBilling();
  const tenantIds = [...all.keys()].filter((t) => all.get(t)!.subscription);
  const infos = await getTenantInfos(tenantIds.map((tenantId) => ({ tenantId })));
  const rows = tenantIds
    .map((t) => toRow(t, all.get(t)!, infos.get(t)?.businessName, now))
    .filter((r): r is BillingRow => !!r)
    .sort((a, b) => String(a.paidUntil).localeCompare(String(b.paidUntil)));
  return {
    rows,
    summary: summarise(rows, all, now),
    invoicesBy: new Map([...all].map(([t, b]) => [t, b.invoices])),
    paymentsBy: new Map([...all].map(([t, b]) => [t, b.payments])),
  };
}
