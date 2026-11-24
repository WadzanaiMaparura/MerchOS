import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canUseChannel, dmChannel, monthRange } from '../lib/team';
import { filterArticles, type Article } from '../lib/library';

const ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_test';
const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001';
const SUPPORT = 'bbbbbbbb-0000-4000-8000-000000000002';

// ─── Pure rules ─────────────────────────────────────────────────────────────

describe('library search', () => {
  const a = (title: string, body: string, extra: Partial<Article> = {}): Article => ({
    articleId: title, title, body, category: 'marketplace-rules', pinned: false,
    createdAt: '2026-11-01', createdBy: ADMIN, updatedAt: '2026-11-01', updatedBy: ADMIN, ...extra,
  });
  const all = [
    a('Takealot image rules', 'Main image 1000 x 1000, white background.', { updatedAt: '2026-11-20' }),
    a('Makro checklist', 'Barcode required.', { updatedAt: '2026-11-22' }),
    a('Refunds', 'We refund within 7 days.', { category: 'policies', pinned: true, updatedAt: '2026-10-01' }),
  ];
  it('pinned first, then newest; all words must match; category filter', () => {
    expect(filterArticles(all, {}).map((x) => x.title)).toEqual(['Refunds', 'Makro checklist', 'Takealot image rules']);
    expect(filterArticles(all, { q: 'takealot WHITE' }).map((x) => x.title)).toEqual(['Takealot image rules']);
    expect(filterArticles(all, { q: 'takealot barcode' })).toEqual([]);
    expect(filterArticles(all, { category: 'policies' }).map((x) => x.title)).toEqual(['Refunds']);
  });
});

describe('team rules', () => {
  const staff = new Set([ADMIN, SUPPORT]);
  it('only the two people in a direct conversation can use it', () => {
    const dm = dmChannel(SUPPORT, ADMIN);
    expect(dm).toBe(dmChannel(ADMIN, SUPPORT));
    expect(canUseChannel(dm, ADMIN, staff)).toBe(true);
    expect(canUseChannel(dm, SUPPORT, staff)).toBe(true);
    expect(canUseChannel(dm, 'cccccccc-0000-4000-8000-000000000003', staff)).toBe(false);
    expect(canUseChannel('everyone', SUPPORT, staff)).toBe(true);
    expect(canUseChannel(`dm.${ADMIN}.${ADMIN}`, ADMIN, staff)).toBe(false);
    expect(canUseChannel(`dm.${SUPPORT}.${ADMIN}`, ADMIN, staff)).toBe(false); // not the sorted form
    expect(canUseChannel('dm.x.y', ADMIN, staff)).toBe(false);
  });
  it('month in South African time', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-10-31T22:00:00.000Z', to: '2026-11-30T21:59:59.999Z' });
  });
});

// ─── Handlers on an in-memory table ─────────────────────────────────────────

const mem = vi.hoisted(() => ({ items: new Map<string, Record<string, unknown>>(), audit: [] as Array<Record<string, unknown>> }));

vi.mock('../lib/data', () => {
  const k = (pk: unknown, sk: unknown) => `${pk}|${sk}`;
  return {
    db: () => ({
      send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
        const i = cmd.input;
        switch (cmd.constructor.name) {
          case 'PutCommand':
            mem.items.set(k(i.Item.PK, i.Item.SK), { ...i.Item });
            return {};
          case 'GetCommand':
            return { Item: mem.items.get(k(i.Key.PK, i.Key.SK)) };
          case 'DeleteCommand':
            mem.items.delete(k(i.Key.PK, i.Key.SK));
            return {};
          case 'UpdateCommand': {
            const key = k(i.Key.PK, i.Key.SK);
            const cur = mem.items.get(key) ?? { PK: i.Key.PK, SK: i.Key.SK };
            if (cur['lastReadAt'] && String(cur['lastReadAt']) >= String(i.ExpressionAttributeValues[':at'])) {
              throw Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' });
            }
            mem.items.set(key, { ...cur, lastReadAt: i.ExpressionAttributeValues[':at'] });
            return {};
          }
          case 'QueryCommand': {
            const v = i.ExpressionAttributeValues;
            let rows = [...mem.items.values()];
            if (i.IndexName) {
              rows = rows.filter((r) => r['GSI1PK'] === v[':pk']);
              if (v[':from']) rows = rows.filter((r) => String(r['GSI1SK']) >= v[':from'] && String(r['GSI1SK']) <= v[':to']);
              rows.sort((a, b) => String(a['GSI1SK']).localeCompare(String(b['GSI1SK'])));
            } else {
              rows = rows.filter((r) => r['PK'] === v[':pk']);
              if (v[':sk']) rows = rows.filter((r) => String(r['SK']).startsWith(v[':sk']));
              if (v[':after']) rows = rows.filter((r) => String(r['SK']) > v[':after']);
              if (v[':me']) rows = rows.filter((r) => r['from'] !== v[':me']);
              rows.sort((a, b) => String(a['SK']).localeCompare(String(b['SK'])));
            }
            if (i.ScanIndexForward === false) rows.reverse();
            if (i.Limit) rows = rows.slice(0, i.Limit);
            return i.Select === 'COUNT' ? { Count: rows.length } : { Items: rows, Count: rows.length };
          }
          default:
            throw new Error(`unexpected ${cmd.constructor.name}`);
        }
      },
    }),
  };
});
vi.mock('../lib/audit-feed', () => ({
  staffDirectory: async () =>
    new Map([
      [ADMIN, { email: 'admin@merchos.co.za', role: 'Admin' }],
      [SUPPORT, { email: 'info@merchos.co.za', role: 'Support' }],
    ]),
}));
vi.mock('../lib/audit', () => ({ recordAudit: async (s: object, e: object) => void mem.audit.push({ ...s, ...e }) }));
vi.mock('../lib/cognito', () => ({
  listSellerUsers: async () => [
    { userId: 'u1', tenantId: 't1', createdAt: '2026-11-10T08:00:00.000Z' },
    { userId: 'u2', tenantId: 't1', createdAt: '2026-11-12T08:00:00.000Z' }, // same business
    { userId: 'u3', tenantId: 't2', createdAt: '2026-10-05T08:00:00.000Z' }, // last month
  ],
}));

