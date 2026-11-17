import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/subscription-store', () => ({
  createCheckoutIntent: vi.fn(),
}));
vi.mock('../../services/vouchers', async (orig) => ({
  ...(await orig<typeof import('../../services/vouchers')>()),
  resolveVoucher: vi.fn(),
}));
vi.mock('../../../shared/middleware/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), addContext: vi.fn() },
}));

import { handler, setPaymentProvider } from '../handlers/change-plan';
import * as store from '../../services/subscription-store';
import * as vouchers from '../../services/vouchers';

const ISS = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
process.env['COGNITO_ISSUER'] = ISS;

const initiateCheckout = vi.fn();
const provider = { name: 'payfast', initiateCheckout, verifyItn: vi.fn() };

function event(body: unknown) {
  return {
    version: '2.0',
    routeKey: 'POST /billing/plan',
    rawPath: '/billing/plan',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      domainName: 'api.example.com',
      http: { method: 'POST', path: '/billing/plan', sourceIp: '1.1.1.1' },
      authorizer: {
        jwt: {
          claims: {
            sub: 'u-1',
            iss: ISS,
            exp: Math.floor(Date.now() / 1000) + 600,
            'cognito:groups': ['Seller'],
            'custom:tenantId': 'tenant-1',
            token_use: 'access',
          },
        },
      },
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as never;
}
const call = async (body: unknown) => {
  const res = (await (handler as unknown as (e: unknown, c: unknown) => Promise<{ statusCode: number; body: string }>)(
    event(body),
    {},
  ));
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['CHECKOUT_ENABLED'] = 'true';
  setPaymentProvider(provider as never);
  initiateCheckout.mockResolvedValue({ redirectUrl: 'https://pay.example/x', mPaymentId: 'pay-1' });
});

describe('POST /billing/plan with a voucher', () => {
  it('charges the server-priced amount and stores the voucher on the checkout intent', async () => {
    vi.mocked(vouchers.resolveVoucher).mockResolvedValue({
      voucherCode: 'LIVE-TEST',
      listPriceCents: 49900,
      discountCents: 49400,
      finalCents: 500,
    });
    const { status, json } = await call({ planId: 'starter', voucherCode: 'live-test' });
    expect(status).toBe(200);
    expect(json.mPaymentId).toBe('pay-1');
    expect(vouchers.resolveVoucher).toHaveBeenCalledWith('live-test', 'starter', 49900);
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 500 }));
    expect(store.createCheckoutIntent).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({
        priceZARCents: 500,
        voucherCode: 'LIVE-TEST',
        listPriceCents: 49900,
        discountCents: 49400,
      }),
    );
  });

  it('rejects an invalid voucher with VOUCHER_INVALID and starts no checkout', async () => {
    vi.mocked(vouchers.resolveVoucher).mockRejectedValue(new vouchers.VoucherError());
    const { status, json } = await call({ planId: 'starter', voucherCode: 'NOPE' });
    expect(status).toBe(400);
    expect(json.error.code).toBe('VOUCHER_INVALID');
    expect(initiateCheckout).not.toHaveBeenCalled();
    expect(store.createCheckoutIntent).not.toHaveBeenCalled();
  });

  it('without a voucher charges the list price and never touches vouchers', async () => {
    const { status } = await call({ planId: 'starter' });
    expect(status).toBe(200);
    expect(vouchers.resolveVoucher).not.toHaveBeenCalled();
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 49900 }));
    expect(store.createCheckoutIntent).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ priceZARCents: 49900 }),
    );
  });

  it('refuses a client-supplied amount (strict schema)', async () => {
    const { status } = await call({ planId: 'starter', amountCents: 1 });
    expect(status).toBe(400);
    expect(initiateCheckout).not.toHaveBeenCalled();
  });
});

describe('POST /billing/plan launch gate', () => {
  it.each([undefined, 'false', ''])('refuses to start a checkout when CHECKOUT_ENABLED is %j', async (v) => {
    if (v === undefined) delete process.env['CHECKOUT_ENABLED'];
    else process.env['CHECKOUT_ENABLED'] = v;
    const { status, json } = await call({ planId: 'starter' });
    expect(status).toBe(503);
    expect(json.error.code).toBe('CHECKOUT_DISABLED');
    expect(initiateCheckout).not.toHaveBeenCalled();
    expect(store.createCheckoutIntent).not.toHaveBeenCalled();
    expect(vouchers.resolveVoucher).not.toHaveBeenCalled();
  });
});
