/**
 * Alert actions. RBAC `alerts` update (Admin only). Both go in the Audit log.
 *
 *   POST /admin/alerts/{alertId}/resolve   { note? }
 *   POST /admin/alerts/{alertId}/notes     { note }
 *
 * If the problem is still happening, the next 15-minute check opens a new alert.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { addNote, getAlert, resolveAlert } from '../lib/alerts';
import { recordAudit } from '../lib/audit';
import { UUID, badRequest, conflict, json, notFound, readJson, serverError, staffOf, type HttpResult } from '../lib/http';

const resolveSchema = z.object({ note: z.string().trim().max(1000).optional() });
const noteSchema = z.object({ note: z.string().trim().min(1, 'Please write a note.').max(1000) });

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const alertId = event.pathParameters?.['alertId'];
    if (!alertId || !UUID.test(alertId)) return badRequest('Invalid alert id');
    const staff = staffOf(event);
    const existing = await getAlert(alertId);
    if (!existing) return notFound('Alert not found');

    switch (event.routeKey) {
      case 'POST /admin/alerts/{alertId}/resolve': {
        const parsed = resolveSchema.safeParse(readJson(event) ?? {});
        if (!parsed.success) return badRequest('Note is too long');
        const note = parsed.data.note || undefined;
        const resolved = await resolveAlert(alertId, staff.userId, note);
        if (!resolved) return conflict('This alert is already resolved.');
        await recordAudit(
          { alertId, label: existing.title },
          { action: 'alert-resolved', by: staff.userId, byRole: staff.role, reason: note },
        );
        return json(200, { alert: resolved });
      }
      case 'POST /admin/alerts/{alertId}/notes': {
        const parsed = noteSchema.safeParse(readJson(event));
        if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid note');
        const alert = await addNote(alertId, staff.userId, parsed.data.note);
        if (!alert) return notFound('Alert not found');
        await recordAudit(
          { alertId, label: existing.title },
          { action: 'alert-note', by: staff.userId, byRole: staff.role, reason: parsed.data.note },
        );
        return json(200, { alert });
      }
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Alert action failed', { route: event.routeKey, error: (err as Error).message });
    return serverError();
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'alerts', action: 'update' }));
