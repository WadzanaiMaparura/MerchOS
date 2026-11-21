import { describe, it, expect, vi } from 'vitest';
import {
  claimKeys,
  normaliseEmail,
  normaliseOrganisation,
  normalisePhone,
  recordClaims,
} from '../../registration/identity-claims';

describe('identity normalisation (one free trial per seller)', () => {
  it.each([
    ['Seller@Example.com ', 'seller@example.com'],
    ['seller+trial2@example.com', 'seller@example.com'],
    ['J.O.H.N.Doe+x@gmail.com', 'johndoe@gmail.com'],
    ['johndoe@googlemail.com', 'johndoe@gmail.com'],
    // Dots matter outside Gmail.
    ['j.doe@company.co.za', 'j.doe@company.co.za'],
  ])('email %s -> %s', (raw, expected) => expect(normaliseEmail(raw)).toBe(expected));

  it.each([
    ['+27 83 123 4567', '+27831234567'],
    ['+27-(83)-123-4567', '+27831234567'],
  ])('phone %s -> %s', (raw, expected) => expect(normalisePhone(raw)).toBe(expected));

  it.each([
    ['Acme Trading (Pty) Ltd', 'acme'],
    ['ACME', 'acme'],
    ['  Acme   Pty Ltd. ', 'acme'],
    ['Café & Co CC', 'cafe and'],
    ['Smith Holdings t/a Smith Shoes', 'smith'],
    ['Blue Ocean Retail', 'blue ocean retail'],
  ])('business %s -> %s', (raw, expected) => expect(normaliseOrganisation(raw)).toBe(expected));

  it('does not reserve names too short to identify a business', () => {
    const kinds = claimKeys({ email: 'a@b.co', phoneNumber: '+27831234567', organisationName: 'AB Ltd' }).map((k) => k.kind);
    expect(kinds).toEqual(['EMAIL', 'PHONE']);
  });
});

describe('recordClaims', () => {
  it('writes create-only claims and reports ones held by another tenant', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('held'), { name: 'ConditionalCheckFailedException' }))
      .mockResolvedValueOnce({});
    const res = await recordClaims({ send } as never, 'tenants', 't-1', {
      email: 'x@example.com', phoneNumber: '+27831234567', organisationName: 'Blue Ocean',
    });
    expect(res.conflicts).toEqual(['PHONE']);
    const first = send.mock.calls[0]![0].input;
    expect(first.Item).toMatchObject({ PK: 'CLAIM#EMAIL#x@example.com', SK: 'CLAIM', tenantId: 't-1' });
    // A retry by the same tenant is not a conflict.
    expect(first.ConditionExpression).toBe('attribute_not_exists(PK) OR tenantId = :tid');
  });

  it('propagates unexpected errors', async () => {
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(recordClaims({ send } as never, 't', 't-1', { email: 'x@y.com', phoneNumber: '', organisationName: '' }))
      .rejects.toThrow('boom');
  });
});
