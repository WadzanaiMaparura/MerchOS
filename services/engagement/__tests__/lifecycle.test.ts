import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeStore, mem } from './fake-store';

vi.mock('../lib/store', () => fakeStore);

const accounts = vi.hoisted(() => ({
  users: new Map<string, { email: string; enabled: boolean }>(),
  products: new Map<string, number>(),
  subscribed: new Set<string>(),
}));
vi.mock('../lib/accounts', async () => {
  const actual = await vi.importActual<typeof import('../lib/accounts')>('../lib/accounts');
  const store = await import('./fake-store');
  return {
    firstNameOf: actual.firstNameOf,
    shortName: actual.shortName,
    getUser: async (id: string) => accounts.users.get(id) ?? null,
    getOwnerDetails: async () => ({ fullName: 'Thandi Khumalo', businessName: 'Thandi Home Goods' }),
    countProducts: async (t: string) => accounts.products.get(t) ?? 0,
    isSubscribedNow: async (t: string) => accounts.subscribed.has(t),
    getPaidStatus: async () => null,
    ensureProfile: async (tenantId: string, userId?: string) => {
      const existing = store.mem.profiles.get(tenantId);
      if (existing) return existing;
      const owner = userId ?? OWNER;
      if (!accounts.users.has(owner)) return null;
      return store.fakeStore.putProfileIfAbsent({
        tenantId,
        userId: owner,
        email: accounts.users.get(owner)!.email,
        firstName: 'Thandi',
        businessName: 'Thandi Home Goods',
        createdAt: new Date().toISOString(),
      });
    },
  };
});

const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; html: string; listUnsubscribeUrl?: string }>);
vi.mock('../lib/mailer', () => ({
  sendEmail: vi.fn(async (e: { to: string; subject: string; html: string; listUnsubscribeUrl?: string }) => {
    sent.push(e);
    return `msg-${sent.length}`;
  }),
}));

const schedules = vi.hoisted(() => [] as Array<{ step: string; tenantId: string; referrerTenantId?: string; attempt?: number; at: string }>);
vi.mock('../lib/schedule', async () => {
  const actual = await vi.importActual<typeof import('../lib/schedule')>('../lib/schedule');
  return {
    ...actual,
    scheduleStep: vi.fn(async (e: { step: 'tips'; tenantId: string; referrerTenantId?: string; attempt?: number }, from: Date = new Date()) => {
      schedules.push({ ...e, at: actual.dueDate(e.step, from, e.attempt ?? 0).toISOString() });
    }),
    scheduleBillingSteps: vi.fn(async (tenantId: string, paidUntil: string, planId: string) => {
      billingBooked.push({ tenantId, paidUntil, planId });
      return [];
    }),
  };
});
const billingBooked = vi.hoisted(() => [] as Array<{ tenantId: string; paidUntil: string; planId: string }>);

import { _setTokenSecret } from '../lib/config';
import { sendEmail } from '../lib/mailer';
import { onRegistered, onSubscriptionActivated } from '../handlers/on-event';
import { runStep } from '../handlers/scheduled';

const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const REFERRER = '11111111-2222-4333-8444-555555555555';
const OWNER = 'a21594a4-3081-709b-a851-17abe27d90c5';

const activated = (overrides: Record<string, unknown> = {}) => ({
  tenantId: TENANT,
  planId: 'growth',
  planName: 'Growth',
  monthlyProducts: 1000,
  mPaymentId: 'pay-1',
  periodStart: '2026-11-22T10:00:00.000Z',
  periodEnd: '2026-12-22T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mem.reset();
  sent.length = 0;
  schedules.length = 0;
  billingBooked.length = 0;
  accounts.users.clear();
  accounts.products.clear();
  accounts.subscribed.clear();
  accounts.users.set(OWNER, { email: 'thandi@example.co.za', enabled: true });
  vi.mocked(sendEmail).mockClear();
  process.env['SITE_URL'] = 'https://merchos.co.za';
  process.env['ENGAGEMENT_API_URL'] = 'https://api.example.com';
  _setTokenSecret('test-secret');
});

