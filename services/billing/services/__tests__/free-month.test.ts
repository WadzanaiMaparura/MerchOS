import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory billing table: the subscription and the credit records. */
const mem = vi.hoisted(() => ({
  sub: null as null | Record<string, unknown>,
  credits: new Map<string, Record<string, unknown>>(),
  marked: [] as Array<{ until: string; options: unknown }>,
  /** Simulates a payment landing between our read and our write. */
  beforeExtend: undefined as undefined | (() => void),
}));

vi.mock('../subscription-store', () => ({
  getSubscription: vi.fn(async () => (mem.sub ? { ...mem.sub, freeMonthCredits: new Set(mem.sub['freeMonthCredits'] as Set<string> | undefined) } : null)),
  getFreeMonthCredit: vi.fn(async (_t: string, id: string) => (mem.credits.has(id) ? { ...mem.credits.get(id) } : null)),
  saveFreeMonthCredit: vi.fn(async (_t: string, c: Record<string, unknown>) => {
    const prev = mem.credits.get(c['creditId'] as string);
    if (prev?.['appliedAt']) throw Object.assign(new Error('applied'), { name: 'ConditionalCheckFailedException' });
    mem.credits.set(c['creditId'] as string, { ...prev, ...c });
  }),
  markFreeMonthCreditApplied: vi.fn(async (_t: string, id: string) => {
    mem.credits.set(id, { ...mem.credits.get(id), appliedAt: mem.credits.get(id)?.['appliedAt'] ?? 'now' });
  }),
  extendPaidUntil: vi.fn(async (_t: string, from: string, to: string, id: string) => {
    mem.beforeExtend?.();
    mem.beforeExtend = undefined;
    const set = (mem.sub!['freeMonthCredits'] as Set<string> | undefined) ?? new Set<string>();
    if (mem.sub!['currentPeriodEnd'] !== from || set.has(id)) return false;
    mem.sub!['currentPeriodEnd'] = to;
    mem.sub!['freeMonthCredits'] = new Set([...set, id]);
    return true;
  }),
}));
vi.mock('../../../shared/entitlements/trial-gate', () => ({
  markSubscribed: vi.fn(async (_t: string, until: string, options: unknown) => {
    mem.marked.push({ until, options });
  }),
}));

import { applyReferralFreeMonth, referralCreditId } from '../free-month';

const REFERRER = '11111111-1111-4111-8111-111111111111';
const REFERRED = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const TOKEN = '2afa4575-5628-051a-d0ed-4e071b56a7b0';
const NOW = new Date('2026-11-25T10:00:00.000Z');
const END = '2026-12-10T08:00:00.000Z';

const api = { cancel: vi.fn(), updateAmount: vi.fn(), setNextChargeDate: vi.fn(async () => undefined) };
const deps = { subscriptionsApi: async () => api, now: () => NOW };

const paying = (over: Record<string, unknown> = {}) => ({
  tenantId: REFERRER,
  planId: 'starter',
  status: 'active',
  provider: 'payfast',
  currentPeriodStart: '2026-11-10T08:00:00.000Z',
  currentPeriodEnd: END,
  ...over,
});

beforeEach(() => {
  process.env['REFERRAL_FREE_MONTHS'] = 'true';
  mem.sub = null;
  mem.credits.clear();
  mem.marked.length = 0;
  mem.beforeExtend = undefined;
  api.setNextChargeDate.mockClear();
});
afterEach(() => {
  delete process.env['REFERRAL_FREE_MONTHS'];
});

