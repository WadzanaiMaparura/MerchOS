/**
 * Team (everyone on staff). RBAC `team` read (Admin and Support).
 *
 *   GET  /admin/team/unread                              { announcements, chat, total } (nav badge)
 *   GET  /admin/team/announcements                       with read/unread for me and "read by N of M"
 *   POST /admin/team/announcements/{id}/read
 *   GET  /admin/team/goals?month=YYYY-MM                 with progress (automatic goals count themselves)
 *   PUT  /admin/team/goals/{id}/progress                 { current, status? } owner of a manual goal, or Admin
 *   GET  /admin/team/chat                                channels I can use, with unread counts
 *   GET  /admin/team/chat/{channel}/messages?after=      newest 100, or everything after a time
 *   POST /admin/team/chat/{channel}/messages             { text }
 *   POST /admin/team/chat/{channel}/read                 { at }
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { recordAudit } from '../lib/audit';
import { staffDirectory } from '../lib/audit-feed';
import { listSellerUsers } from '../lib/cognito';
import { UUID, badRequest, forbidden, json, notFound, readJson, serverError, staffOf, type HttpResult } from '../lib/http';
import {
  AUTO_METRICS,
  EVERYONE,
  autoProgress,
  canUseChannel,
  currentMonth,
  dmChannel,
  getGoal,
  lastRead,
  listAnnouncements,
  listGoals,
  listMessages,
  markAnnouncementRead,
  markChannelRead,
  postMessage,
  readersOf,
  saveGoal,
  unreadIn,
} from '../lib/team';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const messageSchema = z.object({ text: z.string().trim().min(1, 'Write a message first.').max(2000) });
const progressSchema = z.object({
  current: z.number().int().min(0).max(1_000_000),
  status: z.string().trim().max(140).optional(),
});

type Staff = Map<string, { email: string; role: string }>;

async function myChannels(userId: string, staff: Staff) {
  const reads = await lastRead(userId);
  const channels = [
    { channel: EVERYONE, label: '# everyone' },
    ...[...staff]
      .filter(([id]) => id !== userId)
      .map(([id, s]) => ({ channel: dmChannel(userId, id), label: s.email, withUserId: id })),
  ];
  return Promise.all(channels.map(async (c) => ({ ...c, unread: await unreadIn(c.channel, userId, reads.get(c.channel)) })));
}

async function announcementsFor(userId: string, staff: Staff) {
  const list = await listAnnouncements();
  const readers = await readersOf(list.map((a) => a.announcementId));
  return list.map((a) => {
    const r = readers.get(a.announcementId) ?? new Set<string>();
    return {
      ...a,
      createdByEmail: staff.get(a.createdBy)?.email ?? 'Former staff member',
      read: r.has(userId) || a.createdBy === userId,
      readBy: [...r].filter((id) => staff.has(id) && id !== a.createdBy).length,
      // Everyone except the author.
      audience: [...staff.keys()].filter((id) => id !== a.createdBy).length,
    };
  });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const me = staffOf(event);
    const staff = await staffDirectory();
    const route = event.routeKey;
    const p = event.pathParameters ?? {};

    if (route === 'GET /admin/team/unread') {
      const [ann, chans] = await Promise.all([announcementsFor(me.userId, staff), myChannels(me.userId, staff)]);
      const announcements = ann.filter((a) => !a.read).length;
      const chat = chans.reduce((s, c) => s + c.unread, 0);
      return json(200, { announcements, chat, total: announcements + chat });
    }
    if (route === 'GET /admin/team/announcements') {
      return json(200, { announcements: await announcementsFor(me.userId, staff) });
    }
    if (route === 'POST /admin/team/announcements/{id}/read') {
      if (!p['id'] || !UUID.test(p['id'])) return badRequest('Invalid id');
      await markAnnouncementRead(p['id'], me.userId);
      return json(200, { read: true });
    }

    if (route === 'GET /admin/team/goals') {
      const month = event.queryStringParameters?.['month'] ?? currentMonth();
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return badRequest('Month must be YYYY-MM');
      const goals = await listGoals(month);
      const needsSellers = goals.some((g) => g.kind === 'auto' && g.metric === 'new_sellers');
      const joins: string[] = [];
      if (needsSellers) {
        const first = new Map<string, string>();
        for (const u of await listSellerUsers()) {
          if (u.tenantId && (!first.has(u.tenantId) || u.createdAt < first.get(u.tenantId)!)) first.set(u.tenantId, u.createdAt);
        }
        joins.push(...first.values());
      }
      const withProgress = await Promise.all(
        goals.map(async (g) => ({
          ...g,
          progress: g.kind === 'auto' && g.metric ? await autoProgress(g.metric, month, joins) : (g.current ?? 0),
          metricLabel: g.metric ? AUTO_METRICS[g.metric] : undefined,
          ownerEmail: g.ownerId ? staff.get(g.ownerId)?.email : undefined,
          updatedByEmail: staff.get(g.updatedBy)?.email,
          canUpdate: g.kind === 'manual' && (me.role === 'Admin' || g.ownerId === me.userId),
        })),
      );
      return json(200, {
        month,
        goals: withProgress,
        metrics: Object.entries(AUTO_METRICS).map(([id, label]) => ({ id, label })),
        staff: [...staff].map(([id, s]) => ({ id, ...s })),
      });
    }
    if (route === 'PUT /admin/team/goals/{id}/progress') {
      if (!p['id'] || !UUID.test(p['id'])) return badRequest('Invalid id');
      const goal = await getGoal(p['id']);
      if (!goal) return notFound('Goal not found');
      if (goal.kind !== 'manual') return badRequest('This goal counts itself.');
      if (me.role !== 'Admin' && goal.ownerId !== me.userId) return forbidden('Only the goal owner or Admin can update it.');
      const parsed = progressSchema.safeParse(readJson(event));
      if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid progress');
      const updated = {
        ...goal,
        current: parsed.data.current,
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
        updatedAt: new Date().toISOString(),
        updatedBy: me.userId,
      };
      await saveGoal(updated);
      await recordAudit({ ref: `GOAL#${goal.goalId}`, label: `Goal: ${goal.title}` }, { action: 'goal-updated', by: me.userId, byRole: me.role, detail: `${parsed.data.current} of ${goal.target}` });
      return json(200, { goal: updated });
    }

    if (route === 'GET /admin/team/chat') {
      return json(200, { channels: await myChannels(me.userId, staff), me: me.userId });
    }
    if (route.startsWith('GET /admin/team/chat/{channel}') || route.startsWith('POST /admin/team/chat/{channel}')) {
      const channel = p['channel'] ?? '';
      if (!canUseChannel(channel, me.userId, new Set(staff.keys()))) return forbidden('You cannot use this conversation.');
      if (route === 'GET /admin/team/chat/{channel}/messages') {
        const after = event.queryStringParameters?.['after'];
        if (after && !ISO.test(after)) return badRequest('Invalid time');
        const messages = await listMessages(channel, after ? { after } : {});
        return json(200, {
          messages: messages.map((m) => ({ ...m, fromEmail: staff.get(m.from)?.email ?? 'Former staff member', mine: m.from === me.userId })),
        });
      }
      if (route === 'POST /admin/team/chat/{channel}/messages') {
        const parsed = messageSchema.safeParse(readJson(event));
        if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid message');
        const m = await postMessage(channel, me.userId, parsed.data.text);
        await markChannelRead(channel, me.userId, m.at);
        return json(201, { message: { ...m, fromEmail: staff.get(me.userId)?.email, mine: true } });
      }
      if (route === 'POST /admin/team/chat/{channel}/read') {
        const at = (readJson(event) as { at?: unknown } | undefined)?.at;
        if (typeof at !== 'string' || !ISO.test(at)) return badRequest('Invalid time');
        await markChannelRead(channel, me.userId, at);
        return json(200, { read: true });
      }
    }
    return notFound();
  } catch (err) {
    console.error('Team API failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'team', action: 'read' }));
