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
