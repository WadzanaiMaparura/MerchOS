import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { alarmWording } from '../lib/alarm-catalogue';
import { addSeries, areaOf, needsAlert, statusOf, writingCostCents } from '../lib/health';
import { alertEmail } from '../lib/notify';

const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';

describe('health rules', () => {
  it('puts each function in the area a seller would recognise', () => {
    expect(areaOf('merch-os-pi-generate-dev', 'dev')).toBe('listings');
    expect(areaOf('merch-os-product-synthesizeproduct-dev', 'dev')).toBe('listings'); // "Write my listing"
    expect(areaOf('merch-os-product-createproduct-dev', 'dev')).toBe('products');
    expect(areaOf('merch-os-auth-custommessage-dev', 'dev')).toBe('emails'); // sign-in code emails
    expect(areaOf('merch-os-auth-presignup-dev', 'dev')).toBe('accounts');
    expect(areaOf('merch-os-support-chat-wsconnect-dev', 'dev')).toBe('chat');
    expect(areaOf('merch-os-pi-generate-production', 'dev')).toBeNull(); // other environment
    expect(areaOf('MerchOSProducts', 'dev')).toBeNull();
  });

  it('status in plain terms', () => {
    expect(statusOf(100, 0)).toBe('working');
    expect(statusOf(0, 0)).toBe('no_activity');
    expect(statusOf(100, 2)).toBe('some_errors');
    expect(statusOf(15, 12)).toBe('down');
    expect(statusOf(0, 0, { notLive: true })).toBe('not_live');
  });

  it('alerts only for real problems, not one-off errors', () => {
    expect(needsAlert({ id: 'listings', errors: 2, requests: 10 })).toBe(false);
    expect(needsAlert({ id: 'listings', errors: 3, requests: 41 })).toBe(true); // 7%
    expect(needsAlert({ id: 'products', errors: 3, requests: 1000 })).toBe(false); // 0.3%
    expect(needsAlert({ id: 'imports', errors: 20, requests: 10_000 })).toBe(true);
  });

  it('writing cost in rand from token use', () => {
    // 1M input + 200k output on Haiku 4.5 = $1 + $1 = $2 = R36
    expect(writingCostCents([{ model: 'eu.anthropic.claude-haiku-4-5-20251001-v1:0', input: 1_000_000, output: 200_000 }])).toBe(3600);
  });

  it('adds series by time', () => {
    const s = addSeries([
      { times: ['a', 'b'], values: [1, 2] },
      { times: ['b'], values: [3] },
      undefined,
    ]);
    expect([...s]).toEqual([['a', 1], ['b', 5]]);
  });

  it('existing alarms read in plain language', () => {
    expect(alarmWording('merch-os-billing-ItnErrors-dev', 'dev')).toMatchObject({ area: 'payments', title: 'Payment notifications are failing' });
    expect(alarmWording('merch-os-si-import-dlq-depth-dev', 'dev').whatToDo).toMatch(/upload the file again/);
    expect(alarmWording('merch-os-new-thing-dev', 'dev', 'Something').description).toBe('Something');
  });

  it('alert email: plain words, no "AI", link to Alerts', () => {
    const a = {
      alertId: 'x', key: 'area:listings', source: 'area' as const, title: 'Listing writing is failing for some sellers',
      description: '3 errors in the last 30 minutes (7% of requests).', whatToDo: 'Tell the team.', status: 'OPEN' as const,
      startedAt: '2026-11-23T08:42:00Z', lastSeenAt: '2026-11-23T08:42:00Z', notes: [],
    };
    const e = alertEmail(a, 'opened', 'https://admin.merchos.co.za');
    expect(e.subject).toBe('MerchOS alert: Listing writing is failing for some sellers');
    expect(e.html).toContain('https://admin.merchos.co.za/alerts');
    expect(e.html).toContain('10:42'); // SAST
    expect(e.text).not.toMatch(/\bAI\b/);
    expect(alertEmail({ ...a, resolvedAt: '2026-11-23T09:30:00Z' }, 'resolved', 'https://x').subject).toBe('Resolved: Listing writing is failing for some sellers');
  });
});

// ─── Monitor: open once, email once, close when quiet ───────────────────────

