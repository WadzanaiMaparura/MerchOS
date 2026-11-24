import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isProblem, matchesBillingFilter, sastMonth, summarise, toRow, type BillingRow } from '../lib/billing';

const NOW = new Date('2026-11-23T10:00:00Z');
const T1 = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const T2 = '11111111-2222-4333-8444-555555555555';
const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';

const sub = (over: Record<string, unknown> = {}) => ({
  PK: `TENANT#${T1}`,
  SK: 'SUBSCRIPTION#current',
  planId: 'growth',
  status: 'active',
  priceZARCents: 89900,
  currentPeriodEnd: '2026-12-22T10:00:00Z',
  createdAt: '2026-10-22T10:00:00Z',
  ...over,
});
const invoice = (amountCents: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
  invoiceId: `inv-${createdAt}`,
  amountCents,
  createdAt,
  hasPdf: true,
  ...extra,
});

describe('billing rules', () => {
  it('paid, lapsed and payment problems', () => {
    expect(toRow(T1, { subscription: sub(), invoices: [], payments: [] }, 'Thandi', NOW)?.status).toBe('paid');
    expect(toRow(T1, { subscription: sub({ currentPeriodEnd: '2026-11-18T00:00:00Z' }), invoices: [], payments: [] }, 'x', NOW)?.status).toBe('lapsed');
    const stuck = { mPaymentId: 'p1', applied: false, createdAt: '2026-11-23T09:00:00Z' };
    expect(toRow(T1, { subscription: sub(), invoices: [], payments: [stuck] }, 'x', NOW)).toMatchObject({ status: 'problem', problems: 1 });
  });

  it('a payment still being applied is not a problem yet', () => {
    expect(isProblem({ mPaymentId: 'p', applied: false, createdAt: '2026-11-23T09:50:00Z' }, NOW)).toBe(false);
    expect(isProblem({ mPaymentId: 'p', applied: true, createdAt: '2026-11-01T00:00:00Z' }, NOW)).toBe(false);
  });

  it('lapsed customers show where they are in the payment cycle', () => {
    const at = (end: string) =>
      toRow(T1, { subscription: sub({ currentPeriodEnd: end }), invoices: [], payments: [] }, 'x', NOW)!.stage;
    expect(at('2026-11-22T00:00:00Z')).toBe('grace'); // 1 day late
    expect(at('2026-11-10T00:00:00Z')).toBe('paused');
    expect(at('2026-10-01T00:00:00Z')).toBe('closed');
    expect(at('2026-11-28T00:00:00Z')).toBe('due_soon');
  });

  it('renewing within 7 days', () => {
    const soon = toRow(T1, { subscription: sub({ currentPeriodEnd: '2026-11-28T00:00:00Z' }), invoices: [], payments: [] }, 'x', NOW)!;
    const later = toRow(T1, { subscription: sub(), invoices: [], payments: [] }, 'x', NOW)!;
    expect(matchesBillingFilter(soon, 'renewing', NOW)).toBe(true);
    expect(matchesBillingFilter(later, 'renewing', NOW)).toBe(false);
  });

  it('totals: list price, after vouchers, and this month in South African time', () => {
    const a = toRow(T1, { subscription: sub(), invoices: [invoice(80910, '2026-11-22T10:00:00Z', { voucherCode: 'LAUNCH10' })], payments: [] }, 'A', NOW)!;
    const b = toRow(T2, { subscription: sub({ PK: `TENANT#${T2}`, planId: 'starter', priceZARCents: 49900 }), invoices: [], payments: [] }, 'B', NOW)!;
    const lapsed = { ...b, tenantId: 'x', status: 'lapsed' } as BillingRow;
    const all = new Map([
      [T1, { invoices: [invoice(80910, '2026-11-22T10:00:00Z'), invoice(89900, '2026-10-22T10:00:00Z')], payments: [] }],
      // 31 Oct 23:30 UTC is 1 Nov in South Africa.
      [T2, { invoices: [invoice(49900, '2026-10-31T23:30:00Z')], payments: [] }],
    ]);
    expect(summarise([a, b, lapsed], all, NOW)).toEqual({
      paying: 2,
      byPlan: { Growth: 1, Starter: 1 },
      monthlyListCents: 89900 + 49900,
      monthlyAfterVouchersCents: 80910 + 49900,
      paidThisMonthCents: 80910 + 49900,
      paymentsThisMonth: 2,
      attention: { problems: 0, lapsed: 1 },
    });
    expect(sastMonth(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
  });
});

// ─── Handler ────────────────────────────────────────────────────────────────

const scanItems = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));
const getItem = vi.hoisted(() => ({ item: undefined as Record<string, unknown> | undefined }));
vi.mock('../lib/data', async () => {
  const actual = await vi.importActual<typeof import('../lib/data')>('../lib/data');
  return {
    ...actual,
    db: () => ({
      send: async (cmd: { constructor: { name: string } }) =>
        cmd.constructor.name === 'ScanCommand' ? { Items: scanItems.items } : { Item: getItem.item },
    }),
    getTenantInfos: async (ts: Array<{ tenantId: string }>) => new Map(ts.map((t) => [t.tenantId, { tenantId: t.tenantId, businessName: 'Thandi Home Goods' }])),
    getMonthUsage: async () => 312,
    getEngagement: async () => ({ emailsSent: [], marketingOptOut: false, referralsMade: 1, freeMonthsEarned: 1, freeMonthsOwed: 1 }),
  };
});
vi.mock('../../billing/invoices/invoice-storage', () => ({
  presignInvoiceDownload: async (key: string, number: string) => `https://s3.example/${key}?n=${number}`,
}));

