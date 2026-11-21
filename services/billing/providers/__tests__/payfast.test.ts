import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  computeItnSignature,
  payfastUrlEncode,
  buildSignatureString,
  computeSignature,
  parseUrlEncodedOrdered,
  decimalStringToCents,
} from '../payfast';

describe('payfastUrlEncode', () => {
  it('encodes spaces as + (PHP urlencode semantics)', () => {
    expect(payfastUrlEncode('Growth Plan')).toBe('Growth+Plan');
  });

  it('uppercases percent-encoded hex', () => {
    // '!' -> %21, not %21 lowercase; and not left raw like encodeURIComponent.
    expect(payfastUrlEncode('a!b')).toBe('a%21b');
  });

  it('percent-encodes reserved chars with uppercase hex', () => {
    expect(payfastUrlEncode('a@b.co')).toBe('a%40b.co');
  });
});

describe('buildSignatureString', () => {
  it('joins ordered pairs and skips empty values', () => {
    const str = buildSignatureString([
      ['merchant_id', '10000100'],
      ['amount', '499.00'],
      ['item_name', 'Starter'],
      ['empty', ''],
    ]);
    expect(str).toBe('merchant_id=10000100&amount=499.00&item_name=Starter');
  });

  it('appends an encoded passphrase when provided', () => {
    const str = buildSignatureString(
      [['merchant_id', '10000100']],
      'my secret'
    );
    expect(str).toBe('merchant_id=10000100&passphrase=my+secret');
  });

  it('omits passphrase when empty', () => {
    const str = buildSignatureString([['merchant_id', '10000100']], '');
    expect(str).toBe('merchant_id=10000100');
  });
});

