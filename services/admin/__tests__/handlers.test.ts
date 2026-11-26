import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const OTHER = '11111111-2222-4333-8444-555555555555';
const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';

const state = vi.hoisted(() => ({
  users: [] as Array<{ userId: string; email: string; emailVerified: boolean; tenantId?: string; role?: string; status: string; enabled: boolean; createdAt: string }>,
  unfinished: [] as Array<{ userId: string; email: string; emailVerified: boolean; status: string; enabled: boolean; createdAt: string }>,
  entitlement: new Map<string, { status: 'active' | 'subscribed' | 'exempt' }>(),
  audit: [] as Array<Record<string, unknown>>,
  calls: [] as string[],
}));

vi.mock('../lib/cognito', () => ({
  listSellerUsers: async () => state.users,
  listUnfinishedSignUps: async () => state.unfinished,
  getUser: async (id: string) => [...state.users, ...state.unfinished].find((u) => u.userId === id) ?? null,
  disableUser: async (id: string) => void state.calls.push(`disable:${id}`),
  enableUser: async (id: string) => void state.calls.push(`enable:${id}`),
  resendSignUpCode: async (id: string) => void state.calls.push(`resend:${id}`),
}));
vi.mock('../lib/data', () => ({
  mapLimit: async <T, R>(items: T[], _n: number, fn: (t: T) => Promise<R>) => Promise.all(items.map(fn)),
  getTenantInfos: async (ts: Array<{ tenantId: string; ownerId?: string }>) =>
    new Map(ts.map((t) => [t.tenantId, { tenantId: t.tenantId, ownerId: t.ownerId, businessName: t.tenantId === TENANT ? 'Thandi Home Goods' : 'Sipho Sports', ownerName: 'Owner', phone: '+27820001234', createdAt: '2026-11-21T10:00:00Z' }])),
  getEntitlements: async (ids: string[]) => new Map(ids.filter((i) => state.entitlement.has(i)).map((i) => [i, state.entitlement.get(i)!])),
  getSubscriptions: async () => new Map(),
  countProducts: async (t: string) => (t === TENANT ? 6 : 0),
  getConsent: async () => ({ granted: true }),
  batchGet: async () => [],
  listInvoices: async () => [],
  getEngagement: async () => ({ emailsSent: [{ email: 'trial-welcome', sentAt: '2026-11-21T10:01:00Z' }], marketingOptOut: false, referralsMade: 0, freeMonthsEarned: 0 }),
}));
vi.mock('../lib/audit', () => ({
  recordAudit: async (subject: Record<string, unknown>, entry: Record<string, unknown>) => void state.audit.push({ ...subject, ...entry }),
  listAudit: async () => state.audit,
  getState: async () => null,
  putState: async () => undefined,
}));
const holds = vi.hoisted(() => new Map<string, { by: string; reason: string; at: string }>());
vi.mock('../lib/retention-store', () => ({
  getHold: async (t: string) => holds.get(t) ?? null,
  setHold: async (t: string, h: { by: string; reason: string; at: string } | null) => void (h ? holds.set(t, h) : holds.delete(t)),
  getRetention: async () => null,
}));
vi.mock('../lib/exempt', async () => {
  const actual = await vi.importActual<typeof import('../lib/exempt')>('../lib/exempt');
  return {
    statusAfterExempt: actual.statusAfterExempt,
    grantExempt: async (t: string) => void state.entitlement.set(t, { status: 'exempt' }),
    removeExempt: async (t: string, next: { status: 'active' | 'subscribed' }) => {
      if (state.entitlement.get(t)?.status !== 'exempt') return false;
      state.entitlement.set(t, { status: next.status });
      return true;
    },
  };
});

import { handler as readApi } from '../handlers/customers-read';
import { handler as verifyApi } from '../handlers/customers-verify';
import { handler as manageApi } from '../handlers/customers-manage';

type Res = { statusCode: number; body: string };

