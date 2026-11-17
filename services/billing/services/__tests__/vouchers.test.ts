import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  priceWithVoucher,
  recordVoucherRedemption,
  setVoucherDocClient,
  normaliseVoucherCode,
  PAYFAST_MIN_CHARGE_CENTS,
  VoucherError,
  type VoucherRecord,
} from '../vouchers';

const base: VoucherRecord = {
  code: 'TEST',
  kind: 'amount_off_cents',
  value: 49400,
  redeemed: 0,
  active: true,
  createdAt: '2026-11-17T00:00:00.000Z',
};
const NOW = new Date('2026-11-17T12:00:00.000Z');

describe('normaliseVoucherCode', () => {
  it('trims and uppercases', () => {
    expect(normaliseVoucherCode('  live-test_5 ')).toBe('LIVE-TEST_5');
  });
});

describe('priceWithVoucher', () => {
  it('R494 off Starter (R499) charges R5.00', () => {
    expect(priceWithVoucher(base, 'starter', 49900, NOW)).toMatchObject({
      discountCents: 49400,
      finalCents: 500,
      listPriceCents: 49900,
    });
  });
  it('caps the discount so the charge never drops below PayFast’s R5.00 minimum', () => {
    const r = priceWithVoucher({ ...base, value: 99999999 }, 'starter', 49900, NOW);
    expect(r.finalCents).toBe(PAYFAST_MIN_CHARGE_CENTS);
    expect(r.discountCents).toBe(49900 - PAYFAST_MIN_CHARGE_CENTS);
  });
  it('percent_off rounds the discount down', () => {
    const r = priceWithVoucher({ ...base, kind: 'percent_off', value: 10 }, 'starter', 49905, NOW);
    expect(r.discountCents).toBe(4990);
    expect(r.finalCents).toBe(44915);
  });
  it('100% off is capped at the minimum charge (no free checkout path)', () => {
    const r = priceWithVoucher({ ...base, kind: 'percent_off', value: 100 }, 'growth', 99900, NOW);
    expect(r.finalCents).toBe(PAYFAST_MIN_CHARGE_CENTS);
  });
  it.each([
    ['missing voucher', null],
    ['inactive', { ...base, active: false }],
    ['expired', { ...base, expiresAt: '2026-11-17T11:59:59.000Z' }],
    ['wrong plan', { ...base, planIds: ['growth'] }],
    ['fully redeemed', { ...base, maxRedemptions: 1, redeemed: 1 }],
    ['zero value', { ...base, value: 0 }],
    ['fractional cents', { ...base, value: 10.5 }],
    ['percent over 100', { ...base, kind: 'percent_off' as const, value: 101 }],
    ['unknown kind', { ...base, kind: 'bogus' as never }],
  ])('rejects %s with a generic VoucherError', (_n, v) => {
    expect(() => priceWithVoucher(v as VoucherRecord | null, 'starter', 49900, NOW)).toThrow(VoucherError);
  });
  it('accepts a voucher restricted to the matching plan and not yet expired', () => {
    const r = priceWithVoucher(
      { ...base, planIds: ['starter'], expiresAt: '2026-12-01T00:00:00.000Z', maxRedemptions: 2, redeemed: 1 },
      'starter',
      49900,
      NOW,
    );
    expect(r.finalCents).toBe(500);
  });
  it('error message does not reveal why', () => {
    try {
      priceWithVoucher(null, 'starter', 49900, NOW);
    } catch (e) {
      expect((e as Error).message).toBe('This voucher code is not valid for this plan.');
    }
  });
});

describe('recordVoucherRedemption', () => {
  const send = vi.fn();
  beforeEach(() => {
    send.mockReset();
    setVoucherDocClient({ send } as never);
  });

  it('writes a per-payment marker and increments the counter in ONE transaction', async () => {
    send.mockResolvedValue({});
    expect(await recordVoucherRedemption('TEST', 't-1', 'pay-1')).toBe(true);
    const items = send.mock.calls[0]![0].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put.Item).toMatchObject({ PK: 'VOUCHERUSE#TEST', SK: 'PAYMENT#pay-1', tenantId: 't-1' });
    expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(items[1].Update.Key).toEqual({ PK: 'VOUCHER#TEST', SK: 'META' });
    expect(items[1].Update.ExpressionAttributeNames).toEqual({ '#r': 'redeemed' });
  });
  it('returns false (no double count) when the transaction is cancelled on retry', async () => {
    send.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' }));
    expect(await recordVoucherRedemption('TEST', 't-1', 'pay-1')).toBe(false);
  });
  it('propagates unexpected errors so PayFast retries the ITN', async () => {
    send.mockRejectedValue(Object.assign(new Error('boom'), { name: 'InternalServerError' }));
    await expect(recordVoucherRedemption('TEST', 't-1', 'pay-1')).rejects.toThrow('boom');
  });
});
