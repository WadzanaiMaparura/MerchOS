import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/subscription-store', () => ({
  getSubscription: vi.fn(async () => null),
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
  process.env['APP_BASE_URL'] = 'https://merchos.co.za';
  process.env['ALLOWED_RETURN_ORIGINS'] = 'https://merchos.co.za,http://localhost:3000';
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

describe('POST /billing/plan return URLs (no open redirect via PayFast)', () => {
  it('accepts return/cancel URLs on the dashboard origin', async () => {
    const { status } = await call({
      planId: 'starter',
      returnUrl: 'https://merchos.co.za/billing?checkout=success',
      cancelUrl: 'http://localhost:3000/billing?checkout=cancelled',
    });
    expect(status).toBe(200);
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      returnUrl: 'https://merchos.co.za/billing?checkout=success',
    }));
  });

  it('defaults to the dashboard billing page when none are sent', async () => {
    await call({ planId: 'starter' });
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      returnUrl: 'https://merchos.co.za/billing?checkout=success',
      cancelUrl: 'https://merchos.co.za/billing?checkout=cancelled',
    }));
  });

  it.each([
    ['another site', 'https://evil.example/phish'],
    ['a look-alike subdomain', 'https://merchos.co.za.evil.example/x'],
    ['userinfo trickery', 'https://merchos.co.za@evil.example/x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['the right host over another port', 'https://merchos.co.za:8443/billing'],
  ])('refuses %s and starts no checkout', async (_label, url) => {
    const { status, json } = await call({ planId: 'starter', returnUrl: url });
    expect(status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(initiateCheckout).not.toHaveBeenCalled();
    expect(store.createCheckoutIntent).not.toHaveBeenCalled();
  });

  it('also checks the cancel URL', async () => {
    const { status } = await call({ planId: 'starter', cancelUrl: 'https://evil.example/' });
    expect(status).toBe(400);
    expect(initiateCheckout).not.toHaveBeenCalled();
  });
});

describe('POST /billing/plan comeback offer (50% off the first month back)', () => {
  const lapsed = (over: Record<string, unknown> = {}) =>
    ({
      tenantId: 'tenant-1',
      planId: 'growth',
      status: 'active',
      provider: 'payfast',
      // Paid until 95 days ago: inside the 14-day window that opens on day 90.
      currentPeriodEnd: new Date(Date.now() - 95 * 86_400_000).toISOString(),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...over,
    }) as never;

  beforeEach(() => {
    process.env['BILLING_LIFECYCLE'] = 'true';
  });

  it('is applied automatically in the window, and recorded on the intent', async () => {
    vi.mocked(store.getSubscription).mockResolvedValue(lapsed());
    const { status } = await call({ planId: 'growth' });
    expect(status).toBe(200);
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 44950 }));
    expect(store.createCheckoutIntent).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ priceZARCents: 44950, listPriceCents: 89900, discountCents: 44950, offer: 'comeback' }),
    );
  });

  it('is not applied once used, outside the window, or while switched off', async () => {
    for (const [sub, flag] of [
      [lapsed({ comebackUsedAt: '2026-05-01T00:00:00.000Z' }), 'true'],
      [lapsed({ currentPeriodEnd: new Date(Date.now() - 60 * 86_400_000).toISOString() }), 'true'],
      [lapsed(), 'false'],
    ] as const) {
      vi.clearAllMocks();
      process.env['BILLING_LIFECYCLE'] = flag;
      vi.mocked(store.getSubscription).mockResolvedValue(sub);
      await call({ planId: 'growth' });
      expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 89900 }));
    }
  });

  it('a voucher typed in takes the place of the comeback offer', async () => {
    vi.mocked(store.getSubscription).mockResolvedValue(lapsed());
    vi.mocked(vouchers.resolveVoucher).mockResolvedValue({ voucherCode: 'V', listPriceCents: 89900, discountCents: 10000, finalCents: 79900 });
    await call({ planId: 'growth', voucherCode: 'V' });
    expect(initiateCheckout).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 79900 }));
    expect(store.createCheckoutIntent).toHaveBeenCalledWith('tenant-1', expect.not.objectContaining({ offer: 'comeback' }));
  });
});