function event(routeKey: string, group: 'Admin' | 'Support' | 'Seller', opts: { body?: unknown; path?: Record<string, string>; query?: Record<string, string> } = {}) {
  return {
    routeKey,
    headers: {},
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { method: routeKey.split(' ')[0] },
      authorizer: { jwt: { claims: { sub: `staff-${group}`, iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, 'cognito:groups': `[${group}]` } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

const call = async (fn: (e: APIGatewayProxyEventV2, c: unknown) => unknown, e: APIGatewayProxyEventV2) => {
  const r = (await fn(e, {})) as Res;
  return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
};

beforeEach(() => {
  process.env['COGNITO_ISSUER'] = ISSUER;
  process.env['ENGAGEMENT_TABLE'] = 'engagement-test';
  state.users = [
    { userId: 'owner-1', email: 'thandi@example.co.za', emailVerified: true, tenantId: TENANT, role: 'owner', status: 'CONFIRMED', enabled: true, createdAt: '2026-11-21T10:00:00Z' },
    { userId: 'editor-1', email: 'team@example.co.za', emailVerified: true, tenantId: TENANT, role: 'editor', status: 'CONFIRMED', enabled: true, createdAt: '2026-11-22T10:00:00Z' },
    { userId: 'owner-2', email: 'sipho@example.co.za', emailVerified: true, tenantId: OTHER, role: 'owner', status: 'CONFIRMED', enabled: true, createdAt: '2026-11-20T10:00:00Z' },
  ];
  state.unfinished = [{ userId: 'pending-1', email: 'new@example.co.za', emailVerified: false, status: 'UNCONFIRMED', enabled: true, createdAt: '2026-11-23T08:00:00Z' }];
  state.entitlement.clear();
  state.audit = [];
  state.calls = [];
});

describe('who can do what', () => {
  it('Support and Admin can see customers; sellers cannot', async () => {
    expect((await call(readApi, event('GET /admin/customers', 'Support'))).status).toBe(200);
    expect((await call(readApi, event('GET /admin/customers', 'Admin'))).status).toBe(200);
    expect((await call(readApi, event('GET /admin/customers', 'Seller'))).status).toBe(403);
  });
  it('Support can resend verification but cannot disable or grant free unlimited', async () => {
    expect((await call(verifyApi, event('POST /admin/customers/resend-verification', 'Support', { body: { userId: 'pending-1' } }))).status).toBe(200);
    const path = { tenantId: TENANT };
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/disable', 'Support', { path, body: { reason: 'fraud check' } }))).status).toBe(403);
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/exempt', 'Support', { path, body: { exempt: true, reason: 'demo' } }))).status).toBe(403);
    expect(state.calls).toEqual(['resend:pending-1']);
  });
});

describe('customer list', () => {
  it('lists businesses and unfinished sign-ups, newest first, with chip counts', async () => {
    const r = await call(readApi, event('GET /admin/customers', 'Support'));
    const customers = r.body['customers'] as Array<Record<string, unknown>>;
    expect(customers.map((c) => c['key'])).toEqual(['signup:pending-1', TENANT, OTHER]);
    expect(customers[1]).toMatchObject({ businessName: 'Thandi Home Goods', ownerEmail: 'thandi@example.co.za', teamSize: 2, products: 6, plan: { label: 'Trial 6/15' }, account: 'active', sellerId: 'MOS-7E22ED' });
    expect(customers[0]).toMatchObject({ kind: 'signup', account: 'not_verified', ownerEmail: 'new@example.co.za' });
    expect(r.body['counts']).toMatchObject({ all: 3, trial: 3, not_verified: 1, disabled: 0 });
  });
  it('search and filter', async () => {
    const r = await call(readApi, event('GET /admin/customers', 'Support', { query: { q: 'sipho' } }));
    expect((r.body['customers'] as unknown[]).length).toBe(1);
    const nv = await call(readApi, event('GET /admin/customers', 'Support', { query: { filter: 'not_verified' } }));
    expect((nv.body['customers'] as Array<{ key: string }>).map((c) => c.key)).toEqual(['signup:pending-1']);
    expect((await call(readApi, event('GET /admin/customers', 'Support', { query: { filter: 'nope' } }))).status).toBe(400);
  });
  it('detail shows the team, emails sent and history', async () => {
    const r = await call(readApi, event('GET /admin/customers/{tenantId}', 'Support', { path: { tenantId: TENANT } }));
    const c = r.body['customer'] as Record<string, unknown>;
    expect((c['team'] as unknown[]).length).toBe(2);
    expect(c['engagement']).toMatchObject({ emailsSent: [{ email: 'trial-welcome' }] });
    expect((await call(readApi, event('GET /admin/customers/{tenantId}', 'Support', { path: { tenantId: '99999999-0000-4000-8000-000000000000' } }))).status).toBe(404);
  });
});

describe('actions', () => {
  it('resend only for people who have not verified', async () => {
    expect((await call(verifyApi, event('POST /admin/customers/resend-verification', 'Admin', { body: { userId: 'owner-1' } }))).status).toBe(409);
    expect((await call(verifyApi, event('POST /admin/customers/resend-verification', 'Admin', { body: {} }))).status).toBe(400);
    expect((await call(verifyApi, event('POST /admin/customers/resend-verification', 'Admin', { body: { userId: 'pending-1' } }))).status).toBe(200);
    expect(state.audit).toEqual([expect.objectContaining({ userId: 'pending-1', action: 'resend-verification', by: 'staff-Admin' })]);
  });

  it('disable and enable everyone in the business, with a reason in the audit log', async () => {
    const path = { tenantId: TENANT };
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/disable', 'Admin', { path, body: {} }))).status).toBe(400);
    const d = await call(manageApi, event('POST /admin/customers/{tenantId}/disable', 'Admin', { path, body: { reason: 'Chargeback, checking with the bank' } }));
    expect(d).toMatchObject({ status: 200, body: { disabled: true, people: 2 } });
    expect(state.calls).toEqual(['disable:owner-1', 'disable:editor-1']); // never the other business
    await call(manageApi, event('POST /admin/customers/{tenantId}/enable', 'Admin', { path, body: { reason: 'Bank confirmed' } }));
    expect(state.calls.slice(2)).toEqual(['enable:owner-1', 'enable:editor-1']);
    expect(state.audit.map((a) => [a['action'], a['reason']])).toEqual([
      ['disable', 'Chargeback, checking with the bank'],
      ['enable', 'Bank confirmed'],
    ]);
  });

  it('free unlimited on and off', async () => {
    const path = { tenantId: TENANT };
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/exempt', 'Admin', { path, body: { exempt: false, reason: 'test' } }))).status).toBe(409);
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/exempt', 'Admin', { path, body: { exempt: true, reason: 'Demo account' } }))).status).toBe(200);
    expect(state.entitlement.get(TENANT)).toEqual({ status: 'exempt' });
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/exempt', 'Admin', { path, body: { exempt: false, reason: 'Demo over' } }))).status).toBe(200);
    expect(state.entitlement.get(TENANT)).toEqual({ status: 'active' });
    expect((await call(manageApi, event('POST /admin/customers/{tenantId}/disable', 'Admin', { path: { tenantId: 'bad' }, body: { reason: 'x x x' } }))).status).toBe(400);
  });

  it('data hold on and off (Admin only, audited), shown on the detail', async () => {
    const path = { tenantId: TENANT };
    const hold = (on: boolean, group: 'Admin' | 'Support' = 'Admin') =>
      call(manageApi, event('POST /admin/customers/{tenantId}/hold', group, { path, body: { hold: on, reason: 'Chargeback dispute' } }));
    expect((await hold(true, 'Support')).status).toBe(403);
    expect((await hold(true)).status).toBe(200);
    expect(holds.get(TENANT)).toMatchObject({ by: 'staff-Admin', reason: 'Chargeback dispute' });
    const detail = await call(readApi, event('GET /admin/customers/{tenantId}', 'Support', { path }));
    expect((detail.body['customer'] as { dataRetention: { hold: unknown; plannedOn: unknown } }).dataRetention).toMatchObject({
      hold: { by: 'staff-Admin' },
      plannedOn: null,
    });
    expect((await hold(false)).status).toBe(200);
    expect(holds.has(TENANT)).toBe(false);
    expect(state.audit.map((a) => a['action'])).toEqual(expect.arrayContaining(['data-hold', 'data-hold-removed']));
  });
});
