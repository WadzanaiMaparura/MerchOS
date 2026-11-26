/**
 * A "customer" is one seller business (tenant): its owner, team, plan, usage
 * and history, joined from Cognito and the other services' tables. People who
 * started signing up but never entered the email code have no business yet;
 * they are listed too (kind 'signup'), keyed by their user id.
 */

import { PLAN_CATALOGUE } from '../../billing/config/plans';
import { listAudit, getState, type AccountState, type AuditEntry } from './audit';
import { listSellerUsers, listUnfinishedSignUps, type SellerUser } from './cognito';
import { config } from './config';
import { plannedDeletion, type RetentionReason } from './retention-rules';
import { getHold, getRetention, type Hold } from './retention-store';
import {
  batchGet,
  countProducts,
  getConsent,
  getEngagement,
  getEntitlements,
  getSubscriptions,
  getTenantInfos,
  listInvoices,
  mapLimit,
  type EngagementInfo,
  type EntitlementInfo,
  type InvoiceInfo,
  type SubscriptionInfo,
} from './data';

export const TRIAL_PRODUCT_LIMIT = 15;

export type PlanKind = 'not_started' | 'trial' | 'paid' | 'exempt';
export type AccountStatus = 'active' | 'disabled' | 'not_verified' | 'profile_incomplete';
export type CustomerFilter = 'all' | 'trial' | 'paid' | 'exempt' | 'not_verified' | 'disabled';
export const CUSTOMER_FILTERS: readonly CustomerFilter[] = ['all', 'trial', 'paid', 'exempt', 'not_verified', 'disabled'];

export interface CustomerRow {
  /** tenantId, or "signup:<userId>" for an unfinished sign-up. */
  key: string;
  kind: 'tenant' | 'signup';
  tenantId?: string | undefined;
  /** Same short id the seller sees in their dashboard, e.g. MOS-7E22ED. */
  sellerId?: string | undefined;
  businessName?: string | undefined;
  ownerUserId: string;
  ownerName?: string | undefined;
  ownerEmail: string;
  phone?: string | undefined;
  signedUpAt: string;
  plan: { kind: PlanKind; label: string; planId?: string | undefined };
  products: number;
  account: AccountStatus;
  teamSize: number;
}

export function sellerIdOf(tenantId: string): string {
  return `MOS-${tenantId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`;
}

const planName = (planId: string) =>
  (PLAN_CATALOGUE as Record<string, { name: string; monthlyProducts: number | null } | undefined>)[planId];

export function planOf(
  entitlement: EntitlementInfo | undefined,
  subscription: SubscriptionInfo | undefined,
  products: number,
  now: Date = new Date(),
): CustomerRow['plan'] {
  if (entitlement?.status === 'exempt') return { kind: 'exempt', label: 'Free unlimited' };
  const paying =
    subscription?.status === 'active' && !!subscription.currentPeriodEnd && subscription.currentPeriodEnd > now.toISOString();
  if (paying) {
    return { kind: 'paid', label: planName(subscription!.planId)?.name ?? subscription!.planId, planId: subscription!.planId };
  }
  if (!entitlement && products === 0) return { kind: 'not_started', label: 'Not started' };
  return { kind: 'trial', label: `Trial ${Math.min(products, TRIAL_PRODUCT_LIMIT)}/${TRIAL_PRODUCT_LIMIT}` };
}

export function matchesFilter(row: CustomerRow, filter: CustomerFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'trial':
      return row.plan.kind === 'trial' || row.plan.kind === 'not_started';
    case 'paid':
      return row.plan.kind === 'paid';
    case 'exempt':
      return row.plan.kind === 'exempt';
    case 'not_verified':
      return row.account === 'not_verified' || row.account === 'profile_incomplete';
    case 'disabled':
      return row.account === 'disabled';
  }
}

/** Email, business, owner name, phone (digits) or seller id. */
export function matchesSearch(row: CustomerRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  const phone = (row.phone ?? '').replace(/\D/g, '');
  // South African numbers are typed locally (082...) but stored +27 82...
  const phoneMatch =
    digits.length >= 4 && (phone.includes(digits) || (digits.startsWith('0') && phone.includes(`27${digits.slice(1)}`)));
  return (
    row.ownerEmail.toLowerCase().includes(q) ||
    (row.businessName ?? '').toLowerCase().includes(q) ||
    (row.ownerName ?? '').toLowerCase().includes(q) ||
    (row.sellerId ?? '').toLowerCase().includes(q) ||
    phoneMatch
  );
}

interface Snapshot {
  rows: CustomerRow[];
  team: Map<string, SellerUser[]>;
}

