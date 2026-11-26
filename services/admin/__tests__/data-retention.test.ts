import { beforeEach, describe, expect, it, vi } from 'vitest';

const T_CLOSED = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const T_TRIAL = '11111111-1111-4111-8111-111111111111';
const T_EXEMPT = '22222222-2222-4222-8222-222222222222';
const T_DISABLED = '33333333-3333-4333-8333-333333333333';

const s = vi.hoisted(() => ({
  retention: new Map<string, Record<string, unknown>>(),
  warned: [] as Array<{ tenantId: string; deleteOn: string }>,
  purged: [] as string[],
  finished: [] as string[],
  audit: [] as Array<{ action: string }>,
  events: [] as Array<Record<string, unknown>>,
  emails: [] as Array<{ subject: string; html: string }>,
  unfinished: [] as Array<{ tenantId: string; reason: string }>,
  blockPurge: false,
}));

vi.mock('../lib/cognito', () => ({
  listSellerUsers: vi.fn(async () =>
    [T_CLOSED, T_TRIAL, T_EXEMPT, T_DISABLED].map((tenantId, i) => ({ userId: `u${i}`, email: `u${i}@x.co.za`, tenantId })),
  ),
}));
vi.mock('../lib/data', () => ({
  mapLimit: async <T, R>(items: T[], _n: number, fn: (t: T) => Promise<R>) => Promise.all(items.map(fn)),
  getTenantInfos: async (ts: Array<{ tenantId: string }>) =>
    new Map(ts.map((t) => [t.tenantId, { tenantId: t.tenantId, businessName: `Biz ${t.tenantId.slice(0, 4)}`, createdAt: '2026-01-01T00:00:00.000Z' }])),
  getEntitlements: async () =>
    new Map<string, unknown>([
      [T_CLOSED, { status: 'subscribed', subscribedUntil: '2027-01-01T00:00:00.000Z' }],
      [T_TRIAL, { status: 'active' }],
      [T_EXEMPT, { status: 'exempt' }],
    ]),
  batchGet: async () => [{ PK: `TENANT#${T_TRIAL}`, SK: 'ACTIVITY', lastActiveAt: '2027-01-15T00:00:00.000Z' }],
}));
vi.mock('../lib/audit', () => ({
  getState: async (t: string) => (t === T_DISABLED ? { disabled: true, changedAt: '2026-12-01T00:00:00.000Z', changedBy: 's' } : null),
  recordAudit: vi.fn(async (_s: unknown, e: { action: string }) => {
    s.audit.push(e);
  }),
}));
vi.mock('../lib/retention-store', () => ({
  getHold: async () => null,
  getRetention: async (t: string) => s.retention.get(t) ?? null,
  recordWarning: vi.fn(async (tenantId: string, deleteOn: string) => {
    s.warned.push({ tenantId, deleteOn });
    s.retention.set(tenantId, { warnedAt: new Date().toISOString(), deleteOn });
  }),
  clearWarning: vi.fn(async (t: string) => {
    s.retention.delete(t);
  }),
  markDeleting: vi.fn(async () => undefined),
  finishDeletion: vi.fn(async (r: { tenantId: string }) => {
    s.finished.push(r.tenantId);
  }),
  listUnfinishedDeletions: async () => s.unfinished,
}));
vi.mock('../lib/retention-purge', async () => {
  class RetentionBlockedError extends Error {}
  return {
    RetentionBlockedError,
    purgeTenant: vi.fn(async (t: string) => {
      if (s.blockPurge) throw new RetentionBlockedError('A card subscription is still active at PayFast.');
      s.purged.push(t);
      return { counts: { products: 3, files: 2 }, keptUntil: '2032-12-01T00:00:00.000Z' };
    }),
  };
});

import { _setClients, runRetention } from '../handlers/data-retention';

beforeEach(() => {
  s.retention.clear();
  for (const a of [s.warned, s.purged, s.finished, s.audit, s.events, s.emails, s.unfinished]) a.length = 0;
  s.blockPurge = false;
  process.env['ALERT_EMAIL'] = 'admin@merchos.co.za';
  process.env['EVENT_BUS_NAME'] = 'bus';
  process.env['ENGAGEMENT_TABLE'] = 'engagement';
  _setClients({
    events: { send: async (c: { input: { Entries: Array<Record<string, unknown>> } }) => (s.events.push(...c.input.Entries), { FailedEntryCount: 0 }) } as never,
    ses: {
      send: async (c: { input: { Content: { Simple: { Subject: { Data: string }; Body: { Html: { Data: string } } } } } }) => {
        s.emails.push({ subject: c.input.Content.Simple.Subject.Data, html: c.input.Content.Simple.Body.Html.Data });
        return {};
      },
    } as never,
  });
});

// Closed account (paid until 1 Jan 2027): deletion 7 Feb 2028. Trial last used 15 Jan 2027: deletion 15 Jan 2028.
const WARN_DAY = new Date('2028-01-10T01:00:00Z');
const DELETE_DAY = new Date('2028-02-10T01:00:00Z');