describe('computeSignature', () => {
  it('produces a deterministic lowercase-hex md5 matching a hand-computed value', () => {
    const pairs: Array<[string, string]> = [
      ['merchant_id', '10000100'],
      ['amount', '499.00'],
      ['item_name', 'Starter Plan'],
    ];
    const expected = crypto
      .createHash('md5')
      .update('merchant_id=10000100&amount=499.00&item_name=Starter+Plan')
      .digest('hex');
    expect(computeSignature(pairs)).toBe(expected);
    // 32 hex chars
    expect(computeSignature(pairs)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('changes when the passphrase changes', () => {
    const pairs: Array<[string, string]> = [['merchant_id', '10000100']];
    expect(computeSignature(pairs, 'a')).not.toBe(computeSignature(pairs, 'b'));
  });
});

describe('parseUrlEncodedOrdered', () => {
  it('preserves POST order and decodes + and percent escapes', () => {
    const pairs = parseUrlEncodedOrdered('m_payment_id=abc&item_name=Growth+Plan&amount=999.00');
    expect(pairs).toEqual([
      ['m_payment_id', 'abc'],
      ['item_name', 'Growth Plan'],
      ['amount', '999.00'],
    ]);
  });

  it('returns empty for empty body', () => {
    expect(parseUrlEncodedOrdered('')).toEqual([]);
  });

  it('round-trips a signature: recomputing over posted fields (minus signature) matches', () => {
    const passphrase = 'test-pass';
    const fields: Array<[string, string]> = [
      ['m_payment_id', 'pay-1'],
      ['amount_gross', '499.00'],
      ['payment_status', 'COMPLETE'],
      ['custom_str1', 'tenant-123'],
    ];
    const sig = computeSignature(fields, passphrase);
    const body =
      fields.map(([k, v]) => `${k}=${payfastUrlEncode(v)}`).join('&') + `&signature=${sig}`;
    const parsed = parseUrlEncodedOrdered(body);
    const forSig = parsed.filter(([k]) => k !== 'signature');
    expect(computeSignature(forSig, passphrase)).toBe(sig);
  });
});

describe('decimalStringToCents', () => {
  it('parses whole and fractional amounts', () => {
    expect(decimalStringToCents('499.00')).toBe(49900);
    expect(decimalStringToCents('999')).toBe(99900);
    expect(decimalStringToCents('1999.50')).toBe(199950);
    expect(decimalStringToCents('0.05')).toBe(5);
  });

  it('returns undefined for malformed input', () => {
    expect(decimalStringToCents('abc')).toBeUndefined();
    expect(decimalStringToCents('')).toBeUndefined();
    expect(decimalStringToCents('1.234')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Adapter-level tests: field order, signature round-trip, ITN accept/reject
// ---------------------------------------------------------------------------

import { PayFastProvider } from '../payfast';

const TEST_CONFIG = {
  merchantId: '10000100',
  merchantKey: '46f0cd694581a',
  passphrase: 'unit-test-pass',
  mode: 'sandbox' as const,
  notifyUrl: 'https://api.example.com/billing/payfast/itn',
};

function queryPairs(redirectUrl: string): Array<[string, string]> {
  const qs = redirectUrl.split('?')[1] ?? '';
  return parseUrlEncodedOrdered(qs);
}

describe('PayFastProvider.initiateCheckout', () => {
  it('uses the sandbox process URL in sandbox mode', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.initiateCheckout({
      tenantId: 't-1',
      planId: 'starter',
      returnUrl: 'https://app/billing?checkout=success',
      cancelUrl: 'https://app/billing?checkout=cancelled',
    });
    expect(r.redirectUrl.startsWith('https://sandbox.payfast.co.za/eng/process?')).toBe(true);
  });

  it("places email_address BEFORE m_payment_id (PayFast's documented order)", async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.initiateCheckout({
      tenantId: 't-1',
      planId: 'growth',
      email: 'seller@example.com',
      returnUrl: 'https://app/r',
      cancelUrl: 'https://app/c',
    });
    const keys = queryPairs(r.redirectUrl).map(([k]) => k);
    expect(keys).toEqual([
      'merchant_id',
      'merchant_key',
      'return_url',
      'cancel_url',
      'notify_url',
      'email_address',
      'm_payment_id',
      'amount',
      'item_name',
      'custom_str1',
      'signature',
    ]);
  });

  it('omits email_address entirely when no email is known', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.initiateCheckout({
      tenantId: 't-1',
      planId: 'starter',
      returnUrl: 'https://app/r',
      cancelUrl: 'https://app/c',
    });
    const keys = queryPairs(r.redirectUrl).map(([k]) => k);
    expect(keys).not.toContain('email_address');
    expect(keys).toContain('m_payment_id');
  });

  it('produces a signature that verifies when recomputed over the posted fields', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.initiateCheckout({
      tenantId: 't-1',
      planId: 'professional',
      email: 'seller@example.com',
      returnUrl: 'https://app/r',
      cancelUrl: 'https://app/c',
    });
    const pairs = queryPairs(r.redirectUrl);
    const sig = pairs.find(([k]) => k === 'signature')?.[1];
    const without = pairs.filter(([k]) => k !== 'signature');
    expect(computeSignature(without, TEST_CONFIG.passphrase)).toBe(sig);
  });

  it('formats amount from integer cents and carries the tenant in custom_str1', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.initiateCheckout({
      tenantId: 'tenant-xyz',
      planId: 'growth',
      returnUrl: 'https://app/r',
      cancelUrl: 'https://app/c',
    });
    const map = Object.fromEntries(queryPairs(r.redirectUrl));
    expect(map['amount']).toBe('899.00'); // Growth launch price
    expect(map['custom_str1']).toBe('tenant-xyz');
    expect(map['m_payment_id']).toBe(r.mPaymentId);
  });

  it('refuses self-service checkout for the custom enterprise plan', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    await expect(
      p.initiateCheckout({
        tenantId: 't-1',
        planId: 'enterprise',
        returnUrl: 'https://app/r',
        cancelUrl: 'https://app/c',
      })
    ).rejects.toThrow(/no self-service price/);
  });
});

describe('PayFastProvider.verifyItn', () => {
  function signedItnBody(fields: Array<[string, string]>, passphrase: string): string {
    const sig = computeSignature(fields, passphrase);
    return (
      fields.map(([k, v]) => `${k}=${payfastUrlEncode(v)}`).join('&') + `&signature=${sig}`
    );
  }

  const fields: Array<[string, string]> = [
    ['m_payment_id', 'pay-123'],
    ['pf_payment_id', '1089250'],
    ['payment_status', 'COMPLETE'],
    ['item_name', 'Growth'],
    ['amount_gross', '999.00'],
    ['custom_str1', 'tenant-xyz'],
  ];

  it('accepts a correctly signed ITN and surfaces amount in cents', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.verifyItn(signedItnBody(fields, TEST_CONFIG.passphrase), {});
    expect(r.valid).toBe(true);
    expect(r.mPaymentId).toBe('pay-123');
    expect(r.paymentStatus).toBe('COMPLETE');
    expect(r.amountGrossCents).toBe(99900);
  });

  it('rejects an ITN whose amount was tampered with after signing', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const body = signedItnBody(fields, TEST_CONFIG.passphrase).replace(
      'amount_gross=999.00',
      'amount_gross=1.00'
    );
    const r = await p.verifyItn(body, {});
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('signature_mismatch');
  });

  it('rejects an ITN signed with the wrong passphrase', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.verifyItn(signedItnBody(fields, 'some-other-passphrase'), {});
    expect(r.valid).toBe(false);
  });

  it('accepts a real-world ITN that contains blank fields (signed over ALL posted fields)', async () => {
    const withBlanks: Array<[string, string]> = [
      ['m_payment_id', 'pay-9'],
      ['pf_payment_id', '2000001'],
      ['payment_status', 'COMPLETE'],
      ['item_name', 'Starter'],
      ['item_description', ''],
      ['amount_gross', '499.00'],
      ['custom_str1', 'tenant-xyz'],
      ['custom_str2', ''],
      ['name_first', ''],
      ['email_address', ''],
    ];
    const sig = computeItnSignature(withBlanks, TEST_CONFIG.passphrase);
    const body = withBlanks.map(([k, v]) => `${k}=${payfastUrlEncode(v)}`).join('&') + `&signature=${sig}`;
    const r = await new PayFastProvider(TEST_CONFIG).verifyItn(body, {});
    expect(r.valid).toBe(true);
    expect(r.amountGrossCents).toBe(49900);
  });

  it('rejects an ITN with no signature', async () => {
    const p = new PayFastProvider(TEST_CONFIG);
    const r = await p.verifyItn('m_payment_id=pay-123&payment_status=COMPLETE', {});
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing_signature');
  });
});
