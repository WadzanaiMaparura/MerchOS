/**
 * Team (Admin only). RBAC `team` update. All changes go in the Audit log.
 *
 *   POST   /admin/team/announcements              { title, body }
 *   DELETE /admin/team/announcements/{id}
 *   POST   /admin/team/goals                       { title, month, target, kind, metric?, ownerId? }
 *   PUT    /admin/team/goals/{id}                  same, plus current? / status? (manual goals)
 *   DELETE /admin/team/goals/{id}
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { recordAudit } from '../lib/audit';
import { staffDirectory } from '../lib/audit-feed';
import { UUID, badRequest, json, notFound, readJson, serverError, staffOf, type HttpResult } from '../lib/http';
import {
  AUTO_METRICS,
  deleteAnnouncement,
  deleteGoal,
  getAnnouncement,
  getGoal,
  newGoalId,
  postAnnouncement,
  saveGoal,
  type Goal,
} from '../lib/team';

const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Please add a title.').max(140),
  body: z.string().trim().min(1, 'Please write the announcement.').max(5000),
});

const goalSchema = z
  .object({
    title: z.string().trim().min(3, 'Please name the goal.').max(140),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be YYYY-MM'),
    target: z.number().int().positive('The target must be more than 0').max(1_000_000),
    kind: z.enum(['auto', 'manual']),
    metric: z.enum(Object.keys(AUTO_METRICS) as [string, ...string[]]).optional(),
    ownerId: z.string().min(1).max(128).optional(),
    current: z.number().int().min(0).max(1_000_000).optional(),
    status: z.string().trim().max(140).optional(),
  })
  .refine((g) => g.kind === 'manual' || !!g.metric, { message: 'Choose what an automatic goal counts.' });

const first = (e: z.ZodError) => e.issues[0]?.message ?? 'Invalid request';

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const staff = staffOf(event);
    const id = event.pathParameters?.['id'];
    if (event.routeKey.includes('{id}') && (!id || !UUID.test(id))) return badRequest('Invalid id');
    const audit = (ref: string, lbl: string, action: Parameters<typeof recordAudit>[1]['action']) =>
      recordAudit({ ref, label: lbl }, { action, by: staff.userId, byRole: staff.role });

    switch (event.routeKey) {
      case 'POST /admin/team/announcements': {
        const parsed = announcementSchema.safeParse(readJson(event, 12_000));
        if (!parsed.success) return badRequest(first(parsed.error));
        const a = await postAnnouncement(parsed.data.title, parsed.data.body, staff.userId);
        await audit(`ANNOUNCE#${a.announcementId}`, `Announcement: ${a.title}`, 'announcement-posted');
        return json(201, { announcement: a });
      }
      case 'DELETE /admin/team/announcements/{id}': {
        const a = await getAnnouncement(id!);
        if (!a) return notFound('Announcement not found');
        await deleteAnnouncement(id!);
        await audit(`ANNOUNCE#${id}`, `Announcement: ${a.title}`, 'announcement-deleted');
        return json(200, { deleted: true });
      }
      case 'POST /admin/team/goals':
      case 'PUT /admin/team/goals/{id}': {
        const parsed = goalSchema.safeParse(readJson(event));
        if (!parsed.success) return badRequest(first(parsed.error));
        const g = parsed.data;
        if (g.ownerId && !(await staffDirectory()).has(g.ownerId)) return badRequest('The owner must be a staff member.');
        const existing = id ? await getGoal(id) : null;
        if (id && !existing) return notFound('Goal not found');
        const now = new Date().toISOString();
        const goal: Goal = {
          goalId: existing?.goalId ?? newGoalId(),
          title: g.title,
          month: g.month,
          target: g.target,
          kind: g.kind,
          ...(g.kind === 'auto' ? { metric: g.metric as Goal['metric'] } : {}),
          ...(g.kind === 'manual' ? { current: g.current ?? existing?.current ?? 0 } : {}),
          ...(g.status ?? existing?.status ? { status: g.status ?? existing?.status } : {}),
          ...(g.ownerId ? { ownerId: g.ownerId } : {}),
          createdAt: existing?.createdAt ?? now,
          createdBy: existing?.createdBy ?? staff.userId,
          updatedAt: now,
          updatedBy: staff.userId,
        };
        await saveGoal(goal);
        await audit(`GOAL#${goal.goalId}`, `Goal: ${goal.title}`, existing ? 'goal-updated' : 'goal-created');
        return json(existing ? 200 : 201, { goal });
      }
      case 'DELETE /admin/team/goals/{id}': {
        const goal = await getGoal(id!);
        if (!goal) return notFound('Goal not found');
        await deleteGoal(id!);
        await audit(`GOAL#${id}`, `Goal: ${goal.title}`, 'goal-deleted');
        return json(200, { deleted: true });
      }
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Team change failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'team', action: 'update' }));
