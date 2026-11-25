import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/subscription-store', () => ({
  getSubscription: vi.fn(),
  updateCardSubscription: vi.fn(async () => true),
}));
vi.mock('../../../shared/entitlements/trial-gate', () => ({ setAutoRenew: vi.fn(async () => undefined) }));
vi.mock('../../../shared/middleware/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), addContext: vi.fn() },
}));

import { handler, setCancelSubscriptionsApi } from '../handlers/cancel-subscription';
import * as store from '../../services/subscription-store';
import { setAutoRenew } from '../../../shared/entitlements/trial-gate';

const ISS = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
process.env['COGNITO_ISSUER'] = ISS;
const TOKEN = '2afa4575-5628-051a-d0ed-4e071b56a7b0';
const api = { cancel: vi.fn(async () => undefined), updateAmount: vi.fn() };

const call = async () => {
  const res = (await (handler as unknown as (e: unknown, c: unknown) => Promise<{ statusCode: number; body: string }>)(
    {
      version: '2.0',
      routeKey: 'POST /billing/subscription/cancel',
      headers: {},
      requestContext: {
        http: { method: 'POST', path: '/billing/subscription/cancel' },
        authorizer: {
          jwt: {
            claims: {
              sub: 'u-1', iss: ISS, exp: Math.floor(Date.now() / 1000) + 600,
              'cognito:groups': ['Seller'], 'custom:tenantId': 'tenant-1', token_use: 'access',
            },
          },
        },
      },
      isBase64Encoded: false,
    },
    {},
  ));
  return { status: res.statusCode, json: JSON.parse(res.body) };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['CARD_SUBSCRIPTIONS'] = 'true';
  setCancelSubscriptionsApi(api);
});

describe('POST /billing/subscription/cancel', () => {
  it('stops the card charges at PayFast; the paid month runs to its end', async () => {
    vi.mocked(store.getSubscription).mockResolvedValue({ autoRenew: true, payfastToken: TOKEN, currentPeriodEnd: '2026-12-22T10:00:00.000Z' } as never);
    const { status, json } = await call();
    expect(status).toBe(200);
    expect(json).toEqual({ cancelled: true, paidUntil: '2026-12-22T10:00:00.000Z' });
    expect(api.cancel).toHaveBeenCalledWith(TOKEN);
    expect(store.updateCardSubscription).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ autoRenew: false, nextPlanId: null }), TOKEN);
    expect(setAutoRenew).toHaveBeenCalledWith('tenant-1', false);
  });

  it('refuses when automatic billing is not on, and while the switch is off', async () => {
    vi.mocked(store.getSubscription).mockResolvedValue({ autoRenew: false } as never);
    expect((await call()).status).toBe(409);
    process.env['CARD_SUBSCRIPTIONS'] = 'false';
    expect((await call()).status).toBe(503);
    expect(api.cancel).not.toHaveBeenCalled();
  });

  it('a PayFast failure leaves our record unchanged', async () => {
    vi.mocked(store.getSubscription).mockResolvedValue({ autoRenew: true, payfastToken: TOKEN } as never);
    api.cancel.mockRejectedValueOnce(new Error('PayFast subscriptions cancel failed (500)'));
    expect((await call()).status).toBe(500);
    expect(store.updateCardSubscription).not.toHaveBeenCalled();
  });
});
