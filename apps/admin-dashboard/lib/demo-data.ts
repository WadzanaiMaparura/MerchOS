/**
 * Admin dashboard SAMPLE DATA (demo mode).
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  HOW TO WIPE THIS CLEAN WHEN THE BACKEND IS CONNECTED
 * ──────────────────────────────────────────────────────────────────────────
 *  1. Set NEXT_PUBLIC_ADMIN_DEMO_MODE to "false" (or remove it). That alone
 *     disables every sample dataset below — pages revert to live API data and
 *     their real loading / error / empty states.
 *  2. For a full removal: delete this file and the three call sites that import
 *     `isDemoMode` / the DEMO_* constants (health, tenants, billing, users,
 *     alerts, audit-log, compliance, taxonomy pages) plus the SampleDataBanner
 *     mount in AdminAppShell.
 *
 *  SAFETY: real API data ALWAYS takes precedence. Sample data is only ever used
 *  when demo mode is on AND the live query has returned nothing. While demo mode
 *  is on, a persistent "Sample data — not live" banner is shown so operators can
 *  never mistake these values for a real tenant's actual state.
 * ──────────────────────────────────────────────────────────────────────────
 */

import type {
  TenantSummary,
  HealthSummary,
  HealthMetrics,
  MetricSeries,
  AlertItem,
  AuditEvent,
  ComplianceChannelSummary,
  TaxonomyStatus,
  AdminBillingSummary,
} from '@merch-os/types';

/**
 * Demo mode flag. Defaults to ON until explicitly disabled, so the dashboard
 * looks populated for demos out of the box. Flip the env var to turn it off.
 */
export function isDemoMode(): boolean {
  // Any value other than the explicit string "false" keeps demo mode on.
  return process.env.NEXT_PUBLIC_ADMIN_DEMO_MODE !== 'false';
}

// Fixed "now" anchor so relative timestamps look sensible and stable in demos.
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

// ─── Tenants ────────────────────────────────────────────────────────────────

export const DEMO_TENANTS: TenantSummary[] = [
  { tenantId: 'demo-t-0001', name: 'SA Trampoline Store', plan: 'growth', status: 'active', userCount: 4, productCount: 182, registeredAt: iso(63 * DAY) },
  { tenantId: 'demo-t-0002', name: 'Cape Outdoor Co.', plan: 'professional', status: 'active', userCount: 11, productCount: 1340, registeredAt: iso(121 * DAY) },
  { tenantId: 'demo-t-0003', name: 'Durban Electronics', plan: 'starter', status: 'active', userCount: 2, productCount: 47, registeredAt: iso(14 * DAY) },
  { tenantId: 'demo-t-0004', name: 'Joburg Home & Living', plan: 'growth', status: 'suspended', userCount: 6, productCount: 523, registeredAt: iso(205 * DAY) },
  { tenantId: 'demo-t-0005', name: 'Karoo Craft Supplies', plan: 'starter', status: 'active', userCount: 1, productCount: 29, registeredAt: iso(5 * DAY) },
  { tenantId: 'demo-t-0006', name: 'Table Mountain Apparel', plan: 'enterprise', status: 'active', userCount: 23, productCount: 8710, registeredAt: iso(390 * DAY) },
  { tenantId: 'demo-t-0007', name: 'Garden Route Gear', plan: 'growth', status: 'active', userCount: 5, productCount: 266, registeredAt: iso(41 * DAY) },
  { tenantId: 'demo-t-0008', name: 'Highveld Pet Supplies', plan: 'professional', status: 'active', userCount: 9, productCount: 977, registeredAt: iso(88 * DAY) },
];

// ─── Health ───────────────────────────────────────────────────────────────── 

export const DEMO_HEALTH_SUMMARY: HealthSummary = {
  activeTenantCount: 7,
  productsProcessedToday: 1248,
};

/** Build a smooth-ish series of `points` datapoints spaced `stepMs` apart. */
function buildSeries(name: string, unit: string, points: number, stepMs: number, base: number, jitter: number): MetricSeries {
  const datapoints = Array.from({ length: points }, (_, i) => {
    const t = now - (points - 1 - i) * stepMs;
    const wave = Math.sin(i / 3) * jitter;
    const value = Math.max(0, Math.round((base + wave + (i % 4) * (jitter / 4)) * 100) / 100);
    return { timestamp: new Date(t).toISOString(), value };
  });
  return { name, datapoints, unit };
}

export const DEMO_HEALTH_METRICS: HealthMetrics = {
  lambdaErrorRates: [buildSeries('errors/min', 'errors/min', 24, HOUR / 4, 0.4, 0.3)],
  stepFunctionsFailures: [buildSeries('failures', 'failures', 24, HOUR / 4, 1, 1)],
  sqsQueueDepths: [buildSeries('messages', 'messages', 24, HOUR / 4, 12, 8)],
  dynamoConsumedCapacity: [buildSeries('CU', 'CU', 24, HOUR / 4, 65, 20)],
};

// ─── Alerts ───────────────────────────────────────────────────────────────── 

export const DEMO_ALERTS: AlertItem[] = [
  { alertId: 'demo-a-01', functionName: 'product-enrichment-worker', currentErrorRate: 4.2, errorCount: 37, triggeredAt: iso(2 * HOUR), resolved: false },
  { alertId: 'demo-a-02', functionName: 'image-generation-worker', currentErrorRate: 1.1, errorCount: 8, triggeredAt: iso(9 * HOUR), resolved: false },
  { alertId: 'demo-a-03', functionName: 'csv-export-builder', currentErrorRate: 0.3, errorCount: 2, triggeredAt: iso(2 * DAY), resolved: true, resolvedAt: iso(1 * DAY), resolutionNote: 'Transient S3 throttling; cleared after retry.' },
];