describe('trial track (sign-up)', () => {
  it('sends the trial welcome once and schedules tips and training', async () => {
    await onRegistered({ userId: OWNER, tenantId: TENANT, email: 'x', timestamp: 'now' });
    await onRegistered({ userId: OWNER, tenantId: TENANT }); // duplicate delivery / second emitter
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('thandi@example.co.za');
    expect(sent[0]!.subject).toBe('Welcome to MerchOS, your free trial has started');
    expect(sent[0]!.listUnsubscribeUrl).toBeUndefined();
    expect(schedules.map((s) => s.step)).toEqual(['tips', 'training', 'tips', 'training']);
    expect(mem.profiles.get(TENANT)?.referralCode).toMatch(/^THANDI/);
  });

  it('a failed send is retried by the next delivery', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('SES down'));
    await expect(onRegistered({ userId: OWNER, tenantId: TENANT })).rejects.toThrow('SES down');
    await onRegistered({ userId: OWNER, tenantId: TENANT });
    expect(sent).toHaveLength(1);
  });

  it('ignores deleted accounts and malformed events', async () => {
    await onRegistered({ userId: 'gone', tenantId: TENANT });
    await onRegistered({ tenantId: 'not-a-uuid' });
    expect(sent).toHaveLength(0);
  });

  it('tips and training go once each, and not to deleted accounts', async () => {
    await onRegistered({ userId: OWNER, tenantId: TENANT });
    expect(await runStep({ step: 'tips', tenantId: TENANT })).toBe('sent');
    expect(await runStep({ step: 'tips', tenantId: TENANT })).toBe('duplicate');
    accounts.users.delete(OWNER);
    expect(await runStep({ step: 'training', tenantId: TENANT })).toBe('skipped');
    expect(sent.map((s) => s.subject)).toEqual([
      'Welcome to MerchOS, your free trial has started',
      'Three ways to save hours with MerchOS',
    ]);
  });
});

