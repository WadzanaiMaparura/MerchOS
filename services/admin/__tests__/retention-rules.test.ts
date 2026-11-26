import { describe, expect, it } from 'vitest';
import { ACTIVITY_TRACKED_FROM, plannedDeletion, retentionDecision } from '../lib/retention-rules';

const T = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const at = (iso: string) => new Date(iso);

describe('retention rules: paid, then stopped paying', () => {
  // Paid until 1 Jan 2027 -> closes 7 Feb 2027 -> deleted 7 Feb 2028.
  const paid = { status: 'subscribed', subscribedUntil: '2027-01-01T00:00:00.000Z' };

  it('nothing while paid, paused or within the 12 months after closing', () => {
    for (const now of ['2026-12-15', '2027-01-20', '2027-02-10', '2027-12-01']) {
      expect(retentionDecision({ tenantId: T, entitlement: paid }, at(`${now}T00:00:00Z`)).action).toBe('keep');
    }
  });

  it('warned 30 days before (from 7 Jan 2028), deleted on 7 Feb 2028 once warned', () => {
    expect(retentionDecision({ tenantId: T, entitlement: paid }, at('2028-01-06T23:00:00Z')).action).toBe('keep');
    expect(retentionDecision({ tenantId: T, entitlement: paid }, at('2028-01-07T01:00:00Z'))).toEqual({
      action: 'warn',
      reason: 'closed',
      deleteOn: '2028-02-07T00:00:00.000Z',
      since: '2027-02-07T00:00:00.000Z',
    });
    const warned = { tenantId: T, entitlement: paid, warnedAt: '2028-01-09T01:00:00.000Z' };
    expect(retentionDecision(warned, at('2028-02-06T00:00:00Z')).action).toBe('keep');
    expect(retentionDecision(warned, at('2028-02-08T02:00:00Z'))).toMatchObject({ action: 'delete', reason: 'closed' });
  });

  it('never deleted without a warning at least 30 days earlier (job switched on late)', () => {
    const late = at('2028-06-01T00:00:00Z');
    const d = retentionDecision({ tenantId: T, entitlement: paid }, late);
    expect(d).toMatchObject({ action: 'warn', deleteOn: '2028-07-01T00:00:00.000Z' });
    const warnedYesterday = { tenantId: T, entitlement: paid, warnedAt: '2028-05-31T00:00:00.000Z' };
    expect(retentionDecision(warnedYesterday, late).action).toBe('keep');
    expect(retentionDecision(warnedYesterday, at('2028-06-30T00:00:00Z')).action).toBe('delete');
  });

  it('paying again resets everything', () => {
    const again = { status: 'subscribed', subscribedUntil: '2028-03-01T00:00:00.000Z' };
    expect(retentionDecision({ tenantId: T, entitlement: again, warnedAt: '2028-01-09T00:00:00Z' }, at('2028-02-08T00:00:00Z')).action).toBe('keep');
  });
});

describe('retention rules: never paid', () => {
  it('12 months after the last use, warned 30 days before', () => {
    const i = { tenantId: T, entitlement: { status: 'active' }, lastActiveAt: '2027-03-10T09:00:00.000Z', createdAt: '2027-01-01T00:00:00Z' };
    expect(retentionDecision(i, at('2028-02-01T00:00:00Z')).action).toBe('keep');
    expect(retentionDecision(i, at('2028-02-08T10:00:00Z'))).toMatchObject({
      action: 'warn',
      reason: 'inactive',
      deleteOn: '2028-03-10T09:00:00.000Z',
      since: '2027-03-10T09:00:00.000Z',
    });
    expect(retentionDecision({ ...i, warnedAt: '2028-02-10T10:00:00Z' }, at('2028-03-12T00:00:00Z')).action).toBe('delete');
  });

  it('signing in again resets it', () => {
    const i = { tenantId: T, lastActiveAt: '2028-02-20T00:00:00.000Z', createdAt: '2026-01-01T00:00:00Z', warnedAt: '2028-02-10T00:00:00Z' };
    expect(retentionDecision(i, at('2028-03-12T00:00:00Z')).action).toBe('keep');
  });

  it(`older accounts count as used on ${ACTIVITY_TRACKED_FROM.slice(0, 10)} (tracking start): none deleted before a year after it`, () => {
    const old = { tenantId: T, createdAt: '2026-01-01T00:00:00Z' };
    expect(retentionDecision(old, at('2027-10-01T00:00:00Z')).action).toBe('keep');
    expect(plannedDeletion(old, at('2027-01-01T00:00:00Z'))).toEqual({ on: '2027-11-26T00:00:00.000Z', reason: 'inactive' });
  });
});

describe('retention rules: never deleted automatically', () => {
  const old = '2020-01-01T00:00:00.000Z';
  const far = at('2035-01-01T00:00:00Z');

  it('free unlimited and accounts on hold', () => {
    expect(retentionDecision({ tenantId: T, entitlement: { status: 'exempt' }, lastActiveAt: old }, far)).toEqual({ action: 'keep', why: 'exempt' });
    expect(retentionDecision({ tenantId: T, onHold: true, lastActiveAt: old }, far)).toEqual({ action: 'keep', why: 'hold' });
    expect(plannedDeletion({ tenantId: T, onHold: true }, far)).toBeNull();
  });

  it('disabled by staff: only listed for staff once disabled 12 months', () => {
    const d = { tenantId: T, disabled: { since: '2034-06-01T00:00:00.000Z' }, lastActiveAt: old };
    expect(retentionDecision(d, far)).toEqual({ action: 'keep', why: 'disabled' });
    expect(retentionDecision(d, at('2035-06-02T00:00:00Z'))).toEqual({ action: 'review', disabledSince: '2034-06-01T00:00:00.000Z' });
  });

  it('an open-ended paid plan (no end date)', () => {
    expect(retentionDecision({ tenantId: T, entitlement: { status: 'subscribed' } }, far)).toEqual({ action: 'keep', why: 'open-ended' });
  });
});
