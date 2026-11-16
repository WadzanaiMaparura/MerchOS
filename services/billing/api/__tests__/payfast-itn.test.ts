import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/subscription-store', () => ({
  getCheckoutIntent: vi.fn(),
  upsertSubscription: vi.fn(),
  recordPayment: vi.fn(),
  getPayment: vi.fn(),
  markPaymentApplied: vi.fn(),
}));
vi.mock('../../services/credit-ledger', () => ({
  grantCredits: vi.fn(),
}));
vi.mock('../../../shared/middleware/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handler, setPaymentProvider } from '../handlers/payfast-itn';
import * as store from '../../services/subscription-store';
import * as ledger from '../../services/credit-ledger';

const verifyItn = vi.fn();
const provider = {
  name: 'payfast',
  initiateCheckout: vi.fn(),
  verifyItn,
};

const event = {
  body: 'ignored-by-fake-provider',
  isBase64Encoded: false,
  headers: {},
  requestContext: { http: { sourceIp: '196.33.227.1' } },
} as never;

const GOOD = {
  valid: true,
  mPaymentId: 'pay-1',
  amountGrossCents: 99900,
  paymentStatus: 'COMPLETE',
  raw: { custom_str1: 'tenant-1', m_payment_id: 'pay-1' },
};

const growthIntent = {
  tenantId: 'tenant-1',
  mPaymentId: 'pay-1',
  planId: 'growth',
  priceZARCents: 99900,
  createdAt: '2026-11-16T00:00:00.000Z',
};

const body = async (): Promise<string> => {
  const res = (await handler(event)) as { statusCode: number; body: string };
  expect(res.statusCode).toBe(200);
  return res.body;
};

beforeEach(() => {
  vi.clearAllMocks();
  setPaymentProvider(provider as never);
  verifyItn.mockResolvedValue(GOOD);
  vi.mocked(store.getCheckoutIntent).mockResolvedValue(growthIntent as never);
  vi.mocked(store.recordPayment).mockResolvedValue(true);
  vi.mocked(store.getPayment).mockResolvedValue({ mPaymentId: 'pay-1', applied: false });
});

describe('PayFast ITN — happy path', () => {
  it('activates the plan, grants 400 credits, then marks the payment applied (in that order)', async () => {
    expect(await body()).toBe('ok');

    expect(store.upsertSubscription).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ planId: 'growth', status: 'active', provider: 'payfast', mPaymentId: 'pay-1' })
    );
    expect(ledger.grantCredits).toHaveBeenCalledWith('tenant-1', expect.stringMatching(/^\d{6}$/), 400);

    const order = [
      vi.mocked(store.upsertSubscription).mock.invocationCallOrder[0]!,
      vi.mocked(ledger.grantCredits).mock.invocationCallOrder[0]!,
      vi.mocked(store.markPaymentApplied).mock.invocationCallOrder[0]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('PayFast ITN — rejections apply nothing', () => {
  const expectNothingApplied = () => {
    expect(store.recordPayment).not.toHaveBeenCalled();
    expect(store.upsertSubscription).not.toHaveBeenCalled();
    expect(ledger.grantCredits).not.toHaveBeenCalled();
    expect(store.markPaymentApplied).not.toHaveBeenCalled();
  };

  it('invalid signature', async () => {
    verifyItn.mockResolvedValue({ valid: false, reason: 'signature_mismatch' });
    expect(await body()).toBe('invalid');
    expectNothingApplied();
  });

  it('non-COMPLETE payment status', async () => {
    verifyItn.mockResolvedValue({ ...GOOD, paymentStatus: 'PENDING' });
    expect(await body()).toBe('ignored-status');
    expectNothingApplied();
  });

  it('missing tenant correlation', async () => {
    verifyItn.mockResolvedValue({ ...GOOD, raw: {} });
    expect(await body()).toBe('missing-correlation');
    expectNothingApplied();
  });

  it('no matching checkout intent', async () => {
    vi.mocked(store.getCheckoutIntent).mockResolvedValue(null);
    expect(await body()).toBe('no-intent');
    expectNothingApplied();
  });

  it('amount different from the captured price (even if correctly signed)', async () => {
    verifyItn.mockResolvedValue({ ...GOOD, amountGrossCents: 100 });
    expect(await body()).toBe('amount-mismatch');
    expectNothingApplied();
  });

  it('missing amount', async () => {
    const { amountGrossCents: _omit, ...noAmount } = GOOD;
    verifyItn.mockResolvedValue(noAmount);
    expect(await body()).toBe('amount-mismatch');
    expectNothingApplied();
  });

  it('verification throwing is acknowledged, not retried forever', async () => {
    verifyItn.mockRejectedValue(new Error('boom'));
    expect(await body()).toBe('error-verifying');
    expectNothingApplied();
  });
});

describe('PayFast ITN — idempotency and recovery', () => {
  it('ignores a replay of a fully-applied payment', async () => {
    vi.mocked(store.recordPayment).mockResolvedValue(false);
    vi.mocked(store.getPayment).mockResolvedValue({ mPaymentId: 'pay-1', applied: true });

    expect(await body()).toBe('duplicate');
    expect(store.upsertSubscription).not.toHaveBeenCalled();
    expect(ledger.grantCredits).not.toHaveBeenCalled();
  });

  it('RESUMES a payment that was claimed but not finished (the lost-credits bug)', async () => {
    vi.mocked(store.recordPayment).mockResolvedValue(false);
    vi.mocked(store.getPayment).mockResolvedValue({ mPaymentId: 'pay-1', applied: false });

    expect(await body()).toBe('ok');
    expect(ledger.grantCredits).toHaveBeenCalledWith('tenant-1', expect.any(String), 400);
    expect(store.markPaymentApplied).toHaveBeenCalledWith('tenant-1', 'pay-1');
  });

  it('does NOT mark the payment applied if granting credits fails, and surfaces the error for a retry', async () => {
    vi.mocked(ledger.grantCredits).mockRejectedValue(new Error('dynamo down'));

    await expect(handler(event)).rejects.toThrow('dynamo down');
    expect(store.markPaymentApplied).not.toHaveBeenCalled();
  });
});
