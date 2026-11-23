import { describe, expect, it } from 'vitest';
import { matchesFilter, matchesSearch, planOf, sellerIdOf, type CustomerRow } from '../lib/customers';
import { statusAfterExempt } from '../lib/exempt';

const NOW = new Date('2026-11-23T10:00:00Z');

const row = (over: Partial<CustomerRow> = {}): CustomerRow => ({
  key: 't1',
  kind: 'tenant',
  tenantId: '7e22ed36-cf82-43ba-b194-8bd4cfab5166',
  sellerId: 'MOS-7E22ED',
  businessName: 'Thandi Home Goods',
  ownerUserId: 'u1',
  ownerName: 'Thandi Khumalo',
  ownerEmail: 'thandi@example.co.za',
  phone: '+27820001234',
  signedUpAt: '2026-11-21T10:00:00Z',
  plan: { kind: 'trial', label: 'Trial 6/15' },
  products: 6,
  account: 'active',
  teamSize: 1,
  ...over,
});

describe('plan label', () => {
  it('exempt wins over everything', () => {
    expect(planOf({ status: 'exempt' }, { planId: 'growth', status: 'active', currentPeriodEnd: '2027-01-01T00:00:00Z' }, 3, NOW)).toEqual({
      kind: 'exempt',
      label: 'Free unlimited',
    });
  });
  it('a running paid period shows the plan name', () => {
    expect(planOf({ status: 'subscribed' }, { planId: 'growth', status: 'active', currentPeriodEnd: '2026-12-22T00:00:00Z' }, 40, NOW)).toEqual({
      kind: 'paid',
      label: 'Growth',
      planId: 'growth',
    });
  });
  it('an ended paid period counts as trial again', () => {
    expect(planOf({ status: 'subscribed' }, { planId: 'growth', status: 'active', currentPeriodEnd: '2026-11-01T00:00:00Z' }, 20, NOW).label).toBe(
      'Trial 15/15',
    );
  });
  it('trial shows products against the 15 free', () => {
    expect(planOf(undefined, undefined, 6, NOW)).toEqual({ kind: 'trial', label: 'Trial 6/15' });
    expect(planOf(undefined, undefined, 0, NOW)).toEqual({ kind: 'not_started', label: 'Not started' });
  });
});

describe('filters and search', () => {
  it('filters', () => {
    expect(matchesFilter(row(), 'trial')).toBe(true);
    expect(matchesFilter(row(), 'paid')).toBe(false);
    expect(matchesFilter(row({ account: 'not_verified' }), 'not_verified')).toBe(true);
    expect(matchesFilter(row({ account: 'profile_incomplete' }), 'not_verified')).toBe(true);
    expect(matchesFilter(row({ account: 'disabled' }), 'disabled')).toBe(true);
    expect(matchesFilter(row({ plan: { kind: 'exempt', label: 'Free unlimited' } }), 'exempt')).toBe(true);
  });
  it('searches email, business, owner, seller id and phone digits', () => {
    for (const q of ['THANDI@', 'home goods', 'khumalo', 'mos-7e22', '082 000 1234', '0001234']) {
      expect(matchesSearch(row(), q)).toBe(true);
    }
    expect(matchesSearch(row(), 'sipho')).toBe(false);
    expect(matchesSearch(row(), '12')).toBe(false); // too few digits to match a phone
    expect(matchesSearch(row(), '   ')).toBe(true);
  });
  it('seller id matches the seller dashboard', () => {
    expect(sellerIdOf('7e22ed36-cf82-43ba-b194-8bd4cfab5166')).toBe('MOS-7E22ED');
  });
});

describe('removing a free unlimited account', () => {
  it('goes back to paying while a paid period is running', () => {
    expect(statusAfterExempt({ planId: 'growth', status: 'active', currentPeriodEnd: '2026-12-22T00:00:00Z' }, 1000, NOW)).toEqual({
      status: 'subscribed',
      subscribedUntil: '2026-12-22T00:00:00Z',
      monthlyProductLimit: 1000,
    });
  });
  it('otherwise goes back to the free trial', () => {
    expect(statusAfterExempt(undefined, undefined, NOW)).toEqual({ status: 'active' });
    expect(statusAfterExempt({ planId: 'growth', status: 'active', currentPeriodEnd: '2026-11-01T00:00:00Z' }, 1000, NOW)).toEqual({
      status: 'active',
    });
  });
});
