/**
 * The audit log: every staff action, newest first, from the places they are
 * recorded (all read only here):
 *
 *   admin table (GSI1 AUDIT / <time>)   Customers actions: resend verification, disable,
 *                                        enable, free unlimited on/off (with reason)
 *   engagement reviews                  approved / hidden, with who and when
 *   engagement referrals                free month marked as applied, with who and when
 *
 * Staff ids are shown as the staff member's email; customers by business name.
 */

import { ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { cognito } from './cognito';
import { config } from './config';
import { db, getTenantInfos } from './data';

type Item = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export type AuditActionType =
  | 'resend-verification'
  | 'disable'
  | 'enable'
  | 'exempt'
  | 'remove-exempt'
  | 'review-approved'
  | 'review-rejected'
  | 'free-month-applied'
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

export const AUDIT_ACTIONS: Record<AuditActionType, string> = {
  'resend-verification': 'Resent verification email',
  disable: 'Disabled account',
  enable: 'Enabled account',
  exempt: 'Gave free unlimited account',
  'remove-exempt': 'Removed free unlimited account',
  'review-approved': 'Approved review for the website',
  'review-rejected': 'Hid review',
  'free-month-applied': 'Marked referral free month applied',
  'alert-resolved': 'Resolved an alert',
  'alert-note': 'Added a note to an alert',
  'article-created': 'Added a Library article',
  'article-updated': 'Edited a Library article',
  'article-deleted': 'Deleted a Library article',
  'announcement-posted': 'Posted an announcement',
  'announcement-deleted': 'Deleted an announcement',
  'goal-created': 'Set a team goal',
  'goal-updated': 'Updated a team goal',
  'goal-deleted': 'Deleted a team goal',
  'data-hold': 'Put account data on hold (kept)',
  'data-hold-removed': 'Removed the data hold',
  'data-deleted': 'Deleted account data (retention rules)',
};

export interface AuditEvent {
  id: string;
  at: string;
  action: AuditActionType;
  label: string;
  byId: string;
  byEmail?: string | undefined;
  byRole?: string | undefined;
  tenantId?: string | undefined;
  /** Business name, or the person for an unfinished sign-up. */
  subject?: string | undefined;
  reason?: string | undefined;
  detail?: string | undefined;
}

export interface AuditQuery {
  from?: string | undefined;
  to?: string | undefined;
  action?: AuditActionType | undefined;
  staff?: string | undefined;
  q?: string | undefined;
}

/** Most recent events read from each source (newest first). */
export const MAX_EVENTS_PER_SOURCE = 1000;

async function queryIndex(table: string, pk: string, from: string, to: string): Promise<Item[]> {
  const out: Item[] = [];
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 20 && out.length < MAX_EVENTS_PER_SOURCE; page++) {
    const res = await db().send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': pk, ':from': from, ':to': to },
        ScanIndexForward: false,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    out.push(...((res.Items ?? []) as Item[]));
    startKey = res.LastEvaluatedKey;
    if (!startKey) break;
  }
  return out.slice(0, MAX_EVENTS_PER_SOURCE);
}

/** Staff user id -> { email, role } (Admin and Support groups). */
export async function staffDirectory(): Promise<Map<string, { email: string; role: string }>> {
  const out = new Map<string, { email: string; role: string }>();
  for (const role of ['Support', 'Admin']) {
    let token: string | undefined;
    for (let page = 0; page < 20; page++) {
      const res = await cognito().send(
        new ListUsersInGroupCommand({ UserPoolId: config.userPoolId, GroupName: role, Limit: 60, ...(token ? { NextToken: token } : {}) }),
      );
      for (const u of res.Users ?? []) {
        const email = u.Attributes?.find((a) => a.Name === 'email')?.Value ?? '';
        // Admin wins if someone is in both groups.
        out.set(u.Username ?? '', { email, role });
      }
      token = res.NextToken;
      if (!token) break;
    }
  }
  return out;
}

export function matchesAudit(e: AuditEvent, q: AuditQuery): boolean {
  if (q.action && e.action !== q.action) return false;
  if (q.staff && e.byId !== q.staff) return false;
  const s = q.q?.trim().toLowerCase();
  if (!s) return true;
  return [e.subject, e.byEmail, e.reason, e.detail, e.label, e.tenantId]
    .filter(Boolean)
    .some((v) => String(v).toLowerCase().includes(s));
}

