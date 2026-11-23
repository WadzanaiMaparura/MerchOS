import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
const T1 = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';

const index = vi.hoisted(() => ({
  AUDIT: [] as Array<Record<string, unknown>>,
  'REVIEWS#APPROVED': [] as Array<Record<string, unknown>>,
  'REVIEWS#REJECTED': [] as Array<Record<string, unknown>>,
  REFERRALS: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ pk: string; from: string; to: string }>,
}));

vi.mock('../lib/data', () => ({
  db: () => ({
    send: async (cmd: { input: { ExpressionAttributeValues: Record<string, string> } }) => {
      const v = cmd.input.ExpressionAttributeValues;
      index.calls.push({ pk: v[':pk']!, from: v[':from']!, to: v[':to']! });
      const items = (index as unknown as Record<string, Array<Record<string, unknown>>>)[v[':pk']!] ?? [];
      return { Items: items.filter((i) => String(i['GSI1SK']) >= v[':from']! && String(i['GSI1SK']) <= v[':to']!) };
    },
  }),
  getTenantInfos: async (ts: Array<{ tenantId: string }>) => new Map(ts.map((t) => [t.tenantId, { tenantId: t.tenantId, businessName: 'Thandi Home Goods' }])),
}));
vi.mock('../lib/cognito', () => ({
  cognito: () => ({
    send: async (cmd: { input: { GroupName: string } }) => ({
      Users:
        cmd.input.GroupName === 'Admin'
          ? [{ Username: 'staff-admin', Attributes: [{ Name: 'email', Value: 'admin@merchos.co.za' }] }]
          : [{ Username: 'staff-support', Attributes: [{ Name: 'email', Value: 'info@merchos.co.za' }] }],
    }),
  }),
}));

import { handler, sastDayEnd, sastDayStart } from '../handlers/audit-read';

function event(group: string, query: Record<string, string> = {}) {
  return {
    routeKey: 'GET /admin/audit',
    headers: {},
    queryStringParameters: query,
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

beforeEach(() => {
  process.env['COGNITO_ISSUER'] = ISSUER;
  process.env['ADMIN_TABLE'] = 'admin';
  process.env['ENGAGEMENT_TABLE'] = 'engagement';
  process.env['USER_POOL_ID'] = 'pool';
  index.calls = [];
  index.AUDIT = [
    { PK: `TENANT#${T1}`, SK: 'AUDIT#1', GSI1SK: '2026-11-23T09:00:00.000Z', at: '2026-11-23T09:00:00.000Z', action: 'disable', by: 'staff-admin', byRole: 'Admin', tenantId: T1, reason: 'Chargeback', detail: '2 people' },
    { PK: 'USER#pending-1', SK: 'AUDIT#2', GSI1SK: '2026-11-22T09:00:00.000Z', at: '2026-11-22T09:00:00.000Z', action: 'resend-verification', by: 'staff-support', byRole: 'Support', userId: 'pending-1' },
  ];
  index['REVIEWS#APPROVED'] = [
    { reviewId: 'r1', tenantId: T1, rating: 5, displayName: 'Thandi K.', decidedBy: 'staff-support', decidedAt: '2026-11-21T09:00:00.000Z', GSI1SK: '2026-11-21T09:00:00.000Z' },
  ];
  index.REFERRALS = [
    { referrerTenantId: T1, referredTenantId: 'x', code: 'THANDI7K', GSI1SK: '2026-10-01T00:00:00.000Z', rewardAppliedAt: '2026-11-20T09:00:00.000Z', rewardAppliedBy: 'staff-admin' },
    { referrerTenantId: T1, referredTenantId: 'y', code: 'THANDI7K', GSI1SK: '2026-10-02T00:00:00.000Z' },
  ];
});

describe('audit log', () => {
  it('Admin only', async () => {
    expect((await call(event('Support'))).status).toBe(403);
    expect((await call(event('Admin'))).status).toBe(200);
  });

  it('merges customer actions, review decisions and free months, newest first, in plain words', async () => {
    const r = await call(event('Admin'));
    const events = r.body['events'] as Array<Record<string, unknown>>;
    expect(events.map((e) => e['label'])).toEqual([
      'Disabled account',
      'Resent verification email',
      'Approved review for the website',
      'Marked referral free month applied',
    ]);
    expect(events[0]).toMatchObject({ byEmail: 'admin@merchos.co.za', byRole: 'Admin', subject: 'Thandi Home Goods', reason: 'Chargeback', detail: '2 people' });
    expect(events[1]).toMatchObject({ byEmail: 'info@merchos.co.za', subject: 'Unfinished sign-up' });
    expect(events[2]).toMatchObject({ detail: '5 stars, shown as "Thandi K."' });
    expect(r.body['total']).toBe(4);
    expect((r.body['staff'] as unknown[]).length).toBe(2);
  });

  it('filters by action, staff member, search and South African dates', async () => {
    expect((await call(event('Admin', { action: 'disable' }))).body['total']).toBe(1);
    expect((await call(event('Admin', { staff: 'staff-support' }))).body['total']).toBe(2);
    expect((await call(event('Admin', { q: 'chargeback' }))).body['total']).toBe(1);
    const day = await call(event('Admin', { from: '2026-11-22', to: '2026-11-22' }));
    expect((day.body['events'] as Array<{ label: string }>).map((e) => e.label)).toEqual(['Resent verification email']);
    expect(index.calls.find((c) => c.pk === 'AUDIT' && c.from !== '0000')).toMatchObject({ from: '2026-11-21T22:00:00.000Z', to: '2026-11-22T21:59:59.999Z' });
    expect((await call(event('Admin', { from: '22-11-2026' }))).status).toBe(400);
    expect((await call(event('Admin', { action: 'LOGIN' }))).status).toBe(400);
  });

  it('pages', async () => {
    const r = await call(event('Admin', { page: '2', pageSize: '3' }));
    expect((r.body['events'] as unknown[]).length).toBe(1);
  });

  it('SAST day boundaries', () => {
    expect(sastDayStart('2026-11-23')).toBe('2026-11-22T22:00:00.000Z');
    expect(sastDayEnd('2026-11-23')).toBe('2026-11-23T21:59:59.999Z');
  });
});
