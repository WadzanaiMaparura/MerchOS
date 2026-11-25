import { describe, expect, it } from 'vitest';
import { billingStage, comebackOffer, stageAllowsNewWork, stageDates } from '../billing-stage';

const UNTIL = '2026-12-22T10:00:00.000Z';
const at = (days: number) => new Date(Date.parse(UNTIL) + days * 86_400_000);
const paid = { status: 'subscribed', subscribedUntil: UNTIL };

describe('billingStage', () => {
  it('walks paid > due soon > grace > paused > closed from the paid-until date', () => {
    expect(billingStage(paid, at(-20))).toBe('paid');
    expect(billingStage(paid, at(-7.01))).toBe('paid');
    expect(billingStage(paid, at(-7))).toBe('due_soon');
    expect(billingStage(paid, at(-0.01))).toBe('due_soon');
    expect(billingStage(paid, at(0))).toBe('grace');
    expect(billingStage(paid, at(2.99))).toBe('grace');
    expect(billingStage(paid, at(3))).toBe('paused');
    expect(billingStage(paid, at(36.99))).toBe('paused');
    expect(billingStage(paid, at(37))).toBe('closed');
    expect(billingStage(paid, at(400))).toBe('closed');
  });

  it('never-paid, exempt and open-ended plans', () => {
    expect(billingStage(null)).toBe('none');
    expect(billingStage({ status: 'active' })).toBe('none');
    expect(billingStage({ status: 'exempt', subscribedUntil: UNTIL }, at(100))).toBe('exempt');
    expect(billingStage({ status: 'subscribed' }, at(100))).toBe('paid');
  });

  it('only paid, due soon and grace allow new products and listings', () => {
    expect(['paid', 'due_soon', 'grace'].every((s) => stageAllowsNewWork(s as never))).toBe(true);
    expect(['paused', 'closed', 'none', 'exempt'].some((s) => stageAllowsNewWork(s as never))).toBe(false);
  });
});

describe('stageDates', () => {
  it('grace ends on day 3, closes on day 37, data kept 12 months after closing', () => {
    const d = stageDates(UNTIL);
    expect(d.graceEndsAt).toBe('2026-12-25T10:00:00.000Z');
    expect(d.closesAt).toBe('2027-01-28T10:00:00.000Z');
    expect(d.dataKeptUntil).toBe('2028-01-28T10:00:00.000Z');
    expect(d.comebackStartsAt).toBe('2027-03-22T10:00:00.000Z');
    expect(d.comebackEndsAt).toBe('2027-04-05T10:00:00.000Z');
  });
});

describe('comebackOffer', () => {
  it('50% off only in the 14 days from day 90, and only once', () => {
    expect(comebackOffer(UNTIL, undefined, at(89))).toBeNull();
    expect(comebackOffer(UNTIL, undefined, at(90))).toEqual({ percentOff: 50, endsAt: '2027-04-05T10:00:00.000Z' });
    expect(comebackOffer(UNTIL, undefined, at(103.9))).not.toBeNull();
    expect(comebackOffer(UNTIL, undefined, at(104))).toBeNull();
    expect(comebackOffer(UNTIL, '2026-01-01T00:00:00.000Z', at(95))).toBeNull();
    expect(comebackOffer(undefined, undefined, at(95))).toBeNull();
  });
});