import { handler } from '../handlers/billing-read';

function event(routeKey: string, group: string, path?: Record<string, string>) {
  return {
    routeKey,
    headers: {},
    pathParameters: path,
    requestContext: {
      http: { method: 'GET' },
      authorizer: { jwt: { claims: { sub: 's', iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, 'cognito:groups': `[${group}]` } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}
const call = async (e: APIGatewayProxyEventV2) => {
  const r = (await handler(e, {} as never)) as { statusCode: number; body: string };
  return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
};

describe('billing API', () => {
  beforeEach(() => {
    process.env['COGNITO_ISSUER'] = ISSUER;
    process.env['BILLING_TABLE'] = 'merch-os-billing-test';
    scanItems.items = [
      sub({ currentPeriodEnd: '2099-01-01T00:00:00Z' }),
      { PK: `TENANT#${T1}`, SK: 'INVOICE#pay-1', invoiceId: 'pay-1', invoiceNumber: 'INV-16750', amountPaid: 89900, createdAt: '2026-11-22T10:00:00Z', pdfKey: `invoices/${T1}/INV-16750.pdf` },
      { PK: `TENANT#${T1}`, SK: 'PAYMENT#pay-1', mPaymentId: 'pay-1', applied: true, amountGrossCents: 89900, createdAt: '2026-11-22T10:00:00Z' },
    ];
    getItem.item = undefined;
  });

  it('Admin only: Support cannot see billing', async () => {
    expect((await call(event('GET /admin/billing', 'Support'))).status).toBe(403);
    expect((await call(event('GET /admin/billing', 'Admin'))).status).toBe(200);
  });

  it('list with totals, then detail with invoices, payments and usage', async () => {
    const list = await call(event('GET /admin/billing', 'Admin'));
    expect(list.body['customers']).toEqual([expect.objectContaining({ businessName: 'Thandi Home Goods', planName: 'Growth', status: 'paid' })]);
    expect(list.body['summary']).toMatchObject({ paying: 1, monthlyListCents: 89900 });
    const d = await call(event('GET /admin/billing/{tenantId}', 'Admin', { tenantId: T1 }));
    expect(d.body['customer']).toMatchObject({ monthUsage: 312, freeMonthsOwed: 1, invoices: [{ invoiceNumber: 'INV-16750', hasPdf: true }], payments: [{ applied: true }] });
    expect(JSON.stringify(d.body)).not.toContain('pdfKey');
  });

  it('PDF links only for invoices already issued', async () => {
    const route = 'GET /admin/billing/{tenantId}/invoices/{invoiceId}/pdf';
    getItem.item = { invoiceId: 'pay-2', amountPaid: 100 };
    expect((await call(event(route, 'Admin', { tenantId: T1, invoiceId: 'pay-2' }))).status).toBe(409);
    getItem.item = { invoiceId: 'pay-1', invoiceNumber: 'INV-16750', pdfKey: `invoices/${T1}/INV-16750.pdf` };
    const ok = await call(event(route, 'Admin', { tenantId: T1, invoiceId: 'pay-1' }));
    expect(ok.body['url']).toContain('INV-16750');
    expect((await call(event(route, 'Admin', { tenantId: T1, invoiceId: '../x' }))).status).toBe(400);
  });
});