describe('subscriber track (first payment)', () => {
  beforeEach(async () => {
    await onRegistered({ userId: OWNER, tenantId: TENANT });
    sent.length = 0;
    schedules.length = 0;
  });

  it('first activation: welcome with kept products, review day 30, referral day 35', async () => {
    accounts.products.set(TENANT, 12);
    await onSubscriptionActivated(activated());
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Thank you for subscribing to MerchOS');
    expect(sent[0]!.html).toContain('Your 12 trial products');
    expect(sent[0]!.html).toContain('resets on the 1st of each month');
    expect(sent[0]!.html).toContain('paid until <b>22 December 2026</b>');
    expect(sent[0]!.html).toContain('We never charge you automatically');
    expect(schedules).toEqual([
      { step: 'review', tenantId: TENANT, at: '2026-12-22T07:00:00.000Z' },
      { step: 'referral', tenantId: TENANT, at: '2026-12-27T07:00:00.000Z' },
    ]);
    expect(billingBooked).toEqual([{ tenantId: TENANT, paidUntil: '2026-12-22T10:00:00.000Z', planId: 'growth' }]);
  });

  it('renewals send nothing, but book that period\'s payment-cycle emails', async () => {
    await onSubscriptionActivated(activated());
    await onSubscriptionActivated(
      activated({ mPaymentId: 'pay-2', periodStart: '2026-12-22T10:00:00.000Z', periodEnd: '2027-01-22T10:00:00.000Z', previousPeriodEnd: '2026-12-22T10:00:00.000Z' }),
    );
    expect(sent).toHaveLength(1);
    expect(schedules).toHaveLength(2);
    expect(billingBooked.map((b) => b.paidUntil)).toEqual(['2026-12-22T10:00:00.000Z', '2027-01-22T10:00:00.000Z']);
  });

  it('review request: only with 5+ products, once, with signed star and unsubscribe links', async () => {
    await onSubscriptionActivated(activated());
    accounts.products.set(TENANT, 4);
    expect(await runStep({ step: 'review', tenantId: TENANT })).toBe('skipped');
    accounts.products.set(TENANT, 48);
    expect(await runStep({ step: 'review', tenantId: TENANT })).toBe('sent');
    const email = sent.at(-1)!;
    expect(email.html).toMatch(/https:\/\/merchos\.co\.za\/review\?t=rv\.[^&"]+&amp;r=5/);
    expect(email.html).toContain('https://merchos.co.za/unsubscribe?t=un.');
    expect(email.listUnsubscribeUrl).toMatch(/^https:\/\/api\.example\.com\/unsubscribe\?t=un\./);
  });

  it('marketing emails respect the opt-out; transactional ones do not need it', async () => {
    await onSubscriptionActivated(activated());
    accounts.products.set(TENANT, 48);
    accounts.subscribed.add(TENANT);
    mem.profiles.get(TENANT)!.marketingOptOut = true;
    expect(await runStep({ step: 'review', tenantId: TENANT })).toBe('opted-out');
    expect(await runStep({ step: 'referral', tenantId: TENANT })).toBe('opted-out');
    expect(await runStep({ step: 'tips', tenantId: TENANT })).toBe('sent');
  });

  it('referral invite only while still subscribed, with the personal link', async () => {
    await onSubscriptionActivated(activated());
    expect(await runStep({ step: 'referral', tenantId: TENANT })).toBe('skipped');
    accounts.subscribed.add(TENANT);
    expect(await runStep({ step: 'referral', tenantId: TENANT })).toBe('sent');
    const code = mem.profiles.get(TENANT)!.referralCode!;
    expect(sent.at(-1)!.html).toContain(`merchos.co.za/r/${code}`);
  });
});

describe('referral reward', () => {
  beforeEach(async () => {
    accounts.users.set('referrer-user', { email: 'ref@example.co.za', enabled: true });
    await onRegistered({ userId: 'referrer-user', tenantId: REFERRER });
    await onRegistered({ userId: OWNER, tenantId: TENANT });
    await fakeStore.createReferral({
      referrerTenantId: REFERRER,
      referredTenantId: TENANT,
      code: mem.profiles.get(REFERRER)!.referralCode!,
      status: 'PENDING',
      claimedAt: '2026-11-21T10:00:00.000Z',
    });
    schedules.length = 0;
  });

  it('first payment starts the 14-day check; still subscribed earns a free month', async () => {
    await onSubscriptionActivated(activated());
    expect(schedules[0]).toEqual({
      step: 'qualify',
      tenantId: TENANT,
      referrerTenantId: REFERRER,
      at: '2026-12-06T10:00:00.000Z',
    });
    accounts.subscribed.add(TENANT);
    accounts.products.set(TENANT, 10);
    expect(await runStep({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER })).toBe('qualified');
    expect(await fakeStore.getReferral(REFERRER, TENANT)).toMatchObject({ status: 'QUALIFIED', reward: 'EARNED' });
    // Running again (retry) changes nothing.
    expect(await runStep({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER })).toBe('skipped');
  });

  it('still paying but under 10 products: no reward yet, checked again in a week', async () => {
    await onSubscriptionActivated(activated());
    accounts.subscribed.add(TENANT);
    accounts.products.set(TENANT, 6);
    schedules.length = 0;
    expect(await runStep({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER })).toBe('waiting');
    expect(await fakeStore.getReferral(REFERRER, TENANT)).toMatchObject({ status: 'SUBSCRIBED', productsAtLastCheck: 6 });
    expect((await fakeStore.getReferral(REFERRER, TENANT))?.reward).toBeUndefined();
    expect(schedules).toEqual([
      expect.objectContaining({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER, attempt: 1 }),
    ]);
    // A week later they have 10: the free month is earned.
    accounts.products.set(TENANT, 12);
    expect(await runStep({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER, attempt: 1 })).toBe('qualified');
  });

  it('still under 10 products 90 days after paying: does not qualify', async () => {
    await onSubscriptionActivated(activated({ periodStart: '2026-01-01T10:00:00.000Z' }));
    accounts.subscribed.add(TENANT);
    accounts.products.set(TENANT, 3);
    schedules.length = 0;
    expect(await runStep({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER, attempt: 11 })).toBe('lapsed');
    expect(await fakeStore.getReferral(REFERRER, TENANT)).toMatchObject({ status: 'LAPSED', lapseReason: 'not-active' });
    expect(schedules).toHaveLength(0);
  });

  it('stopped paying within 14 days: no reward', async () => {
    await onSubscriptionActivated(activated());
    accounts.products.set(TENANT, 50);
    expect(await runStep({ step: 'qualify', tenantId: TENANT, referrerTenantId: REFERRER })).toBe('lapsed');
    expect(await fakeStore.getReferral(REFERRER, TENANT)).toMatchObject({ status: 'LAPSED', lapseReason: 'stopped-paying' });
    expect((await fakeStore.getReferral(REFERRER, TENANT))?.reward).toBeUndefined();
  });

  it('renewals do not restart the check', async () => {
    await onSubscriptionActivated(activated());
    await onSubscriptionActivated(activated({ mPaymentId: 'pay-2' }));
    expect(schedules.filter((s) => s.step === 'qualify')).toHaveLength(1);
  });
});