export async function loadAudit(query: AuditQuery): Promise<{ events: AuditEvent[]; staff: Array<{ id: string; email: string; role: string }> }> {
  const from = query.from ?? '0000';
  const to = query.to ?? '9999';
  const [customerActions, approved, rejected, referrals, staff] = await Promise.all([
    queryIndex(config.adminTable, 'AUDIT', from, to),
    queryIndex(config.engagementTable, 'REVIEWS#APPROVED', from, to),
    queryIndex(config.engagementTable, 'REVIEWS#REJECTED', from, to),
    // Referrals are indexed by when they were claimed, not applied: read them all, filter by applied time.
    queryIndex(config.engagementTable, 'REFERRALS', '0000', '9999'),
    staffDirectory(),
  ]);

  const events: AuditEvent[] = [];
  for (const i of customerActions) {
    const action = str(i['action']) as AuditActionType | undefined;
    if (!action || !(action in AUDIT_ACTIONS)) continue;
    events.push({
      id: `${i['PK']}|${i['SK']}`,
      at: String(i['at']),
      action,
      label: AUDIT_ACTIONS[action],
      byId: String(i['by'] ?? ''),
      byRole: str(i['byRole']),
      tenantId: str(i['tenantId']),
      subject: str(i['tenantId']) ? undefined : str(i['subjectLabel']) ? (str(i['alertId']) ? `Alert: ${i['subjectLabel']}` : str(i['subjectLabel'])) : 'Unfinished sign-up',
      reason: str(i['reason']),
      detail: str(i['detail']),
    });
  }
  for (const [items, action] of [
    [approved, 'review-approved'],
    [rejected, 'review-rejected'],
  ] as const) {
    for (const r of items) {
      if (!str(r['decidedAt']) || !str(r['decidedBy'])) continue;
      events.push({
        id: `review|${r['reviewId']}|${r['decidedAt']}`,
        at: String(r['decidedAt']),
        action,
        label: AUDIT_ACTIONS[action],
        byId: String(r['decidedBy']),
        tenantId: str(r['tenantId']),
        detail: `${r['rating']} stars, shown as "${r['displayName']}"`,
      });
    }
  }
  for (const r of referrals) {
    const at = str(r['rewardAppliedAt']);
    if (!at || !str(r['rewardAppliedBy']) || at < from || at > to) continue;
    events.push({
      id: `referral|${r['referrerTenantId']}|${r['referredTenantId']}`,
      at,
      action: 'free-month-applied',
      label: AUDIT_ACTIONS['free-month-applied'],
      byId: String(r['rewardAppliedBy']),
      tenantId: str(r['referrerTenantId']),
      detail: `Code ${r['code']}`,
    });
  }

  // Business names for the customers involved.
  const tenantIds = [...new Set(events.map((e) => e.tenantId).filter((t): t is string => !!t))];
  const infos = await getTenantInfos(tenantIds.map((tenantId) => ({ tenantId })));
  // Accounts deleted by the retention rules (DELETED#<id> records, no personal data).
  const deleted = new Set(
    (await queryIndex(config.adminTable, 'DELETED', '0000', '9999')).map((d) => String(d['tenantId'])),
  );
  for (const e of events) {
    const who = staff.get(e.byId);
    // Free months applied by billing itself, not by a staff member.
    e.byEmail = who?.email ?? (e.byId === 'automatic' ? 'Automatic' : undefined);
    e.byRole = who?.role ?? e.byRole;
    // A deleted account has no name any more: the log keeps the entry, de-identified.
    if (e.tenantId) e.subject = infos.get(e.tenantId)?.businessName ?? (deleted.has(e.tenantId) ? 'Deleted account' : e.tenantId);
  }

  events.sort((a, b) => b.at.localeCompare(a.at));
  return {
    events: events.filter((e) => matchesAudit(e, query)),
    staff: [...staff].map(([id, s]) => ({ id, ...s })).sort((a, b) => a.email.localeCompare(b.email)),
  };
}
