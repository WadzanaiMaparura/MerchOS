import { describe, expect, it, vi } from 'vitest';
import {
  firstRecurringDate,
  planChangeKind,
  planForRenewal,
  renewalPeriod,
  sastDate,
  upgradeQuote,
} from '../../services/card-billing';
import { PayFastProvider, computeSignature } from '../../providers/payfast';
import { PayFastSubscriptionsApi, apiSignature, cardUpdateUrl } from '../../providers/payfast-subscriptions';

const growth = { planId: 'growth', priceCents: 89900, periodStart: '2026-12-01T10:00:00.000Z', periodEnd: '2026-12-31T10:00:00.000Z' };

describe('plan changes on automatic billing', () => {
  it('classifies subscribe, same, upgrade and downgrade', () => {
    const now = new Date('2026-12-11T10:00:00.000Z');
    expect(planChangeKind(null, 'growth', 89900, now)).toBe('subscribe');
    expect(planChangeKind({ ...growth, periodEnd: '2026-12-10T00:00:00.000Z' }, 'professional', 179000, now)).toBe('subscribe');
    expect(planChangeKind(growth, 'growth', 89900, now)).toBe('same');
    expect(planChangeKind(growth, 'professional', 179000, now)).toBe('upgrade');
    expect(planChangeKind(growth, 'starter', 49900, now)).toBe('downgrade');
  });

  it('upgrade on day 11 of 30: R1,790 minus 20 unused days of R899 (R599.33) = R1,190.67, no free upgrade', () => {
    const q = upgradeQuote(growth, 179000, new Date('2026-12-11T10:00:00.000Z'));
    expect(q).toEqual({ creditCents: 59933, chargeCents: 119067, unusedDays: 20 });
  });

  it('upgrade on the last minute costs almost the full new price; never below R5', () => {
    // 1 minute of a 30-day R899 month = R0.02 credit.
    expect(upgradeQuote(growth, 179000, new Date('2026-12-31T09:59:00.000Z')).chargeCents).toBe(178998);
    expect(upgradeQuote({ ...growth, priceCents: 179000 }, 179100, new Date('2026-12-01T10:00:00.000Z')).chargeCents).toBe(500);
  });

  it('first automatic charge one month after the paid month starts (SA date)', () => {
    expect(firstRecurringDate('2026-12-22T10:00:00.000Z')).toBe('2027-01-22');
    // 23:30 UTC on the 21st is already the 22nd in South Africa.
    expect(sastDate(new Date('2026-12-21T23:30:00.000Z'))).toBe('2026-12-22');
  });

  it('a monthly charge continues from the current end, or starts now after a failed month', () => {
    expect(renewalPeriod('2026-12-31T10:00:00.000Z', new Date('2026-12-31T04:00:00.000Z'))).toEqual({
      start: '2026-12-31T10:00:00.000Z',
      end: '2027-01-31T10:00:00.000Z',
    });
    expect(renewalPeriod('2026-12-31T10:00:00.000Z', new Date('2027-01-05T08:00:00.000Z')).start).toBe('2027-01-05T08:00:00.000Z');
  });

  it('a downgrade switches plan at the charge that matches its price', () => {
    const priceOf = (id: string) => ({ starter: 49900, growth: 89900, professional: 179000 } as Record<string, number>)[id] ?? null;
    expect(planForRenewal({ planId: 'professional', nextPlanId: 'growth' }, 89900, priceOf)).toBe('growth');
    expect(planForRenewal({ planId: 'professional', nextPlanId: 'growth' }, 179000, priceOf)).toBe('professional');
    expect(planForRenewal({ planId: 'growth' }, 12345, priceOf)).toBeNull();
  });
});

