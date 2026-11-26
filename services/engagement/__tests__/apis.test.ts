import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStore, mem } from './fake-store';

vi.mock('../lib/store', () => fakeStore);
vi.mock('../lib/notifications', async () => (await import('./fake-store')).fakeNotifications);
vi.mock('../lib/accounts', async () => {
  const actual = await vi.importActual<typeof import('../lib/accounts')>('../lib/accounts');
  const store = await import('./fake-store');
  return {
    firstNameOf: actual.firstNameOf,
    shortName: actual.shortName,
    getOwnerDetails: async () => ({ fullName: 'Thandi Khumalo', businessName: 'Thandi Home Goods' }),
    ensureProfile: async (tenantId: string) => store.mem.profiles.get(tenantId) ?? null,
  };
});
const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);
vi.mock('../lib/mailer', () => ({
  sendEmail: vi.fn(async (e: { to: string; subject: string }) => {
    sent.push(e);
    return 'msg';
  }),
}));
// RBAC/tenant middleware are covered by their own tests; here they pass through.
vi.mock('../../shared/middleware/rbac', () => ({ rbacMiddleware: () => ({ before: async () => undefined }) }));
vi.mock('../../shared/middleware/tenant-context', () => ({
  tenantContextMiddleware: () => ({ before: async () => undefined }),
  extractTenantContext: (e: { requestContext: { authorizer?: { tenantContext?: { tenantId: string } } } }) =>
    e.requestContext.authorizer?.tenantContext ?? null,
}));

import { _setTokenSecret } from '../lib/config';
import { issueToken } from '../lib/tokens';
import { handler as publicApi } from '../handlers/public-api';
import { handler as sellerApi, notificationsHandler } from '../handlers/seller-api';
import { reviewsHandler, referralsHandler } from '../handlers/admin-api';

const SECRET = 'test-secret';
const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const OTHER = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://merchos.co.za';

type Result = { statusCode: number; body: string; headers?: Record<string, string> };

function http(
  routeKey: string,
  opts: { body?: unknown; query?: Record<string, string>; origin?: string; path?: Record<string, string>; tenantId?: string } = {},
): APIGatewayProxyEventV2 {
  return {
    routeKey,
    headers: opts.origin ? { origin: opts.origin } : {},
    queryStringParameters: opts.query,
    pathParameters: opts.path,
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    isBase64Encoded: false,
    requestContext: {
      http: { sourceIp: '1.2.3.4' },
      authorizer: { rbac: { userId: 'staff-1' }, ...(opts.tenantId ? { tenantContext: { tenantId: opts.tenantId } } : {}) },
    },
  } as unknown as APIGatewayProxyEventV2;
}

const call = async (fn: (e: APIGatewayProxyEventV2, ctx?: unknown) => unknown, e: APIGatewayProxyEventV2) => {
  const r = (await fn(e, {})) as Result;
  return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown>, headers: r.headers ?? {} };
};

const profile = (tenantId: string, extra = {}) =>
  mem.profiles.set(tenantId, {
    tenantId,
    userId: 'owner',
    email: 'thandi@example.co.za',
    firstName: 'Thandi',
    businessName: 'Thandi Home Goods',
    createdAt: '2026-11-01T00:00:00.000Z',
    ...extra,
  });

const goodReview = () => ({
  token: issueToken('review', TENANT, SECRET),
  rating: 5,
  text: 'Saves me hours every week.',
  displayName: 'Thandi K.',
  businessLabel: 'Home & Kitchen',
  consentToPublish: true,
});

beforeEach(() => {
  mem.reset();
  sent.length = 0;
  process.env['SELLER_ORIGINS'] = `${ORIGIN},http://localhost:3000`;
  process.env['SUPPORT_EMAIL'] = 'info@merchos.co.za';
  _setTokenSecret(SECRET);
  profile(TENANT);
});

