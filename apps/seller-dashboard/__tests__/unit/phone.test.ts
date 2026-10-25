import { describe, it, expect } from 'vitest';
import { isValidInternationalPhone, normalizeToE164 } from '@/app/(dashboard)/lib/phone';

/**
 * Finding 3 regression coverage: international phone validation + E.164
 * normalisation, now backed by libphonenumber-js metadata.
 *
 * Covers a South African number, numbers from several other countries, E.164
 * normalisation, formatted input (spaces/parentheses/hyphens), and a range of
 * invalid cases that the library's metadata actually rejects. No country code
 * is ever inferred; invalid input is rejected (false / null), never repaired.
 */
describe('international phone handling (libphonenumber-js)', () => {
  describe('valid South African numbers', () => {
    it('accepts and normalises a formatted SA mobile number to E.164', () => {
      expect(isValidInternationalPhone('+27 82 123 4567')).toBe(true);
      expect(normalizeToE164('+27 82 123 4567')).toBe('+27821234567');
    });

    it('accepts an SA number with parentheses/hyphens', () => {
      expect(isValidInternationalPhone('+27 (82) 123-4567')).toBe(true);
      expect(normalizeToE164('+27 (82) 123-4567')).toBe('+27821234567');
    });
  });

  describe('valid numbers from other countries', () => {
    it('accepts and normalises a UK mobile number', () => {
      expect(isValidInternationalPhone('+44 7400 123456')).toBe(true);
      expect(normalizeToE164('+44 7400 123456')).toBe('+447400123456');
    });

    it('accepts and normalises a US number', () => {
      expect(isValidInternationalPhone('+1 202 555 0191')).toBe(true);
      expect(normalizeToE164('+1 (202) 555-0191')).toBe('+12025550191');
    });

    it('accepts an Australian mobile number', () => {
      expect(isValidInternationalPhone('+61 412 345 678')).toBe(true);
      expect(normalizeToE164('+61 412 345 678')).toBe('+61412345678');
    });

    it('accepts an already-compact E.164 number', () => {
      expect(isValidInternationalPhone('+27821234567')).toBe(true);
      expect(normalizeToE164('+27821234567')).toBe('+27821234567');
    });
  });

  describe('invalid input is rejected (never repaired, no country code invented)', () => {
    it('rejects a number without a country code (no leading +)', () => {
      expect(isValidInternationalPhone('0821234567')).toBe(false);
      expect(normalizeToE164('0821234567')).toBeNull();
      // A bare national number must NOT be promoted to any country.
      expect(normalizeToE164('82 123 4567')).toBeNull();
    });

    it('rejects empty / whitespace input', () => {
      expect(isValidInternationalPhone('')).toBe(false);
      expect(isValidInternationalPhone('   ')).toBe(false);
      expect(normalizeToE164('')).toBeNull();
    });

    it('rejects input containing letters, extensions or malformed text', () => {
      expect(isValidInternationalPhone('+27 82 CALL ME')).toBe(false);
      expect(isValidInternationalPhone('+1 202 555 0191 ext 99')).toBe(false);
      expect(normalizeToE164('+27abc')).toBeNull();
    });

    it('rejects numbers that are too short for their country', () => {
      expect(isValidInternationalPhone('+2712')).toBe(false);
      expect(normalizeToE164('+2712')).toBeNull();
    });

    it('rejects numbers that are too long', () => {
      expect(isValidInternationalPhone('+27821234567890123')).toBe(false);
      expect(normalizeToE164('+27821234567890123')).toBeNull();
    });

    it('rejects an unassigned / invalid country calling code', () => {
      // +999 is not an assigned country calling code.
      expect(isValidInternationalPhone('+999 1234 5678')).toBe(false);
      expect(normalizeToE164('+999 1234 5678')).toBeNull();
    });

    it('rejects a number whose national part is invalid for a real country code', () => {
      // Valid US calling code (+1) but an impossible national number.
      expect(isValidInternationalPhone('+1 000 000 0000')).toBe(false);
      expect(normalizeToE164('+1 000 000 0000')).toBeNull();
    });

    it('normalised output satisfies the backend phone contract (chars + length)', () => {
      const normalised = normalizeToE164('+27 82 123 4567');
      expect(normalised).not.toBeNull();
      // Backend completeProfileSchema: /^[+()\-\s0-9]+$/, min 5, max 20.
      expect(normalised!).toMatch(/^[+()\-\s0-9]+$/);
      expect(normalised!.length).toBeGreaterThanOrEqual(5);
      expect(normalised!.length).toBeLessThanOrEqual(20);
    });
  });
});
