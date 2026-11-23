import { describe, expect, it } from 'vitest';
import { candidateCode, normaliseCode } from '../lib/referral-code';
import { atExpression, dueDate } from '../lib/schedule';
import { TOKEN_TTL_SECONDS, issueToken, verifyToken } from '../lib/tokens';
import { firstNameOf, shortName } from '../lib/accounts';

const SECRET = 'test-secret-value';
const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';

describe('signed email links', () => {
  it('round-trips', () => {
    const token = issueToken('review', TENANT, SECRET);
    expect(verifyToken('review', token, SECRET)).toEqual({ ok: true, tenantId: TENANT });
  });

  it('cannot be used for another purpose', () => {
    const token = issueToken('review', TENANT, SECRET);
    expect(verifyToken('unsubscribe', token, SECRET).ok).toBe(false);
  });

  it('rejects tampering and other secrets', () => {
    const token = issueToken('unsubscribe', TENANT, SECRET);
    const other = token.replace(TENANT, '11111111-cf82-43ba-b194-8bd4cfab5166');
    expect(verifyToken('unsubscribe', other, SECRET).ok).toBe(false);
    expect(verifyToken('unsubscribe', token, 'other-secret').ok).toBe(false);
    expect(verifyToken('unsubscribe', undefined, SECRET).ok).toBe(false);
    expect(verifyToken('unsubscribe', 'a.b.c', SECRET).ok).toBe(false);
  });

  it('expires', () => {
    const issuedAt = Date.UTC(2026, 0, 1);
    const token = issueToken('review', TENANT, SECRET, issuedAt);
    const later = issuedAt + (TOKEN_TTL_SECONDS.review + 1) * 1000;
    expect(verifyToken('review', token, SECRET, later)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('referral codes', () => {
  it('uses the first name plus two safe characters', () => {
    expect(candidateCode('Thandi')).toMatch(/^THANDI[A-HJ-NP-Z2-9]{2}$/);
    expect(candidateCode('Zoë-Anne')).toMatch(/^ZOEANN[A-Z2-9]{2}$/);
    expect(candidateCode(undefined)).toMatch(/^SELLER[A-Z2-9]{2}$/);
    expect(candidateCode('Al', 3)).toMatch(/^AL[A-Z2-9]{5}$/);
  });

  it('normalises codes from links', () => {
    expect(normaliseCode(' thandi7k ')).toBe('THANDI7K');
    expect(normaliseCode('x')).toBeNull();
    expect(normaliseCode('<script>')).toBeNull();
    expect(normaliseCode(42)).toBeNull();
  });
});

describe('schedule timing', () => {
  const signUp = new Date('2026-11-21T22:15:00Z');

  it('sends emails at 9am South African time on the due day', () => {
    expect(dueDate('tips', signUp).toISOString()).toBe('2026-11-23T07:00:00.000Z');
    expect(dueDate('training', signUp).toISOString()).toBe('2026-11-26T07:00:00.000Z');
    expect(dueDate('review', signUp).toISOString()).toBe('2026-12-21T07:00:00.000Z');
    expect(dueDate('referral', signUp).toISOString()).toBe('2026-12-26T07:00:00.000Z');
  });

  it('checks a referral exactly 14 days after the payment', () => {
    expect(dueDate('qualify', signUp).toISOString()).toBe('2026-12-05T22:15:00.000Z');
  });

  it('formats the Scheduler at() expression', () => {
    expect(atExpression(new Date('2026-11-23T07:00:00.000Z'))).toBe('at(2026-11-23T07:00:00)');
  });
});

describe('names', () => {
  it('first names and short names', () => {
    expect(firstNameOf('thandi khumalo')).toBe('Thandi');
    expect(firstNameOf('')).toBeUndefined();
    expect(firstNameOf('<b>')).toBeUndefined();
    expect(shortName('Thandi Khumalo')).toBe('Thandi K.');
    expect(shortName('Sipho')).toBe('Sipho');
  });
});