describe('reviews (public)', () => {
  it('a review link prefills the form', async () => {
    const r = await call(publicApi, http('GET /reviews/invite', { query: { t: issueToken('review', TENANT, SECRET) } }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ firstName: 'Thandi', suggestedName: 'Thandi K.', alreadyReviewed: false });
  });

  it('rejects bad links and other origins', async () => {
    expect((await call(publicApi, http('GET /reviews/invite', { query: { t: 'nope' } }))).status).toBe(400);
    const unsubToken = issueToken('unsubscribe', TENANT, SECRET);
    expect((await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: { ...goodReview(), token: unsubToken } }))).status).toBe(400);
    expect((await call(publicApi, http('POST /reviews', { origin: 'https://evil.example', body: goodReview() }))).status).toBe(403);
    expect((await call(publicApi, http('POST /reviews', { body: goodReview() }))).status).toBe(403);
  });

  it('one review per seller, pending until approved, support is told', async () => {
    const first = await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: goodReview() }));
    expect(first.status).toBe(201);
    expect(first.body['status']).toBe('PENDING');
    expect(sent).toEqual([expect.objectContaining({ to: 'info@merchos.co.za', subject: expect.stringMatching(/^New review: 5 stars/) })]);
    expect((await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: goodReview() }))).status).toBe(409);

    // Not on the website until approved.
    let site = await call(publicApi, http('GET /reviews'));
    expect(site.body['reviews']).toEqual([]);
    expect(site.headers['Cache-Control']).toBe('public, max-age=300');

    const reviewId = first.body['reviewId'] as string;
    expect((await call(reviewsHandler, http('POST /admin/reviews/{reviewId}/approve', { path: { reviewId } }))).status).toBe(200);
    site = await call(publicApi, http('GET /reviews'));
    expect(site.body['reviews']).toEqual([
      { reviewId, name: 'Thandi K.', label: 'Home & Kitchen', quote: 'Saves me hours every week.', rating: 5 },
    ]);
  });

  it('cannot approve a review without consent to publish', async () => {
    const r = await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: { ...goodReview(), rating: 2, consentToPublish: false } }));
    expect(sent[0]!.subject).toMatch(/^Low rating: 2 stars/);
    const approve = await call(reviewsHandler, http('POST /admin/reviews/{reviewId}/approve', { path: { reviewId: r.body['reviewId'] as string } }));
    expect(approve.status).toBe(409);
  });

  it('validates the form', async () => {
    const bad = await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: { ...goodReview(), rating: 9 } }));
    expect(bad.status).toBe(400);
    const noName = await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: { ...goodReview(), displayName: '' } }));
    expect(noName.body).toMatchObject({ error: { message: 'Please add the name to show with your review' } });
  });

  it('admin can delete a review (POPIA); the seller may then review again', async () => {
    const r = await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: goodReview() }));
    const reviewId = r.body['reviewId'] as string;
    expect((await call(reviewsHandler, http('DELETE /admin/reviews/{reviewId}', { path: { reviewId } }))).status).toBe(200);
    expect((await call(publicApi, http('POST /reviews', { origin: ORIGIN, body: goodReview() }))).status).toBe(201);
  });
});

describe('unsubscribe', () => {
  it('page button (JSON) and one-click (token in URL, form body)', async () => {
    const t = issueToken('unsubscribe', TENANT, SECRET);
    expect((await call(publicApi, http('POST /unsubscribe', { body: { token: t } }))).status).toBe(200);
    expect(mem.profiles.get(TENANT)?.marketingOptOut).toBe(true);
    mem.profiles.get(TENANT)!.marketingOptOut = false;
    expect((await call(publicApi, http('POST /unsubscribe', { query: { t }, body: 'List-Unsubscribe=One-Click' }))).status).toBe(200);
    expect(mem.profiles.get(TENANT)?.marketingOptOut).toBe(true);
  });

  it('a review link cannot unsubscribe', async () => {
    const r = await call(publicApi, http('POST /unsubscribe', { query: { t: issueToken('review', TENANT, SECRET) } }));
    expect(r.status).toBe(400);
  });
});

