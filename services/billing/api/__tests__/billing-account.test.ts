import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/entitlements/trial-gate', () => ({ getEntitlement: vi.fn() }));
vi.mock('../../../shared/middleware/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), addContext: vi.fn() },
}));

import { accountState } from '../handlers/get-billing';
import { getEntitlement } from '../../../shared/entitlements/trial-gate';

const UNTIL = '2026-12-22T10:00:00.000Z';
const at = (days: number) => new Date(Date.parse(UNTIL) + days * 86_400_000);
const sub = (over: Record<string, unknown> = {}) =>
  ({
    tenantId: 't',
    planId: 'growth',
    status: 'active',
    provider: 'payfast',
    currentPeriodEnd: UNTIL,
    createdAt: '',
    updatedAt: '',
    ...over,
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  process.env['BILLING_LIFECYCLE'] = 'true';
});

describe('GET /billing account state', () => {
  it('gives the stage and its dates from the entitlement', async () => {
    vi.mocked(getEntitlement).mockResolvedValue({ status: 'subscribed', subscribedUntil: UNTIL, productsUsed: 0, productLimit: 15 });
    expect(await accountState('t', sub(), at(10))).toEqual({
      stage: 'paused',
      lifecycleEnabled: true,
      lastPlanId: 'growth',
      paidUntil: UNTIL,
      graceEndsAt: '2026-12-25T10:00:00.000Z',
      closesAt: '2027-01-28T10:00:00.000Z',
      dataKeptUntil: '2028-01-28T10:00:00.000Z',
    });
  });

  it('shows the comeback offer in its window', async () => {
    vi.mocked(getEntitlement).mockResolvedValue({ status: 'subscribed', subscribedUntil: UNTIL, productsUsed: 0, productLimit: 15 });
    const s = await accountState('t', sub(), at(92));
    expect(s.stage).toBe('closed');
    expect(s.comeback).toEqual({ percentOff: 50, endsAt: '2027-04-05T10:00:00.000Z' });
  });

  it('free unlimited accounts never pause', async () => {
    vi.mocked(getEntitlement).mockResolvedValue({ status: 'exempt', subscribedUntil: UNTIL, productsUsed: 0, productLimit: 15 });
    const s = await accountState('t', sub(), at(60));
    expect(s.stage).toBe('exempt');
    expect(s.paidUntil).toBeUndefined();
  });

  it('falls back to the subscription when the entitlement cannot be read, and reports the switch', async () => {
    process.env['BILLING_LIFECYCLE'] = 'false';
    vi.mocked(getEntitlement).mockRejectedValue(new Error('no access'));
    const s = await accountState('t', sub(), at(-3));
    expect(s).toMatchObject({ stage: 'due_soon', lifecycleEnabled: false });
    expect(s.comeback).toBeUndefined();
  });

  it('a seller who never paid is on the trial', async () => {
    vi.mocked(getEntitlement).mockResolvedValue(null);
    expect(await accountState('t', null, at(0))).toEqual({ stage: 'none', lifecycleEnabled: true });
  });
});

describe('GET /billing card status', () => {
  const TOKEN = '2afa4575-5628-051a-d0ed-4e071b56a7b0';
  beforeEach(() => {
    process.env['CARD_SUBSCRIPTIONS'] = 'true';
    process.env['PAYFAST_MERCHANT_ID'] = '10000100';
    process.env['PAYFAST_MERCHANT_KEY'] = 'k';
    process.env['PAYFAST_MODE'] = 'live';
    process.env['APP_BASE_URL'] = 'https://merchos.co.za';
    vi.mocked(getEntitlement).mockResolvedValue({ status: 'subscribed', subscribedUntil: UNTIL, productsUsed: 0, productLimit: 15 });
  });

  it('shows the next automatic charge (a scheduled downgrade at its price) and the update-card link', async () => {
    const s = await accountState('t', sub({ autoRenew: true, payfastToken: TOKEN, planId: 'professional', nextPlanId: 'growth' }), at(-10));
    expect(s).toMatchObject({
      cardBillingEnabled: true,
      autoRenew: true,
      nextCharge: { at: UNTIL, amountCents: 89900, planId: 'growth' },
    });
    expect(s.cardUpdateUrl).toBe(`https://www.payfast.co.za/eng/recurring/update/${TOKEN}?return=https%3A%2F%2Fmerchos.co.za%2Fbilling%3Fcard%3Dupdated`);
  });

  it('a declined charge is flagged; nothing about cards while switched off', async () => {
    expect((await accountState('t', sub({ autoRenew: true, payfastToken: TOKEN, lastChargeFailedAt: 'x' }), at(1))).chargeFailed).toBe(true);
    process.env['CARD_SUBSCRIPTIONS'] = 'false';
    const off = await accountState('t', sub({ autoRenew: true, payfastToken: TOKEN }), at(-10));
    expect(off.cardBillingEnabled).toBeUndefined();
    expect(off.cardUpdateUrl).toBeUndefined();
  });
});