/** Everything the list needs, in a handful of batched reads. */
export async function loadCustomers(now: Date = new Date()): Promise<Snapshot> {
  const [sellers, unfinished] = await Promise.all([listSellerUsers(), listUnfinishedSignUps()]);

  const team = new Map<string, SellerUser[]>();
  for (const u of sellers) {
    if (!u.tenantId) continue;
    team.set(u.tenantId, [...(team.get(u.tenantId) ?? []), u]);
  }
  const tenantIds = [...team.keys()];
  const [infos, entitlements, subscriptions, counts] = await Promise.all([
    getTenantInfos(tenantIds.map((t) => ({ tenantId: t, ownerId: (team.get(t)!.find((u) => u.role === 'owner') ?? team.get(t)![0]!).userId }))),
    getEntitlements(tenantIds),
    getSubscriptions(tenantIds),
    mapLimit(tenantIds, 6, countProducts),
  ]);

  const rows: CustomerRow[] = tenantIds.map((tenantId, i) => {
    const members = team.get(tenantId)!;
    const info = infos.get(tenantId);
    const owner = members.find((u) => u.userId === info?.ownerId) ?? members.find((u) => u.role === 'owner') ?? members[0]!;
    const products = counts[i]!;
    return {
      key: tenantId,
      kind: 'tenant',
      tenantId,
      sellerId: sellerIdOf(tenantId),
      businessName: info?.businessName,
      ownerUserId: owner.userId,
      ownerName: info?.ownerName,
      ownerEmail: owner.email,
      phone: info?.phone,
      signedUpAt: info?.createdAt ?? owner.createdAt,
      plan: planOf(entitlements.get(tenantId), subscriptions.get(tenantId), products, now),
      products,
      account: !owner.enabled ? 'disabled' : !info?.businessName ? 'profile_incomplete' : 'active',
      teamSize: members.length,
    };
  });

  for (const u of unfinished) {
    rows.push({
      key: `signup:${u.userId}`,
      kind: 'signup',
      ownerUserId: u.userId,
      ownerEmail: u.email,
      signedUpAt: u.createdAt,
      plan: { kind: 'not_started', label: 'Not started' },
      products: 0,
      account: u.enabled ? 'not_verified' : 'disabled',
      teamSize: 1,
    });
  }

  rows.sort((a, b) => b.signedUpAt.localeCompare(a.signedUpAt));
  return { rows, team };
}

export function countsByFilter(rows: CustomerRow[]): Record<CustomerFilter, number> {
  return Object.fromEntries(CUSTOMER_FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r, f)).length])) as Record<
    CustomerFilter,
    number
  >;
}

export interface CustomerDetail extends CustomerRow {
  team: Array<{ userId: string; email: string; role?: string | undefined; status: string; enabled: boolean; emailVerified: boolean }>;
  marketingConsent: { granted: boolean; capturedAt?: string } | null;
  entitlement?: EntitlementInfo | undefined;
  subscription?: SubscriptionInfo | undefined;
  invoices: InvoiceInfo[];
  engagement: EngagementInfo & { referredByBusiness?: string | undefined };
  state: AccountState | null;
  audit: AuditEntry[];
  /** Data retention: kept (and why), on hold, or deleted on a date if nothing changes. */
  dataRetention: {
    hold: Hold | null;
    /** When the data would be deleted if nothing changes (null: never automatically). */
    plannedOn: string | null;
    reason: RetentionReason | null;
    /** Disabled accounts and free unlimited ones are never deleted automatically. */
    note?: string | undefined;
    warnedAt?: string | undefined;
  };
}

export async function loadCustomer(tenantId: string, now: Date = new Date()): Promise<CustomerDetail | null> {
  const { rows, team } = await loadCustomers(now);
  const row = rows.find((r) => r.tenantId === tenantId);
  if (!row) return null;
  const [consent, entitlements, subscriptions, invoices, engagement, state, audit, hold, retention, activity] = await Promise.all([
    getConsent(tenantId, row.ownerUserId),
    getEntitlements([tenantId]),
    getSubscriptions([tenantId]),
    listInvoices(tenantId),
    getEngagement(tenantId),
    getState(tenantId),
    listAudit(tenantId),
    getHold(tenantId),
    getRetention(tenantId),
    batchGet(config.engagementTable, [{ PK: `TENANT#${tenantId}`, SK: 'ACTIVITY' }]),
  ]);
  const entitlement = entitlements.get(tenantId);
  const lastActiveAt = typeof activity[0]?.['lastActiveAt'] === 'string' ? (activity[0]['lastActiveAt'] as string) : undefined;
  const planned = plannedDeletion(
    {
      tenantId,
      entitlement,
      ...(state?.disabled ? { disabled: { since: state.changedAt } } : {}),
      onHold: !!hold,
      lastActiveAt,
      createdAt: row.signedUpAt,
    },
    now,
  );
  const note =
    entitlement?.status === 'exempt'
      ? 'Free unlimited accounts are never deleted.'
      : state?.disabled
        ? 'Disabled accounts are never deleted automatically. You are reminded after 12 months.'
        : hold
          ? 'On hold: kept until the hold is removed.'
          : !planned
            ? 'Paying: nothing is deleted while the plan is paid or paused.'
            : undefined;
  const referredBy = engagement.referredByTenantId ? rows.find((r) => r.tenantId === engagement.referredByTenantId) : undefined;
  return {
    ...row,
    team: (team.get(tenantId) ?? []).map((u) => ({
      userId: u.userId,
      email: u.email,
      role: u.role,
      status: u.status,
      enabled: u.enabled,
      emailVerified: u.emailVerified,
    })),
    marketingConsent: consent,
    entitlement,
    subscription: subscriptions.get(tenantId),
    invoices,
    engagement: { ...engagement, referredByBusiness: referredBy?.businessName },
    state,
    audit,
    dataRetention: {
      hold,
      plannedOn: planned?.on ?? null,
      reason: planned?.reason ?? null,
      ...(note ? { note } : {}),
      ...(retention?.warnedAt ? { warnedAt: retention.warnedAt } : {}),
    },
  };
}