describe('referrals (seller)', () => {
  beforeEach(() => {
    profile(OTHER, { referralCode: 'SIPHO7K' });
    mem.codes.set('SIPHO7K', OTHER);
  });

  it('my link, then a new seller claims it; no details of who was referred', async () => {
    const mine = await call(sellerApi, http('GET /referrals/me', { tenantId: OTHER }));
    expect(mine.body).toMatchObject({ code: 'SIPHO7K', link: 'https://merchos.co.za/r/SIPHO7K', linkLabel: 'merchos.co.za/r/SIPHO7K', freeMonthsEarned: 0 });

    const claim = await call(sellerApi, http('POST /referrals/claim', { tenantId: TENANT, body: { code: 'sipho7k' } }));
    expect(claim.status).toBe(201);
    const after = await call(sellerApi, http('GET /referrals/me', { tenantId: OTHER }));
    expect(after.body['referrals']).toEqual([{ status: 'PENDING', claimedAt: expect.any(String), reward: null }]);
    expect(JSON.stringify(after.body)).not.toContain('Thandi');

    // Claiming again is harmless.
    const again = await call(sellerApi, http('POST /referrals/claim', { tenantId: TENANT, body: { code: 'SIPHO7K' } }));
    expect(again.body).toMatchObject({ alreadyReferred: true, claimed: true });
  });

  it('refuses own link, unknown codes and sellers who already subscribed', async () => {
    expect((await call(sellerApi, http('POST /referrals/claim', { tenantId: OTHER, body: { code: 'SIPHO7K' } }))).status).toBe(400);
    expect((await call(sellerApi, http('POST /referrals/claim', { tenantId: TENANT, body: { code: 'NOPE99' } }))).status).toBe(404);
    mem.profiles.get(TENANT)!.subscribedAt = '2026-11-10T00:00:00.000Z';
    expect((await call(sellerApi, http('POST /referrals/claim', { tenantId: TENANT, body: { code: 'SIPHO7K' } }))).status).toBe(409);
  });

  it('admin marks an earned free month as applied, once', async () => {
    await call(sellerApi, http('POST /referrals/claim', { tenantId: TENANT, body: { code: 'SIPHO7K' } }));
    const path = { referrerTenantId: OTHER, referredTenantId: TENANT };
    const route = 'POST /admin/referrals/{referrerTenantId}/{referredTenantId}/applied';
    expect((await call(referralsHandler, http(route, { path }))).status).toBe(409);
    await fakeStore.transitionReferral(OTHER, TENANT, ['PENDING'], 'QUALIFIED', { reward: 'EARNED' });
    expect((await call(referralsHandler, http(route, { path }))).status).toBe(200);
    expect((await call(referralsHandler, http(route, { path }))).status).toBe(409);
    const list = await call(referralsHandler, http('GET /admin/referrals'));
    expect(list.body['referrals']).toEqual([
      expect.objectContaining({ referrerBusiness: 'Thandi Home Goods', reward: 'APPLIED', status: 'QUALIFIED' }),
    ]);
  });
});

describe('seller notifications API (the bell)', () => {
  beforeEach(async () => {
    const { notifMem, fakeNotifications } = await import('./fake-store');
    notifMem.reset();
    await fakeNotifications.addNotification(TENANT, {
      key: 'import-failed:j1', kind: 'import.failed', title: 'Import failed', message: 'm', link: '/imports/j1', at: '2026-11-25T08:00:00.000Z',
    });
    await fakeNotifications.addNotification(TENANT, {
      key: 'payment:p1', kind: 'payment.received', title: 'Payment received', message: 'm', link: '/billing', at: '2026-11-25T09:00:00.000Z',
    });
    await fakeNotifications.addNotification(OTHER, {
      key: 'payment:p2', kind: 'payment.received', title: 'Someone else', message: 'm', link: '/billing', at: '2026-11-25T09:00:00.000Z',
    });
  });

  it('lists my notifications only, newest first, with the unread count; records that the account is in use', async () => {
    const { activityMem } = await import('./fake-store');
    activityMem.clear();
    const r = await call(notificationsHandler, http('GET /notifications', { tenantId: TENANT }));
    expect(activityMem.has(TENANT)).toBe(true);
    expect(r.status).toBe(200);
    expect((r.body['notifications'] as Array<{ title: string }>).map((n) => n.title)).toEqual(['Payment received', 'Import failed']);
    expect(r.body['unreadCount']).toBe(2);
  });

  it('marks one, then all, as read and returns the updated list', async () => {
    const list = (await call(notificationsHandler, http('GET /notifications', { tenantId: TENANT }))).body['notifications'] as Array<{ id: string }>;
    const one = await call(notificationsHandler, http('POST /notifications/read', { tenantId: TENANT, body: { ids: [list[1]!.id] } }));
    expect(one.body['unreadCount']).toBe(1);
    const all = await call(notificationsHandler, http('POST /notifications/read', { tenantId: TENANT, body: { all: true } }));
    expect(all.body['unreadCount']).toBe(0);
  });

  it('refuses an empty or malformed request, and needs a signed-in seller', async () => {
    expect((await call(notificationsHandler, http('POST /notifications/read', { tenantId: TENANT, body: { ids: [] } }))).status).toBe(400);
    expect((await call(notificationsHandler, http('POST /notifications/read', { tenantId: TENANT, body: { all: 'yes' } }))).status).toBe(400);
    expect((await call(notificationsHandler, http('GET /notifications'))).status).toBe(401);
  });
});