describe('referral free month', () => {
  it('does nothing while the switch is off', async () => {
    delete process.env['REFERRAL_FREE_MONTHS'];
    mem.sub = paying();
    expect(await applyReferralFreeMonth(REFERRER, REFERRED, deps)).toEqual({ outcome: 'switched-off' });
    expect(mem.sub['currentPeriodEnd']).toBe(END);
  });

  it('EFT payer: paid-until one month later, allowance follows, no PayFast call', async () => {
    mem.sub = paying();
    const out = await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    expect(out).toEqual({ outcome: 'applied', planId: 'starter', fromEnd: END, toEnd: '2027-01-10T08:00:00.000Z' });
    expect(mem.sub['currentPeriodEnd']).toBe('2027-01-10T08:00:00.000Z');
    expect(mem.marked).toEqual([{ until: '2027-01-10T08:00:00.000Z', options: { monthlyProductLimit: 500 } }]);
    expect(api.setNextChargeDate).not.toHaveBeenCalled();
    expect(mem.credits.get(referralCreditId(REFERRED))).toMatchObject({ appliedAt: 'now', fromEnd: END });
  });

  it('card on file: the next charge moves to the new paid-until (South African date)', async () => {
    mem.sub = paying({ autoRenew: true, payfastToken: TOKEN, currentPeriodEnd: '2026-12-24T23:30:00.000Z' });
    await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    // 24 Jan 23:30 UTC is already 25 Jan in South Africa.
    expect(api.setNextChargeDate).toHaveBeenCalledWith(TOKEN, '2027-01-25');
    expect(mem.marked[0]!.options).toEqual({ monthlyProductLimit: 500, autoRenew: true });
  });

  it('cancelled card (no automatic charge): only paid-until moves', async () => {
    mem.sub = paying({ autoRenew: false, payfastToken: TOKEN });
    await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    expect(api.setNextChargeDate).not.toHaveBeenCalled();
  });

  it.each([
    ['on the free trial (no subscription)', null],
    ['paid month already over', paying({ currentPeriodEnd: '2026-11-24T10:00:00.000Z' })],
    ['subscription not active', paying({ status: 'cancelled' })],
  ])('not paying (%s): stays owed, nothing changes', async (_n, sub) => {
    mem.sub = sub as never;
    expect(await applyReferralFreeMonth(REFERRER, REFERRED, deps)).toEqual({ outcome: 'not-paying' });
    expect(mem.marked).toEqual([]);
    expect(mem.credits.size).toBe(0);
  });

  it('a repeat request never adds a second month', async () => {
    mem.sub = paying({ autoRenew: true, payfastToken: TOKEN });
    await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    const again = await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    expect(again).toMatchObject({ outcome: 'already', toEnd: '2027-01-10T08:00:00.000Z' });
    expect(mem.sub['currentPeriodEnd']).toBe('2027-01-10T08:00:00.000Z');
    expect(api.setNextChargeDate).toHaveBeenCalledTimes(1);
  });

  it('resumes after stopping between moving paid-until and finishing', async () => {
    mem.sub = paying();
    const store = await import('../subscription-store');
    vi.mocked(store.markFreeMonthCreditApplied).mockRejectedValueOnce(new Error('DynamoDB down'));
    await expect(applyReferralFreeMonth(REFERRER, REFERRED, deps)).rejects.toThrow('DynamoDB down');
    expect(mem.sub['currentPeriodEnd']).toBe('2027-01-10T08:00:00.000Z');

    const retry = await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    expect(retry).toMatchObject({ outcome: 'applied', toEnd: '2027-01-10T08:00:00.000Z' });
    expect(mem.sub['currentPeriodEnd']).toBe('2027-01-10T08:00:00.000Z'); // still one month, not two
  });

  it('a payment landing at the same moment: the free month goes on top of it', async () => {
    mem.sub = paying();
    mem.beforeExtend = () => {
      mem.sub!['currentPeriodEnd'] = '2027-01-10T08:00:00.000Z'; // renewal ITN
    };
    const out = await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    expect(out).toMatchObject({ outcome: 'applied', fromEnd: '2027-01-10T08:00:00.000Z', toEnd: '2027-02-10T08:00:00.000Z' });
    expect(mem.sub['currentPeriodEnd']).toBe('2027-02-10T08:00:00.000Z');
  });

  it('two owed months: one month each, in order', async () => {
    mem.sub = paying();
    await applyReferralFreeMonth(REFERRER, REFERRED, deps);
    await applyReferralFreeMonth(REFERRER, OTHER, deps);
    expect(mem.sub['currentPeriodEnd']).toBe('2027-02-10T08:00:00.000Z');
  });

  it('PayFast refuses the date change: paid-until is not moved (retried later)', async () => {
    mem.sub = paying({ autoRenew: true, payfastToken: TOKEN });
    api.setNextChargeDate.mockRejectedValueOnce(new Error('PayFast subscriptions update failed (400)'));
    await expect(applyReferralFreeMonth(REFERRER, REFERRED, deps)).rejects.toThrow('400');
    expect(mem.sub['currentPeriodEnd']).toBe(END);
    expect(mem.marked).toEqual([]);
  });
});