import { handler as libraryRead } from '../handlers/library-read';
import { handler as libraryManage } from '../handlers/library-manage';
import { handler as teamApi } from '../handlers/team-api';
import { handler as teamManage } from '../handlers/team-manage';

const who = { Admin: ADMIN, Support: SUPPORT } as const;
function ev(routeKey: string, group: 'Admin' | 'Support' | 'Seller', opts: { body?: unknown; path?: Record<string, string>; query?: Record<string, string> } = {}) {
  return {
    routeKey,
    headers: {},
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    requestContext: {
      http: { method: routeKey.split(' ')[0] },
      authorizer: { jwt: { claims: { sub: group === 'Seller' ? 'seller' : who[group], iss: ISSUER, exp: Math.floor(Date.now() / 1000) + 600, 'cognito:groups': `[${group}]` } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}
const call = async (fn: (e: APIGatewayProxyEventV2, c: never) => unknown, e: APIGatewayProxyEventV2) => {
  const r = (await fn(e, {} as never)) as { statusCode: number; body: string };
  return { status: r.statusCode, body: JSON.parse(r.body) as any };
};

beforeEach(() => {
  process.env['COGNITO_ISSUER'] = ISSUER;
  process.env['ADMIN_TABLE'] = 'admin';
  process.env['ENGAGEMENT_TABLE'] = 'engagement';
  process.env['CHAT_TABLE'] = 'chat';
  mem.items.clear();
  mem.audit = [];
});

describe('Library API', () => {
  it('Admin writes, Support reads, sellers are refused', async () => {
    const article = { title: 'Takealot image rules', category: 'marketplace-rules', body: 'Main image at least 1000 x 1000.', pinned: true };
    expect((await call(libraryManage, ev('POST /admin/library', 'Support', { body: article }))).status).toBe(403);
    const created = await call(libraryManage, ev('POST /admin/library', 'Admin', { body: article }));
    expect(created.status).toBe(201);
    const id = created.body.article.articleId;

    const list = await call(libraryRead, ev('GET /admin/library', 'Support', { query: { q: '1000' } }));
    expect(list.body.articles).toEqual([expect.objectContaining({ title: 'Takealot image rules', updatedByEmail: 'admin@merchos.co.za', pinned: true })]);
    expect(list.body.categories.find((c: { id: string }) => c.id === 'marketplace-rules').count).toBe(1);
    expect((await call(libraryRead, ev('GET /admin/library', 'Seller'))).status).toBe(403);

    expect((await call(libraryManage, ev('PUT /admin/library/{articleId}', 'Admin', { path: { articleId: id }, body: { ...article, body: 'Updated.' } }))).status).toBe(200);
    expect((await call(libraryRead, ev('GET /admin/library/{articleId}', 'Support', { path: { articleId: id } }))).body.article.body).toBe('Updated.');
    expect((await call(libraryManage, ev('POST /admin/library', 'Admin', { body: { ...article, category: 'nope' } }))).status).toBe(400);
    expect((await call(libraryManage, ev('DELETE /admin/library/{articleId}', 'Admin', { path: { articleId: id } }))).status).toBe(200);
    expect(mem.audit.map((a) => [a['action'], a['label']])).toEqual([
      ['article-created', 'Library: Takealot image rules'],
      ['article-updated', 'Library: Takealot image rules'],
      ['article-deleted', 'Library: Takealot image rules'],
    ]);
  });
});

describe('Team API', () => {
  it('announcements: Admin posts, staff see it unread until they mark it read', async () => {
    expect((await call(teamManage, ev('POST /admin/team/announcements', 'Support', { body: { title: 'Hello team', body: 'x' } }))).status).toBe(403);
    const a = await call(teamManage, ev('POST /admin/team/announcements', 'Admin', { body: { title: 'Takealot changed its image rules', body: 'From 1 December.' } }));
    const id = a.body.announcement.announcementId;
    expect((await call(teamApi, ev('GET /admin/team/unread', 'Support'))).body).toEqual({ announcements: 1, chat: 0, total: 1 });
    expect((await call(teamApi, ev('GET /admin/team/unread', 'Admin'))).body.announcements).toBe(0); // own post
    await call(teamApi, ev('POST /admin/team/announcements/{id}/read', 'Support', { path: { id } }));
    const list = await call(teamApi, ev('GET /admin/team/announcements', 'Admin'));
    expect(list.body.announcements[0]).toMatchObject({ readBy: 1, audience: 1, createdByEmail: 'admin@merchos.co.za' });
    expect((await call(teamApi, ev('GET /admin/team/unread', 'Support'))).body.total).toBe(0);
    await call(teamManage, ev('DELETE /admin/team/announcements/{id}', 'Admin', { path: { id } }));
    expect((await call(teamApi, ev('GET /admin/team/announcements', 'Support'))).body.announcements).toEqual([]);
  });

  it('goals: Admin creates; the owner updates a manual goal; automatic goals count themselves', async () => {
    const manual = await call(teamManage, ev('POST /admin/team/goals', 'Admin', { body: { title: 'Answer chats within 2 minutes', month: '2026-11', target: 100, kind: 'manual', ownerId: SUPPORT } }));
    const auto = await call(teamManage, ev('POST /admin/team/goals', 'Admin', { body: { title: 'Onboard 20 new sellers', month: '2026-11', target: 20, kind: 'auto', metric: 'new_sellers' } }));
    expect(manual.status).toBe(201);
    expect((await call(teamManage, ev('POST /admin/team/goals', 'Admin', { body: { title: 'Bad', month: '2026-11', target: 5, kind: 'auto' } }))).status).toBe(400);
    expect((await call(teamManage, ev('POST /admin/team/goals', 'Support', { body: { title: 'Mine', month: '2026-11', target: 5, kind: 'manual' } }))).status).toBe(403);

    const progress = ev('PUT /admin/team/goals/{id}/progress', 'Support', { path: { id: manual.body.goal.goalId }, body: { current: 64, status: 'On track' } });
    expect((await call(teamApi, progress)).status).toBe(200);
    expect((await call(teamApi, ev('PUT /admin/team/goals/{id}/progress', 'Support', { path: { id: auto.body.goal.goalId }, body: { current: 5 } }))).status).toBe(400);

    const goals = (await call(teamApi, ev('GET /admin/team/goals', 'Support', { query: { month: '2026-11' } }))).body.goals;
    expect(goals.map((g: { title: string; progress: number; canUpdate: boolean }) => [g.title, g.progress, g.canUpdate])).toEqual([
      ['Answer chats within 2 minutes', 64, true],
      ['Onboard 20 new sellers', 1, false], // one new business this month
    ]);
    expect(goals[0]).toMatchObject({ ownerEmail: 'info@merchos.co.za', status: 'On track', updatedByEmail: 'info@merchos.co.za' });
  });

  it('chat: messages in order, unread for the other person, private direct messages', async () => {
    const dm = dmChannel(ADMIN, SUPPORT);
    const send = (group: 'Admin' | 'Support', channel: string, text: string) =>
      call(teamApi, ev('POST /admin/team/chat/{channel}/messages', group, { path: { channel }, body: { text } }));
    expect((await send('Support', 'everyone', 'A seller asks about Bob Shop')).status).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    expect((await send('Admin', 'everyone', 'Not yet')).status).toBe(201);
    expect((await send('Admin', dm, 'Can you call Thandi?')).status).toBe(201);
    expect((await send('Admin', 'everyone', '')).status).toBe(400);
    expect((await send('Admin', `dm.${ADMIN}.cccccccc-0000-4000-8000-000000000003`, 'hi')).status).toBe(403);

    const chans = (await call(teamApi, ev('GET /admin/team/chat', 'Support'))).body.channels;
    expect(chans).toEqual([
      { channel: 'everyone', label: '# everyone', unread: 1 },
      { channel: dm, label: 'admin@merchos.co.za', withUserId: ADMIN, unread: 1 },
    ]);
    const msgs = (await call(teamApi, ev('GET /admin/team/chat/{channel}/messages', 'Support', { path: { channel: 'everyone' } }))).body.messages;
    expect(msgs.map((m: { text: string; mine: boolean }) => [m.text, m.mine])).toEqual([
      ['A seller asks about Bob Shop', true],
      ['Not yet', false],
    ]);
    await call(teamApi, ev('POST /admin/team/chat/{channel}/read', 'Support', { path: { channel: 'everyone' }, body: { at: msgs[1].at } }));
    expect((await call(teamApi, ev('GET /admin/team/unread', 'Support'))).body).toEqual({ announcements: 0, chat: 1, total: 1 });
    const after = (await call(teamApi, ev('GET /admin/team/chat/{channel}/messages', 'Support', { path: { channel: 'everyone' }, query: { after: msgs[0].at } }))).body.messages;
    expect(after.map((m: { text: string }) => m.text)).toEqual(['Not yet']);
  });
});
