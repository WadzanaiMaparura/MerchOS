import type { EventBridgeEvent } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStore, mem, notifMem } from './fake-store';

vi.mock('../lib/store', () => fakeStore);
vi.mock('../lib/notifications', async () => (await import('./fake-store')).fakeNotifications);
vi.mock('../lib/accounts', () => ({
  getProductTitle: vi.fn(async () => 'Ceramic mug, blue'),
  ensureProfile: vi.fn(async () => null),
  countProducts: vi.fn(async () => 0),
  getPaidStatus: vi.fn(async () => null),
  getUser: vi.fn(async () => null),
}));
vi.mock('../lib/schedule', () => ({ scheduleBillingSteps: vi.fn(async () => []), scheduleStep: vi.fn(async () => undefined) }));
const mailed = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string }>);
vi.mock('../lib/mailer', () => ({
  sendEmail: vi.fn(async (e: { to: string; subject: string; html: string }) => {
    mailed.push(e);
    return 'msg';
  }),
}));

import { ensureProfile, getUser, getProductTitle } from '../lib/accounts';
import { handler } from '../handlers/on-event';

const T = '7e22ed36-cf82-4ba2-b194-8bd4cfab5166';
const R = '11111111-1111-4111-8111-111111111111';

const ev = (type: string, detail: unknown, time = '2026-11-25T10:00:00Z') =>
  ({ 'detail-type': type, source: 'test', time, detail }) as unknown as EventBridgeEvent<string, unknown>;

const titles = async (tenantId = T) =>
  (await (await import('./fake-store')).fakeNotifications.listNotifications(tenantId)).notifications.map((n) => n.title);

beforeEach(() => {
  mem.reset();
  notifMem.reset();
});

describe('seller notifications from platform events', () => {
  it('import finished and failed link to the import; a repeated delivery adds nothing', async () => {
    const done = ev('ImportJobCompleted', {
      tenantId: T,
      importJobId: 'job-1',
      supplierId: 's',
      sourceType: 'csv',
      results: { totalExtracted: 50, created: 48, updated: 3, duplicates: 0, validationFailed: 2 },
      durationMs: 1,
    });
    await handler(done);
    await handler(done);
    await handler(ev('ImportJobFailed', { tenantId: T, importJobId: 'job-2', supplierId: 's', error: { code: 'TIMEOUT', message: 'x' } }));
    const list = notifMem.of(T);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ title: 'Import finished', link: '/imports/job-1', at: '2026-11-25T10:00:00.000Z' });
    expect(list[1]).toMatchObject({ title: 'Import failed', link: '/imports/job-2' });
    expect(list[1]!.message).toContain('took too long');
  });

  it('photo not accepted / not processed names the product and opens it', async () => {
    await handler(ev('ImageModerationRejected', { tenantId: T, productId: 'p1', imageJobId: 'img-1', rejectedLabels: ['x'] }));
    await handler(ev('ImageProcessingFailed', { tenantId: T, productId: 'p1', imageJobId: 'img-2', error: { code: 'E', message: 'x' } }));
    expect(getProductTitle).toHaveBeenCalledWith(T, 'p1');
    expect(notifMem.of(T).map((n) => [n.title, n.link])).toEqual([
      ['A photo was not accepted', '/products/p1'],
      ['A photo could not be processed', '/products/p1'],
    ]);
  });

  it('trial: nothing until 3 are left, then "almost" once and "used up" once', async () => {
    for (const used of [5, 11]) await handler(ev('product.trial.usage', { tenantId: T, productsUsed: used, productLimit: 15 }));
    expect(notifMem.of(T)).toHaveLength(0);
    for (const used of [12, 13, 14, 15, 15]) await handler(ev('product.trial.usage', { tenantId: T, productsUsed: used, productLimit: 15 }));
    expect(await titles()).toEqual(['Free trial used up', 'Free trial: 12 of 15 products used']);
  });

  it('free month added (billing.subscription.extended) shows the new paid-until', async () => {
    await handler(
      ev('billing.subscription.extended', {
        tenantId: R,
        planId: 'starter',
        reason: 'referral-free-month',
        referredTenantId: T,
        periodEnd: '2027-01-25T10:00:00.000Z',
        previousPeriodEnd: '2026-12-25T10:00:00.000Z',
      }),
    );
    expect(notifMem.of(R)[0]).toMatchObject({ title: 'Free month added', link: '/referrals' });
    expect(notifMem.of(R)[0]!.message).toContain('25 January 2027');
  });

  it('data retention warning: one email per deletion date, with the right words for each case', async () => {
    mailed.length = 0;
    const profile = { tenantId: T, userId: 'owner', email: 'x', firstName: 'Thandi', businessName: 'Thandi Home Goods', createdAt: '' };
    vi.mocked(ensureProfile).mockResolvedValue(profile as never);
    mem.profiles.set(T, profile as never);
    vi.mocked(getUser).mockResolvedValue({ email: 'thandi@example.co.za', enabled: false });
    const warn = (reason: string, deleteOn = '2028-02-07T00:00:00.000Z') =>
      handler(ev('admin.retention.warning', { tenantId: T, deleteOn, reason }));
    await warn('closed');
    await warn('closed');
    expect(mailed).toHaveLength(1);
    expect(mailed[0]).toMatchObject({ to: 'thandi@example.co.za', subject: 'Your MerchOS account will be deleted on 7 February 2028' });
    expect(mailed[0]!.html).toContain('has been closed for almost a year');
    expect(mailed[0]!.html).toContain('Reactivate my account');
    expect(mailed[0]!.html).toContain('kept for 6 years');

    await warn('inactive', '2028-03-10T09:00:00.000Z');
    expect(mailed[1]!.html).toContain('You have not used your MerchOS account');
    expect(mailed[1]!.html).toContain('Sign in to keep my account');
    for (const m of mailed) expect(m.html).not.toMatch(/\u2014|\bAI\b/);
    vi.mocked(ensureProfile).mockResolvedValue(null);
  });

  it('ignores events for no tenant or with unexpected fields', async () => {
    await handler(ev('ImportJobCompleted', { importJobId: 'job-1' }));
    await handler(ev('ImageModerationRejected', { tenantId: 'not-a-uuid', productId: 'p', imageJobId: 'i' }));
    expect(notifMem.items.size).toBe(0);
  });
});