export const DEMO_UNRESOLVED_ALERT_COUNT = DEMO_ALERTS.filter((a) => !a.resolved).length;

// ─── Audit log ────────────────────────────────────────────────────────────── 

export const DEMO_AUDIT_EVENTS: AuditEvent[] = [
  { eventId: 'demo-e-01', timestamp: iso(1 * HOUR), actor: 'admin@merchos.co.za', actionType: 'tenant.suspend', resource: 'tenant/demo-t-0004', tenantId: 'demo-t-0004', details: { reason: 'Payment failed 3x' } },
  { eventId: 'demo-e-02', timestamp: iso(5 * HOUR), actor: 'support@merchos.co.za', actionType: 'user.invite', resource: 'user/demo-u-0012', tenantId: 'demo-t-0002', details: { email: 'buyer@capeoutdoor.co.za', role: 'editor' } },
  { eventId: 'demo-e-03', timestamp: iso(1 * DAY), actor: 'system', actionType: 'billing.plan_change', resource: 'tenant/demo-t-0006', tenantId: 'demo-t-0006', details: { from: 'professional', to: 'enterprise' } },
  { eventId: 'demo-e-04', timestamp: iso(2 * DAY), actor: 'admin@merchos.co.za', actionType: 'compliance.update', resource: 'channel/takealot-za', details: { version: '2026.11' } },
];

// ─── Compliance channels ──────────────────────────────────────────────────── 

export const DEMO_COMPLIANCE_CHANNELS: ComplianceChannelSummary[] = [
  { channelId: 'takealot-za', channelName: 'Takealot (South Africa)', version: '2026.11', updatedAt: iso(2 * DAY) },
];

// ─── Taxonomy ─────────────────────────────────────────────────────────────── 

export const DEMO_TAXONOMY_STATUS: TaxonomyStatus[] = [
  { channelId: 'takealot-za', channelName: 'Takealot (South Africa)', version: '2026.11', lastRefreshDate: iso(3 * DAY), nodeCount: 4821, status: 'CURRENT' },
];

// ─── Users (tenant-scoped) ──────────────────────────────────────────────────

/**
 * Minimal shape matching api-client's AdminUserSummary. Declared locally to
 * avoid a type import churn; fields line up with GET /auth/users.
 */
export interface DemoUser {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
  status: string;
  createdAt: string;
}

/** Sample users keyed by tenant id. Only a few tenants get users for the demo. */
export const DEMO_USERS_BY_TENANT: Record<string, DemoUser[]> = {
  'demo-t-0001': [
    { userId: 'demo-u-01', email: 'owner@satrampoline.co.za', role: 'owner', tenantId: 'demo-t-0001', status: 'CONFIRMED', createdAt: iso(63 * DAY) },
    { userId: 'demo-u-02', email: 'ops@satrampoline.co.za', role: 'editor', tenantId: 'demo-t-0001', status: 'CONFIRMED', createdAt: iso(40 * DAY) },
    { userId: 'demo-u-03', email: 'intern@satrampoline.co.za', role: 'viewer', tenantId: 'demo-t-0001', status: 'FORCE_CHANGE_PASSWORD', createdAt: iso(3 * DAY) },
  ],
  'demo-t-0002': [
    { userId: 'demo-u-04', email: 'owner@capeoutdoor.co.za', role: 'owner', tenantId: 'demo-t-0002', status: 'CONFIRMED', createdAt: iso(121 * DAY) },
    { userId: 'demo-u-05', email: 'buyer@capeoutdoor.co.za', role: 'editor', tenantId: 'demo-t-0002', status: 'CONFIRMED', createdAt: iso(60 * DAY) },
  ],
  'demo-t-0006': [
    { userId: 'demo-u-06', email: 'founder@tablemountain.co.za', role: 'owner', tenantId: 'demo-t-0006', status: 'CONFIRMED', createdAt: iso(390 * DAY) },
    { userId: 'demo-u-07', email: 'disabled@tablemountain.co.za', role: 'viewer', tenantId: 'demo-t-0006', status: 'DISABLED', createdAt: iso(200 * DAY) },
  ],
};

// ─── Billing (admin view of tenant subscriptions) ──────────────────────────── 

export const DEMO_ADMIN_BILLING: AdminBillingSummary[] = [
  { tenantId: 'demo-t-0001', tenantName: 'SA Trampoline Store', plan: 'growth', billingCycle: 'monthly', status: 'active', currentPeriodEnd: iso(-23 * DAY) },
  { tenantId: 'demo-t-0002', tenantName: 'Cape Outdoor Co.', plan: 'professional', billingCycle: 'annual', status: 'active', currentPeriodEnd: iso(-250 * DAY) },
  { tenantId: 'demo-t-0004', tenantName: 'Joburg Home & Living', plan: 'growth', billingCycle: 'monthly', status: 'past_due', currentPeriodEnd: iso(4 * DAY) },
  { tenantId: 'demo-t-0006', tenantName: 'Table Mountain Apparel', plan: 'enterprise', billingCycle: 'annual', status: 'active', currentPeriodEnd: iso(-110 * DAY) },
];