describe('PayFast card subscription checkout', () => {
  const config = { merchantId: '10000100', merchantKey: '46f0cd694581a', passphrase: 'pass phrase', mode: 'sandbox' as const, notifyUrl: 'https://api.example/itn' };

  it('adds the recurring fields last, signed in order; once-off payments leave them out', async () => {
    const p = new PayFastProvider(config);
    const sub = await p.initiateCheckout({
      tenantId: 't1', planId: 'growth', returnUrl: 'https://merchos.co.za/billing', cancelUrl: 'https://merchos.co.za/billing',
      amountCents: 119067, recurring: { recurringAmountCents: 179000, billingDate: '2027-01-11' },
    });
    const q = new URL(sub.redirectUrl).searchParams;
    expect([...q.keys()].slice(-6)).toEqual(['subscription_type', 'billing_date', 'recurring_amount', 'frequency', 'cycles', 'signature']);
    expect(q.get('amount')).toBe('1190.67');
    expect(q.get('recurring_amount')).toBe('1790.00');
    expect(q.get('frequency')).toBe('3');
    expect(q.get('cycles')).toBe('0');
    const pairs = [...q.entries()].filter(([k]) => k !== 'signature') as Array<[string, string]>;
    expect(q.get('signature')).toBe(computeSignature(pairs, 'pass phrase'));

    const once = await p.initiateCheckout({ tenantId: 't1', planId: 'growth', returnUrl: 'https://merchos.co.za/b', cancelUrl: 'https://merchos.co.za/b' });
    expect(new URL(once.redirectUrl).searchParams.has('subscription_type')).toBe(false);
  });

  it('rejects a malformed billing date', async () => {
    await expect(
      new PayFastProvider(config).initiateCheckout({
        tenantId: 't1', planId: 'growth', returnUrl: 'https://x/b', cancelUrl: 'https://x/b', recurring: { recurringAmountCents: 1, billingDate: '22/01/2027' },
      }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('PayFast subscriptions API', () => {
  const config = { merchantId: '10000100', merchantKey: 'k', passphrase: 'secret', mode: 'sandbox' as const, notifyUrl: '' };
  const TOKEN = '2afa4575-5628-051a-d0ed-4e071b56a7b0';

  it('signs header + body variables sorted alphabetically with the passphrase', () => {
    const sig = apiSignature({ version: 'v1', 'merchant-id': '10000100', timestamp: '2026-12-01T10:00:00+00:00', amount: '89900' }, 'secret');
    // amount, merchant-id, passphrase, timestamp, version (alphabetical)
    const expected = require('node:crypto')
      .createHash('md5')
      .update('amount=89900&merchant-id=10000100&passphrase=secret&timestamp=2026-12-01T10%3A00%3A00%2B00%3A00&version=v1')
      .digest('hex');
    expect(sig).toBe(expected);
  });

  it('cancel and update call the right endpoints (sandbox adds testing=true); failures throw without details', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 200 }));
    const api = new PayFastSubscriptionsApi(config, fetchFn as never, () => new Date('2026-12-01T10:00:00.123Z'));
    await api.cancel(TOKEN);
    await api.updateAmount(TOKEN, 49900);
    expect(fetchFn.mock.calls[0]![0]).toBe(`https://api.payfast.co.za/subscriptions/${TOKEN}/cancel?testing=true`);
    expect((fetchFn.mock.calls[0]![1] as RequestInit).method).toBe('PUT');
    expect(fetchFn.mock.calls[1]![0]).toBe(`https://api.payfast.co.za/subscriptions/${TOKEN}/update?testing=true`);
    expect((fetchFn.mock.calls[1]![1] as RequestInit).body).toBe('{"amount":"49900"}');
    const headers = (fetchFn.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['timestamp']).toBe('2026-12-01T10:00:00+00:00');
    expect(headers['signature']).toMatch(/^[a-f0-9]{32}$/);

    const failing = new PayFastSubscriptionsApi(config, (async () => new Response('card 4111...', { status: 400 })) as never);
    await expect(failing.cancel(TOKEN)).rejects.toThrow('PayFast subscriptions cancel failed (400)');
    await expect(api.cancel('not-a-token')).rejects.toThrow('Invalid subscription token');
  });

  it('builds the hosted update-card link', () => {
    expect(cardUpdateUrl('live', TOKEN, 'https://merchos.co.za/billing?card=updated')).toBe(
      `https://www.payfast.co.za/eng/recurring/update/${TOKEN}?return=https%3A%2F%2Fmerchos.co.za%2Fbilling%3Fcard%3Dupdated`,
    );
    expect(cardUpdateUrl('live', '../x', 'https://merchos.co.za')).toBeNull();
  });
});