describe('data retention job', () => {
  it('off: does nothing at all', async () => {
    process.env['DATA_RETENTION'] = 'off';
    expect(await runRetention(WARN_DAY)).toEqual({ mode: 'off', checked: 0, lines: [], emailed: false });
    expect(s.emails).toHaveLength(0);
  });

  it('dry run: no seller email, nothing deleted, admin gets the list', async () => {
    process.env['DATA_RETENTION'] = 'dryrun';
    const r = await runRetention(DELETE_DAY);
    expect(s.events).toHaveLength(0);
    expect(s.warned).toHaveLength(0);
    expect(s.purged).toHaveLength(0);
    expect(r.lines.map((l) => [l.tenantId, l.what]).sort()).toEqual(
      [
        [T_CLOSED, 'would-warn'],
        [T_DISABLED, 'review'],
        [T_TRIAL, 'would-warn'],
      ].sort(),
    );
    expect(s.emails[0]!.subject).toBe('Data deletion rehearsal: 3 accounts listed');
    expect(s.emails[0]!.html).toContain('Nothing was deleted and no seller was emailed');
    expect(s.emails[0]!.html).not.toMatch(/\u2014|\bAI\b/);
  });

  it('on: warns 30 days before (event for the seller email), then deletes once the date has passed', async () => {
    process.env['DATA_RETENTION'] = 'on';
    await runRetention(new Date('2027-12-15T01:00:00Z')); // trial due 15 Jan 2028: first daily run inside the window
    expect(s.warned).toEqual([{ tenantId: T_TRIAL, deleteOn: '2028-01-15T00:00:00.000Z' }]);
    expect(s.events).toEqual([
      expect.objectContaining({ Source: 'merch-os.admin', DetailType: 'admin.retention.warning', EventBusName: 'bus' }),
    ]);
    expect(JSON.parse(s.events[0]!['Detail'] as string)).toEqual({ tenantId: T_TRIAL, deleteOn: '2028-01-15T00:00:00.000Z', reason: 'inactive' });

    // The warning above was recorded "now" (real time), so pretend it went out 31 days before.
    s.retention.set(T_TRIAL, { warnedAt: '2027-12-15T01:00:00.000Z' });
    await runRetention(new Date('2028-01-16T01:00:00Z'));
    expect(s.purged).toEqual([T_TRIAL]);
    expect(s.finished).toEqual([T_TRIAL]);
    expect(s.audit).toEqual([expect.objectContaining({ action: 'data-deleted', by: 'automatic' })]);
  });

  it('never deletes the free unlimited account; the disabled one is only listed for staff', async () => {
    process.env['DATA_RETENTION'] = 'on';
    for (const t of [T_EXEMPT, T_DISABLED]) s.retention.set(t, {});
    const r = await runRetention(new Date('2035-01-01T00:00:00Z'));
    expect(s.purged).not.toContain(T_EXEMPT);
    expect(s.purged).not.toContain(T_DISABLED);
    expect(r.lines.find((l) => l.tenantId === T_DISABLED)?.what).toBe('review');
  });

  it('blocked (card still active): nothing deleted, reported', async () => {
    process.env['DATA_RETENTION'] = 'on';
    s.retention.set(T_CLOSED, { warnedAt: '2028-01-07T01:00:00.000Z' });
    s.blockPurge = true;
    const r = await runRetention(DELETE_DAY);
    expect(r.lines.find((l) => l.tenantId === T_CLOSED)).toMatchObject({ what: 'blocked' });
    expect(s.finished).toEqual([]);
    expect(s.emails[0]!.html).toContain('card subscription is still active');
  });

  it('a deletion that stopped part way is finished first', async () => {
    process.env['DATA_RETENTION'] = 'on';
    s.unfinished.push({ tenantId: T_CLOSED, reason: 'closed' });
    await runRetention(WARN_DAY);
    expect(s.purged[0]).toBe(T_CLOSED);
  });

  it('back in use after a warning: the warning is cleared', async () => {
    process.env['DATA_RETENTION'] = 'on';
    s.retention.set(T_EXEMPT, { warnedAt: '2028-01-01T00:00:00.000Z' });
    await runRetention(WARN_DAY);
    expect(s.retention.has(T_EXEMPT)).toBe(false);
  });

  it('quiet days send no email, except a short Monday note', async () => {
    process.env['DATA_RETENTION'] = 'dryrun';
    await runRetention(new Date('2027-03-03T01:00:00Z')); // Wednesday, nothing due
    expect(s.emails).toHaveLength(0);
    await runRetention(new Date('2027-03-01T01:00:00Z')); // Monday
    expect(s.emails).toHaveLength(1);
    expect(s.emails[0]!.subject).toBe('Data deletion rehearsal: nothing due');
  });
});
