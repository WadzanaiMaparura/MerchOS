import { describe, it, expect } from 'vitest';
import { isValidInternationalPhone, normalizeToE164 } from '@/app/(dashboard)/lib/phone';

/**
 * Finding 3 regression coverage: international phone validation + E.164
 * normalisation. Covers a South African number, at least one non-SA number,
 * and invalid input. No country code is ever invented; invalid input is
 * rejected (returns false / null) and never silently rewritten.
 */
describe('international phone handling', () => {
  describe('valid South African numbers', () => {
    it('accepts and normalises a formatted SA number to E.164', () => {
      expect(isValidInternationalPhone('+27 71 234 5678')).toBe(true);
      expect(normalizeToE164('+27 71 234 5678')).toBe('+27712345678');
    });

    it('accepts an SA number with parentheses/hyphens', () => {
      expect(isValidInternationalPhone('+27 (71) 234-5678')).toBe(true);
      expect(normalizeToE164('+27 (71) 234-5678')).toBe('+27712345678');
    });
  });

  describe('valid non-South-African numbers', () => {
    it('accepts and normalises a UK number', () => {
      expect(isValidInternationalPhone('+44 20 7946 0958')).toBe(true);
      expect(normalizeToE164('+44 20 7946 0958')).toBe('+442079460958');
    });

    it('accepts a US number', () => {
      expect(isValidInternationalPhone('+1 (415) 555-0132')).toBe(true);
      expect(normalizeToE164('+1 (415) 555-0132')).toBe('+14155550132');
    });

    it('accepts an already-compact E.164 number', () => {
      expect(isValidInternationalPhone('+919812345678')).toBe(true);
      expect(normalizeToE164('+919812345678')).toBe('+919812345678');
    });
  });

  describe('invalid input is rejected (never rewritten, no country code invented)', () => {
    it('rejects a number without a country code (no leading +)', () => {
      expect(isValidInternationalPhone('0712345678')).toBe(false);
      expect(normalizeToE164('0712345678')).toBeNull();
    });

    it('rejects empty / whitespace input', () => {
      expect(isValidInternationalPhone('')).toBe(false);
      expect(isValidInternationalPhone('   ')).toBe(false);
      expect(normalizeToE164('')).toBeNull();
    });

    it('rejects input with letters or illegal characters', () => {
      expect(isValidInternationalPhone('+27 71 CALL ME')).toBe(false);
      expect(isValidInternationalPhone('+27-71-234-5678 ext 9')).toBe(false);
      expect(normalizeToE164('+27abc')).toBeNull();
    });

    it('rejects too few digits', () => {
      expect(isValidInternationalPhone('+271234')).toBe(false);
      expect(normalizeToE164('+271234')).toBeNull();
    });

    it('rejects too many digits (> 15)', () => {
      expect(isValidInternationalPhone('+2712345678901234')).toBe(false);
      expect(normalizeToE164('+2712345678901234')).toBeNull();
    });

    it('rejects a country code starting with 0', () => {
      expect(isValidInternationalPhone('+0712345678')).toBe(false);
    });

    it('rejects a misplaced or duplicated +', () => {
      expect(isValidInternationalPhone('27+712345678')).toBe(false);
      expect(isValidInternationalPhone('++27712345678')).toBe(false);
    });

    it('normalised output satisfies the backend phone contract (chars + length)', () => {
      const normalised = normalizeToE164('+27 71 234 5678');
      expect(normalised).not.toBeNull();
      // Backend completeProfileSchema: /^[+()\-\s0-9]+$/, min 5, max 20.
      expect(normalised!).toMatch(/^[+()\-\s0-9]+$/);
      expect(normalised!.length).toBeGreaterThanOrEqual(5);
      expect(normalised!.length).toBeLessThanOrEqual(20);
    });
  });
});
