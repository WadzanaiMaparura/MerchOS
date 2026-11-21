import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/subscription-store', () => ({
  getCheckoutIntent: vi.fn(),
  upsertSubscription: vi.fn(),
  recordPayment: vi.fn(),
  getPayment: vi.fn(),
  markPaymentApplied: vi.fn(),
  upsertInvoice: vi.fn(),
}));
vi.mock('../../invoices/issue-invoice', () => ({
  issueInvoiceDocument: vi.fn(),
}));
vi.mock('../../services/vouchers', () => ({
  recordVoucherRedemption: vi.fn(),
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
import * as vouchers from '../../services/vouchers';
import * as issuing from '../../invoices/issue-invoice';

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

describe('PayFast ITN ? invoice document', () => {
  it('records the voucher/payer on the invoice, then issues the document BEFORE marking applied', async () => {
    verifyItn.mockResolvedValue({
      ...GOOD,
      amountGrossCents: 500,
      raw: { ...GOOD.raw, name_first: 'Jane', name_last: 'Payer', email_address: 'jane@example.com' },
    });
    vi.mocked(store.getCheckoutIntent).mockResolvedValue({
      ...growthIntent,
      planId: 'starter',
      priceZARCents: 500,
      voucherCode: 'LIVE-TEST-R5',
      listPriceCents: 49900,
      discountCents: 49400,
    } as never);
    expect(await body()).toBe('ok');
    expect(store.upsertInvoice).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        amountCents: 500,
        listPriceCents: 49900,
        discountCents: 49400,
        voucherCode: 'LIVE-TEST-R5',
        payerName: 'Jane Payer',
        payerEmail: 'jane@example.com',
      }),
    );
    expect(issuing.issueInvoiceDocument).toHaveBeenCalledWith('tenant-1', 'pay-1');
    const order = [
      vi.mocked(store.upsertInvoice).mock.invocationCallOrder[0]!,
      vi.mocked(issuing.issueInvoiceDocument).mock.invocationCallOrder[0]!,
      vi.mocked(store.markPaymentApplied).mock.invocationCallOrder[0]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('a failure issuing the document does NOT fail the payment (it is retried on download)', async () => {
    vi.mocked(issuing.issueInvoiceDocument).mockRejectedValue(new Error('s3 down'));
    expect(await body()).toBe('ok');
    expect(store.markPaymentApplied).toHaveBeenCalled();
    expect(store.upsertSubscription).toHaveBeenCalled();
  });

  it('omits payer fields when PayFast sent them blank', async () => {
    verifyItn.mockResolvedValue({ ...GOOD, raw: { ...GOOD.raw, name_first: '', name_last: '', email_address: '' } });
    await body();
    const arg = vi.mocked(store.upsertInvoice).mock.calls[0]![1] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('payerName');
    expect(arg).not.toHaveProperty('payerEmail');
  });
});

describe('PayFast ITN ? voucher checkout', () => {
  const voucherIntent = {
    ...growthIntent,
    planId: 'starter',
    priceZARCents: 500,
    voucherCode: 'LIVE-TEST',
    listPriceCents: 49900,
    discountCents: 49400,
  };

  it('accepts the discounted amount, records the redemption BEFORE marking applied, and keeps the list price on the subscription', async () => {
    verifyItn.mockResolvedValue({ ...GOOD, amountGrossCents: 500 });
    vi.mocked(store.getCheckoutIntent).mockResolvedValue(voucherIntent as never);
    expect(await body()).toBe('ok');
    expect(vouchers.recordVoucherRedemption).toHaveBeenCalledWith('LIVE-TEST', 'tenant-1', 'pay-1');
    expect(store.upsertSubscription).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ planId: 'starter', priceZARCents: 49900 }),
    );
    expect(store.upsertInvoice).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ amountCents: 500 }),
    );
    expect(vi.mocked(vouchers.recordVoucherRedemption).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(store.markPaymentApplied).mock.invocationCallOrder[0]!,
    );
  });

  it('rejects a payment of the LIST price against a discounted intent (amount tampering)', async () => {
    verifyItn.mockResolvedValue({ ...GOOD, amountGrossCents: 49900 });
    vi.mocked(store.getCheckoutIntent).mockResolvedValue(voucherIntent as never);
    expect(await body()).toBe('amount-mismatch');
    expect(vouchers.recordVoucherRedemption).not.toHaveBeenCalled();
    expect(store.upsertSubscription).not.toHaveBeenCalled();
  });

  it('does not touch vouchers when the intent has none', async () => {
    expect(await body()).toBe('ok');
    expect(vouchers.recordVoucherRedemption).not.toHaveBeenCalled();
  });
});

describe('PayFast ITN ? transient verification failure', () => {
  it('answers 503 (so PayFast retries) and applies nothing when verification is unavailable', async () => {
    verifyItn.mockResolvedValue({ valid: false, retryable: true, reason: 'postback_unreachable' });
    const res = (await handler(event)) as { statusCode: number };
    expect(res.statusCode).toBe(503);
    expect(store.upsertSubscription).not.toHaveBeenCalled();
    expect(ledger.grantCredits).not.toHaveBeenCalled();
  });

  it('answers 200 (final) when verification definitively rejects', async () => {
    verifyItn.mockResolvedValue({ valid: false, reason: 'source_ip_not_allowed' });
    expect(await body()).toBe('invalid');
  });
});

describe('PayFast ITN — happy path', () => {
  it('activates the plan, grants 6,000 safeguard credits, then marks the payment applied (in that order)', async () => {
    expect(await body()).toBe('ok');

    expect(store.upsertSubscription).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ planId: 'growth', status: 'active', provider: 'payfast', mPaymentId: 'pay-1' })
    );
    expect(ledger.grantCredits).toHaveBeenCalledWith('tenant-1', expect.stringMatching(/^\d{6}$/), 6000);
    expect(store.upsertInvoice).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ invoiceId: 'pay-1', amountCents: 99900, planId: 'growth' })
    );

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

  it('verification throwing (our side failed) answers 503 so PayFast retries, and applies nothing', async () => {
    verifyItn.mockRejectedValue(new Error('secrets manager unavailable'));
    const res = (await handler(event)) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(503);
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
    expect(ledger.grantCredits).toHaveBeenCalledWith('tenant-1', expect.any(String), 6000);
    expect(store.markPaymentApplied).toHaveBeenCalledWith('tenant-1', 'pay-1');
  });

  it('does NOT mark the payment applied if granting credits fails, and surfaces the error for a retry', async () => {
    vi.mocked(ledger.grantCredits).mockRejectedValue(new Error('dynamo down'));

    await expect(handler(event)).rejects.toThrow('dynamo down');
    expect(store.markPaymentApplied).not.toHaveBeenCalled();
  });
});
