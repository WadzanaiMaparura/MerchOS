import { describe, it, expect } from 'vitest';
import { completeProfileSchema } from '../../schemas';

/**
 * Direct tests of the REAL completeProfileSchema zod schema (no handler, no
 * mocked validation middleware). These prove the schema itself enforces the
 * contract that the handler relies on.
 */
describe('completeProfileSchema', () => {
  const base = { fullName: 'Owner One', phone: '+27 123 456 789', organisationName: 'Acme Trading' };

  it('accepts valid data with consent omitted (defaults to not granted, no channels)', () => {
    const r = completeProfileSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.consentGranted).toBe(false);
      expect(r.data.consentChannels).toEqual([]);
    }
  });

  it('accepts valid data with consent explicitly unchecked', () => {
    const r = completeProfileSchema.safeParse({ ...base, consentGranted: false, consentChannels: [] });
    expect(r.success).toBe(true);
  });

  it('accepts explicit opt-in with permitted channels', () => {
    const r = completeProfileSchema.safeParse({
      ...base,
      consentGranted: true,
      consentChannels: ['email', 'sms'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.consentChannels).toEqual(['email', 'sms']);
  });

  it('rejects consent channels when consent is NOT granted', () => {
    const r = completeProfileSchema.safeParse({
      ...base,
      consentGranted: false,
      consentChannels: ['email'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an unexpected tenantId field (strict)', () => {
    const r = completeProfileSchema.safeParse({ ...base, tenantId: 'ATTACKER-TENANT' });
    expect(r.success).toBe(false);
  });

  it('rejects an unexpected role field (strict)', () => {
    const r = completeProfileSchema.safeParse({ ...base, role: 'owner' });
    expect(r.success).toBe(false);
  });

  it('rejects an unexpected email field (strict)', () => {
    const r = completeProfileSchema.safeParse({ ...base, email: 'attacker@example.com' });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid channel value', () => {
    const r = completeProfileSchema.safeParse({
      ...base,
      consentGranted: true,
      consentChannels: ['whatsapp'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects an invalid phone (bad characters)', () => {
    const r = completeProfileSchema.safeParse({ ...base, phone: '12345abc!!' });
    expect(r.success).toBe(false);
  });

  it('rejects a missing/empty full name', () => {
    const r = completeProfileSchema.safeParse({ ...base, fullName: '' });
    expect(r.success).toBe(false);
  });

  it('rejects an organisation name shorter than 2 characters', () => {
    const r = completeProfileSchema.safeParse({ ...base, organisationName: 'A' });
    expect(r.success).toBe(false);
  });

  it('rejects an over-long full name (>100)', () => {
    const r = completeProfileSchema.safeParse({ ...base, fullName: 'x'.repeat(101) });
    expect(r.success).toBe(false);
  });
});
