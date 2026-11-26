/**
 * This service's own table (merch-os-admin-<env>, platform CMK):
 *
 *   PK              SK                      item
 *   TENANT#<id>     AUDIT#<iso>#<rand>      a staff action on this customer (GSI1: AUDIT / <iso>)
 *   TENANT#<id>     STATE                   account state set by staff (disabled + by whom, why)
 *   USER#<id>       AUDIT#<iso>#<rand>      a staff action on an unfinished sign-up (no tenant yet)
 *
 * Every write here is made by a signed-in staff member and records who.
 */

import { randomBytes } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db } from './data';

export type AuditAction =
  | 'resend-verification'
  | 'disable'
  | 'enable'
  | 'exempt'
  | 'remove-exempt'
  | 'alert-resolved'
  | 'alert-note'
  | 'article-created'
  | 'article-updated'
  | 'article-deleted'
  | 'announcement-posted'
  | 'announcement-deleted'
  | 'goal-created'
  | 'goal-updated'
  | 'goal-deleted'
  | 'data-hold'
  | 'data-hold-removed'
  | 'data-deleted';

/**
 * Who/what a staff action was about: a customer, an unfinished sign-up, an
 * alert, or another record (library article, announcement, goal) by its key.
 */
export type AuditSubject =
  | { tenantId: string }
  | { userId: string }
  | { alertId: string; label: string }
  | { ref: string; label: string };

function subjectFields(subject: AuditSubject): { PK: string; fields: Record<string, string> } {
  if ('tenantId' in subject) return { PK: `TENANT#${subject.tenantId}`, fields: { tenantId: subject.tenantId } };
  if ('userId' in subject) return { PK: `USER#${subject.userId}`, fields: { userId: subject.userId } };
  if ('alertId' in subject) return { PK: `ALERT#${subject.alertId}`, fields: { alertId: subject.alertId, subjectLabel: subject.label } };
  // Own partition, so deleting the record (e.g. an announcement) never deletes its history.
  return { PK: `REF#${subject.ref}`, fields: { ref: subject.ref, subjectLabel: subject.label } };
}

export interface AuditEntry {
  at: string;
  action: AuditAction;
  by: string;
  byRole: string;
  reason?: string | undefined;
  detail?: string | undefined;
}

export async function recordAudit(subject: AuditSubject, entry: Omit<AuditEntry, 'at'>): Promise<void> {
  const at = new Date().toISOString();
  const { PK, fields } = subjectFields(subject);
  await db().send(
    new PutCommand({
      TableName: config.adminTable,
      Item: {
        PK,
        SK: `AUDIT#${at}#${randomBytes(4).toString('hex')}`,
        ...entry,
        at,
        ...fields,
        GSI1PK: 'AUDIT',
        GSI1SK: at,
      },
    }),
  );
  // Never log the reason text (it may hold personal details).
  const { label: _label, ...ids } = subject as { label?: string };
  console.info('Staff action', { ...ids, action: entry.action, by: entry.by });
}

export async function listAudit(tenantId: string, limit = 50): Promise<AuditEntry[]> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sk': 'AUDIT#' },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []).map((i) => ({
    at: String(i['at']),
    action: i['action'] as AuditAction,
    by: String(i['by']),
    byRole: String(i['byRole'] ?? ''),
    reason: typeof i['reason'] === 'string' ? i['reason'] : undefined,
    detail: typeof i['detail'] === 'string' ? i['detail'] : undefined,
  }));
}

export interface AccountState {
  disabled: boolean;
  changedAt: string;
  changedBy: string;
  reason?: string | undefined;
}

export async function getState(tenantId: string): Promise<AccountState | null> {
  const res = await db().send(
    new GetCommand({ TableName: config.adminTable, Key: { PK: `TENANT#${tenantId}`, SK: 'STATE' }, ConsistentRead: true }),
  );
  return (res.Item as AccountState | undefined) ?? null;
}

export async function putState(tenantId: string, state: AccountState): Promise<void> {
  await db().send(new PutCommand({ TableName: config.adminTable, Item: { PK: `TENANT#${tenantId}`, SK: 'STATE', ...state } }));
}