const store = vi.hoisted(() => ({
  open: new Map<string, { alertId: string; key: string; title: string; status: string; notes: unknown[]; area?: string; startedAt: string; lastSeenAt: string; description: string; whatToDo: string; source: string }>(),
  resolved: [] as Array<Record<string, unknown>>,
  emails: [] as string[],
  checks: [] as Array<{ id: string; errors: number; requests: number }>,
  audit: [] as Array<Record<string, unknown>>,
}));

vi.mock('../lib/alerts', () => ({
  openAlert: async (input: { key: string; title: string; description: string; whatToDo: string; source: string; area?: string }) => {
    const existing = store.open.get(input.key);
    if (existing) return { alert: existing, created: false };
    const alert = { ...input, alertId: crypto.randomUUID(), status: 'OPEN', notes: [], startedAt: 'now', lastSeenAt: 'now' };
    store.open.set(input.key, alert);
    return { alert, created: true };
  },
  resolveByKey: async (key: string) => {
    const a = store.open.get(key);
    if (!a) return null;
    store.open.delete(key);
    const done = { ...a, status: 'RESOLVED', resolvedBy: 'auto' };
    store.resolved.push(done);
    return done;
  },
  getAlert: async (id: string) => [...store.open.values()].find((a) => a.alertId === id) ?? null,
  resolveAlert: async (id: string, by: string) => {
    const a = [...store.open.values()].find((x) => x.alertId === id);
    if (!a) return null;
    store.open.delete(a.key);
    return { ...a, status: 'RESOLVED', resolvedBy: by };
  },
  addNote: async (id: string) => [...store.open.values()].find((a) => a.alertId === id) ?? null,
  listAlerts: async (status: string) => (status === 'OPEN' ? [...store.open.values()] : store.resolved),
  countOpen: async () => store.open.size,
}));
vi.mock('../lib/notify', async () => {
  const actual = await vi.importActual<typeof import('../lib/notify')>('../lib/notify');
  return { ...actual, sendAlertEmail: async (a: { title: string }, kind: string) => void store.emails.push(`${kind}: ${a.title}`) };
});
vi.mock('../lib/health', async () => {
  const actual = await vi.importActual<typeof import('../lib/health')>('../lib/health');
  return { ...actual, quickCheck: async () => store.checks };
});
vi.mock('../lib/audit', () => ({ recordAudit: async (s: object, e: object) => void store.audit.push({ ...s, ...e }) }));
vi.mock('../lib/audit-feed', () => ({ staffDirectory: async () => new Map([['staff-admin', { email: 'admin@merchos.co.za', role: 'Admin' }]]) }));

import { handler as monitor, onAlarm, runHealthCheck } from '../handlers/alerts-monitor';
import { handler as alertsRead, _setCloudWatch } from '../handlers/alerts-read';
import { handler as alertsManage } from '../handlers/alerts-manage';

const quiet = () => ['accounts', 'products', 'listings', 'imports', 'images', 'exports', 'payments', 'emails', 'chat', 'staff'].map((id) => ({ id, errors: 0, requests: 0 }));

beforeEach(() => {
  process.env['ENVIRONMENT'] = 'dev';
  process.env['COGNITO_ISSUER'] = ISSUER;
  store.open.clear();
  store.resolved = [];
  store.emails = [];
  store.audit = [];
  store.checks = quiet();
  _setCloudWatch({
    send: async () => ({ MetricAlarms: [{ AlarmName: 'merch-os-billing-ItnErrors-dev', StateValue: 'OK' }, { AlarmName: 'merch-os-billing-ItnErrors-production', StateValue: 'ALARM' }] }),
  } as never);
});

