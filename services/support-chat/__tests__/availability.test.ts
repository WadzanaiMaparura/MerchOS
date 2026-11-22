import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLIC_HOLIDAYS,
  isChatOnline,
  isIsoDate,
  isWithinHours,
  presentAgents,
  sastParts,
} from '../lib/availability';

/** Build an instant from SAST wall-clock time (UTC+2). */
const sast = (iso: string): Date => new Date(`${iso}+02:00`);

describe('opening hours (Mon–Fri 09:00–16:00 SAST)', () => {
  it('converts to SAST wall time', () => {
    // 07:30 UTC is 09:30 in Johannesburg.
    expect(sastParts(new Date('2026-11-23T07:30:00Z'))).toMatchObject({ date: '2026-11-23', weekday: 1, hour: 9 });
    // Late UTC evening is already the next day in SAST.
    expect(sastParts(new Date('2026-11-23T22:30:00Z')).date).toBe('2026-11-24');
  });

  it('opens at 09:00 and closes at 16:00 on weekdays', () => {
    expect(isWithinHours(sast('2026-11-23T08:59:59'), [])).toBe(false);
    expect(isWithinHours(sast('2026-11-23T09:00:00'), [])).toBe(true);
    expect(isWithinHours(sast('2026-11-23T15:59:59'), [])).toBe(true);
    expect(isWithinHours(sast('2026-11-23T16:00:00'), [])).toBe(false);
  });

  it('is closed at weekends', () => {
    expect(isWithinHours(sast('2026-11-21T11:00:00'), [])).toBe(false); // Saturday
    expect(isWithinHours(sast('2026-11-22T11:00:00'), [])).toBe(false); // Sunday
  });

  it('is closed on public holidays', () => {
    expect(isWithinHours(sast('2026-12-16T11:00:00'), DEFAULT_PUBLIC_HOLIDAYS)).toBe(false); // Day of Reconciliation (Wed)
    expect(isWithinHours(sast('2026-12-17T11:00:00'), DEFAULT_PUBLIC_HOLIDAYS)).toBe(true);
    // Sunday holiday observed on the Monday.
    expect(isWithinHours(sast('2026-08-10T11:00:00'), DEFAULT_PUBLIC_HOLIDAYS)).toBe(false);
  });

  it('lists only valid dates as holidays', () => {
    expect(DEFAULT_PUBLIC_HOLIDAYS.every(isIsoDate)).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('16/12/2026')).toBe(false);
  });
});

describe('online rule', () => {
  const open = sast('2026-11-23T10:00:00');
  const fresh = { agentId: 'a', online: true, lastSeenAt: open.getTime() - 60_000 };

  it('needs hours + switch on + a recent heartbeat', () => {
    expect(isChatOnline(open, [], [fresh])).toBe(true);
  });

  it('is offline when the agent switched off', () => {
    expect(isChatOnline(open, [], [{ ...fresh, online: false }])).toBe(false);
  });

  it('is offline when the inbox stopped checking in for 3 minutes', () => {
    const stale = { ...fresh, lastSeenAt: open.getTime() - 3 * 60_000 - 1 };
    expect(presentAgents([stale], open)).toHaveLength(0);
    expect(isChatOnline(open, [], [stale])).toBe(false);
  });

  it('is offline outside hours even with an agent online (auto-offline at 16:00)', () => {
    const late = sast('2026-11-23T16:05:00');
    expect(isChatOnline(late, [], [{ ...fresh, lastSeenAt: late.getTime() }])).toBe(false);
  });

  it('is offline with nobody signed in', () => {
    expect(isChatOnline(open, [], [])).toBe(false);
  });
});
