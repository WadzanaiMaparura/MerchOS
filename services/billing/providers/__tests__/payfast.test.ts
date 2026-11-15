import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
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