describe('alert checker', () => {
  it('opens one alert and sends one email while the problem continues, then closes it when quiet', async () => {
    store.checks = quiet().map((c) => (c.id === 'listings' ? { ...c, errors: 3, requests: 41 } : c));
    expect(await runHealthCheck()).toEqual({ opened: ['listings'], resolved: [] });
    expect(await runHealthCheck()).toEqual({ opened: [], resolved: [] });
    expect(store.emails).toEqual(['opened: Listing writing is failing for some sellers']);
    expect([...store.open.values()][0]).toMatchObject({ description: '3 errors in the last 30 minutes (7% of requests).' });

    // A couple of errors: still not clear, keep it open.
    store.checks = quiet().map((c) => (c.id === 'listings' ? { ...c, errors: 1, requests: 30 } : c));
    expect(await runHealthCheck()).toEqual({ opened: [], resolved: [] });

    store.checks = quiet();
    expect(await runHealthCheck()).toEqual({ opened: [], resolved: ['listings'] });
    expect(store.emails[1]).toBe('resolved: Listing writing is failing for some sellers');
  });

  it('existing CloudWatch alarms open and close alerts too', async () => {
    const ev = (value: string, name = 'merch-os-billing-ItnErrors-dev') => ({
      'detail-type': 'CloudWatch Alarm State Change',
      detail: { alarmName: name, state: { value } },
    });
    expect(await onAlarm(ev('ALARM'))).toBe('opened');
    expect(store.emails).toEqual(['opened: Payment notifications are failing']);
    expect(await onAlarm(ev('INSUFFICIENT_DATA'))).toBe('ignored');
    expect(await onAlarm(ev('OK'))).toBe('resolved');
    expect(await onAlarm(ev('ALARM', 'merch-os-billing-ItnErrors-production'))).toBe('ignored'); // other environment
    expect(await onAlarm(ev('ALARM', 'someone-elses-alarm-dev'))).toBe('ignored');
  });

  it('routes the two triggers', async () => {
    expect(await monitor({ 'detail-type': 'Scheduled Event', detail: {} })).toEqual({ opened: [], resolved: [] });
    expect(await monitor({ 'detail-type': 'CloudWatch Alarm State Change', detail: { alarmName: 'merch-os-si-import-dlq-depth-dev', state: { value: 'ALARM' } } })).toEqual({ result: 'opened' });
  });
});

function event(routeKey: string, group: string, opts: { path?: Record<string, string>; body?: unknown; query?: Record<string, string> } = {}) {
  return {
    routeKey,
    headers: {},
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    requestContext: {
      http: { method: routeKey.split(' ')[0] },
      authorizer: { jwt: { claims: { sub: `staff-${group.toLowerCase()}`, iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, 'cognito:groups': `[${group}]` } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}
const call = async (fn: (e: APIGatewayProxyEventV2, c: never) => unknown, e: APIGatewayProxyEventV2) => {
  const r = (await fn(e, {} as never)) as { statusCode: number; body: string };
  return { status: r.statusCode, body: JSON.parse(r.body) as unknown };
};

describe('alerts API', () => {
  beforeEach(async () => {
    store.checks = quiet().map((c) => (c.id === 'images' ? { ...c, errors: 25, requests: 100 } : c));
    await runHealthCheck();
  });

  it('Support can see alerts and the count; only Admin can resolve', async () => {
    const r = await call(alertsRead, event('GET /admin/alerts', 'Support'));
    expect(r.status).toBe(200);
    const body = r.body as { alerts: Array<{ alertId: string; title: string }>; openCount: number; checks: Array<{ key: string; state: string }> };
    expect(body.openCount).toBe(1);
    expect(body.checks.find((c) => c.key === 'area:images')?.state).toBe('alert');
    expect(body.checks.find((c) => c.key === 'alarm:merch-os-billing-ItnErrors-dev')?.state).toBe('ok');
    expect(body.checks.some((c) => c.key.endsWith('-production'))).toBe(false);
    expect((await call(alertsRead, event('GET /admin/alerts/unresolved-count', 'Support'))).body).toBe(1);

    const id = body.alerts[0]!.alertId;
    const path = { alertId: id };
    expect((await call(alertsManage, event('POST /admin/alerts/{alertId}/resolve', 'Support', { path, body: {} }))).status).toBe(403);
    expect((await call(alertsManage, event('POST /admin/alerts/{alertId}/notes', 'Admin', { path, body: { note: '' } }))).status).toBe(400);
    expect((await call(alertsManage, event('POST /admin/alerts/{alertId}/notes', 'Admin', { path, body: { note: 'Looking into it' } }))).status).toBe(200);
    expect((await call(alertsManage, event('POST /admin/alerts/{alertId}/resolve', 'Admin', { path, body: { note: 'Fixed' } }))).status).toBe(200);
    expect((await call(alertsManage, event('POST /admin/alerts/{alertId}/resolve', 'Admin', { path, body: {} }))).status).toBe(404);
    expect(store.audit.map((a) => [a['action'], a['label'], a['reason']])).toEqual([
      ['alert-note', 'Images is failing for some sellers', 'Looking into it'],
      ['alert-resolved', 'Images is failing for some sellers', 'Fixed'],
    ]);
  });
});
