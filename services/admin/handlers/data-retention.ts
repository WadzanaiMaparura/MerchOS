/**
 * Daily data retention job (EventBridge schedule). DATA_RETENTION:
 *
 *   off      does nothing
 *   dryrun   works out who is due and emails admin@ what it WOULD do. Sends no
 *            warnings to sellers and deletes nothing.
 *   on       warns sellers 30 days before (engagement sends the email), deletes
 *            accounts that are due and were warned, and emails admin@ a report.
 *
 * Rules: lib/retention-rules.ts. Deletion: lib/retention-purge.ts. Staff are told
 * (never automatic) about accounts disabled by staff for 12 months or more.
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { button, escapeHtml, htmlToText, para, plainEmail, small } from '../../shared/email/plain-email';
import { getState, recordAudit } from '../lib/audit';
import { listSellerUsers, type SellerUser } from '../lib/cognito';
import { config, retentionConfig } from '../lib/config';
import { batchGet, getEntitlements, getTenantInfos, mapLimit, type EntitlementInfo, type TenantInfo } from '../lib/data';
import { RetentionBlockedError, purgeTenant } from '../lib/retention-purge';
import { retentionDecision, type RetentionDecision, type RetentionReason } from '../lib/retention-rules';
import {
  clearWarning,
  finishDeletion,
  getHold,
  getRetention,
  listUnfinishedDeletions,
  markDeleting,
  recordWarning,
  type RetentionRecord,
} from '../lib/retention-store';

/** Deletions per run (the rest wait for tomorrow): keeps one run well inside the Lambda timeout. */
export const MAX_DELETIONS_PER_RUN = 10;

let events: EventBridgeClient | undefined;
let ses: SESv2Client | undefined;
/** @internal tests only */
export function _setClients(c: { events?: EventBridgeClient; ses?: SESv2Client }): void {
  events = c.events;
  ses = c.ses;
}

export interface ReportLine {
  tenantId: string;
  name: string;
  what: 'warned' | 'would-warn' | 'deleted' | 'would-delete' | 'review' | 'blocked' | 'failed';
  reason?: RetentionReason;
  /** closed since / last active / disabled since */
  since?: string;
  deleteOn?: string;
  note?: string;
}

export interface RunResult {
  mode: 'off' | 'dryrun' | 'on';
  checked: number;
  lines: ReportLine[];
  emailed: boolean;
}

interface Account {
  tenantId: string;
  info?: TenantInfo | undefined;
  entitlement?: EntitlementInfo | undefined;
  lastActiveAt?: string | undefined;
  disabledSince?: string | undefined;
  onHold: boolean;
  retention: RetentionRecord | null;
}

async function loadAccounts(tenantIds: string[]): Promise<Account[]> {
  const [infos, entitlements, activity] = await Promise.all([
    getTenantInfos(tenantIds.map((tenantId) => ({ tenantId }))),
    getEntitlements(tenantIds),
    batchGet(
      config.engagementTable,
      tenantIds.map((t) => ({ PK: `TENANT#${t}`, SK: 'ACTIVITY' })),
    ),
  ]);
  const activeBy = new Map(activity.map((a) => [String(a['PK']).slice(7), typeof a['lastActiveAt'] === 'string' ? a['lastActiveAt'] : undefined]));
  return mapLimit(tenantIds, 8, async (tenantId) => {
    const [state, hold, retention] = await Promise.all([getState(tenantId), getHold(tenantId), getRetention(tenantId)]);
    return {
      tenantId,
      info: infos.get(tenantId),
      entitlement: entitlements.get(tenantId),
      lastActiveAt: activeBy.get(tenantId),
      disabledSince: state?.disabled ? state.changedAt : undefined,
      onHold: !!hold,
      retention,
    };
  });
}

const decide = (a: Account, now: Date): RetentionDecision =>
  retentionDecision(
    {
      tenantId: a.tenantId,
      entitlement: a.entitlement,
      ...(a.disabledSince ? { disabled: { since: a.disabledSince } } : {}),
      onHold: a.onHold,
      lastActiveAt: a.lastActiveAt,
      createdAt: a.info?.createdAt,
      warnedAt: a.retention?.warnedAt,
    },
    now,
  );

async function emitWarning(tenantId: string, deleteOn: string, reason: RetentionReason): Promise<void> {
  const bus = process.env['EVENT_BUS_NAME'];
  if (!bus) throw new Error('EVENT_BUS_NAME is not configured');
  events ??= new EventBridgeClient({});
  const out = await events.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'merch-os.admin',
          DetailType: 'admin.retention.warning',
          Detail: JSON.stringify({ tenantId, deleteOn, reason }),
          EventBusName: bus,
        },
      ],
    }),
  );
  if (out.FailedEntryCount) throw new Error('EventBridge rejected the warning');
}

async function deleteOne(
  tenantId: string,
  reason: RetentionReason,
  users: SellerUser[],
  now: Date,
): Promise<{ ok: true; counts: Record<string, number> } | { ok: false; note: string; blocked: boolean }> {
  try {
    await markDeleting(tenantId, reason);
    const r = await purgeTenant(tenantId, users, now);
    await finishDeletion({ tenantId, deletedAt: new Date().toISOString(), reason, counts: r.counts, keptUntil: r.keptUntil });
    const total = Object.values(r.counts).reduce((s, n) => s + n, 0);
    await recordAudit(
      { tenantId },
      {
        action: 'data-deleted',
        by: 'automatic',
        byRole: 'System',
        reason: reason === 'closed' ? 'Closed for 12 months' : 'Not used for 12 months',
        detail: `${total} items and files removed${r.keptUntil ? `; invoices and payments kept until ${r.keptUntil.slice(0, 10)}` : ''}`,
      },
    );
    console.info('Account data deleted', { tenantId, reason, counts: r.counts });
    return { ok: true, counts: r.counts };
  } catch (error) {
    const blocked = error instanceof RetentionBlockedError;
    console.error(blocked ? 'Data deletion blocked' : 'Data deletion failed', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, blocked, note: blocked ? (error as Error).message : 'Stopped part way; it will be finished on the next run.' };
  }
}

export async function runRetention(now: Date = new Date()): Promise<RunResult> {
  const mode = retentionConfig.mode;
  if (mode === 'off') return { mode, checked: 0, lines: [], emailed: false };

  const users = await listSellerUsers();
  const lines: ReportLine[] = [];
  let deletions = 0;

  // Finish deletions that stopped part way (their sign-in accounts may already be gone).
  if (mode === 'on') {
    for (const u of await listUnfinishedDeletions()) {
      if (deletions >= MAX_DELETIONS_PER_RUN) break;
      deletions++;
      const r = await deleteOne(u.tenantId, u.reason, users, now);
      lines.push({
        tenantId: u.tenantId,
        name: 'Account being deleted',
        what: r.ok ? 'deleted' : r.blocked ? 'blocked' : 'failed',
        reason: u.reason,
        ...(r.ok ? {} : { note: r.note }),
      });
    }
  }

  const tenantIds = [...new Set(users.map((u) => u.tenantId).filter((t): t is string => !!t))];
  const accounts = await loadAccounts(tenantIds);

  for (const a of accounts) {
    const d = decide(a, now);
    const name = a.info?.businessName ?? a.tenantId;
    if (d.action === 'keep') {
      // Back in use (paid, signed in, exempt, on hold) after a warning: a later deletion needs a new warning.
      // Not when it is merely waiting out the 30 days after the warning.
      if (mode === 'on' && a.retention?.warnedAt && a.retention.state !== 'deleting' && !stillDue(a, now)) {
        await clearWarning(a.tenantId);
      }
      continue;
    }
    if (d.action === 'review') {
      lines.push({ tenantId: a.tenantId, name, what: 'review', since: d.disabledSince });
      continue;
    }
    if (d.action === 'warn') {
      if (mode === 'dryrun') {
        lines.push({ tenantId: a.tenantId, name, what: 'would-warn', reason: d.reason, since: d.since, deleteOn: d.deleteOn });
        continue;
      }
      try {
        await emitWarning(a.tenantId, d.deleteOn, d.reason);
        await recordWarning(a.tenantId, d.deleteOn, d.reason);
        lines.push({ tenantId: a.tenantId, name, what: 'warned', reason: d.reason, since: d.since, deleteOn: d.deleteOn });
      } catch (error) {
        console.error('Deletion warning not sent', { tenantId: a.tenantId, error: (error as Error).message });
        lines.push({ tenantId: a.tenantId, name, what: 'failed', reason: d.reason, note: 'The warning email could not be sent; it is tried again tomorrow.' });
      }
      continue;
    }
    // delete
    if (mode === 'dryrun') {
      lines.push({ tenantId: a.tenantId, name, what: 'would-delete', reason: d.reason, since: d.since, deleteOn: d.deleteOn });
      continue;
    }
    if (deletions >= MAX_DELETIONS_PER_RUN) continue;
    deletions++;
    const r = await deleteOne(a.tenantId, d.reason, users, now);
    lines.push({
      tenantId: a.tenantId,
      name,
      what: r.ok ? 'deleted' : r.blocked ? 'blocked' : 'failed',
      reason: d.reason,
      since: d.since,
      ...(r.ok ? {} : { note: r.note }),
    });
  }

  const emailed = await sendReport(mode, accounts.length, lines, now);
  console.info('Data retention run', { mode, checked: accounts.length, lines: lines.map((l) => l.what) });
  return { mode, checked: accounts.length, lines, emailed };
}

/** A warning stays valid only while the account would still be due within 30 days (ignoring the warning itself). */
function stillDue(a: Account, now: Date): boolean {
  const d = retentionDecision(
    {
      tenantId: a.tenantId,
      entitlement: a.entitlement,
      ...(a.disabledSince ? { disabled: { since: a.disabledSince } } : {}),
      onHold: a.onHold,
      lastActiveAt: a.lastActiveAt,
      createdAt: a.info?.createdAt,
    },
    now,
  );
  return d.action === 'warn' || d.action === 'delete';
}

// ─── Report to admin@ ────────────────────────────────────────────────────────

const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', year: 'numeric' }) : '';

const WHAT: Record<ReportLine['what'], string> = {
  warned: 'Warned (30 days)',
  'would-warn': 'Would warn',
  deleted: 'Deleted',
  'would-delete': 'Would delete',
  review: 'Disabled 12+ months: please decide',
  blocked: 'Not deleted (blocked)',
  failed: 'Problem',
};

function line(l: ReportLine): string {
  const why =
    l.what === 'review'
      ? `disabled since ${day(l.since)}`
      : l.reason === 'closed'
        ? `closed since ${day(l.since)}`
        : l.reason === 'inactive'
          ? `last used ${day(l.since)}`
          : '';
  return `<li><b>${escapeHtml(WHAT[l.what])}</b>: ${escapeHtml(l.name)}${why ? `, ${why}` : ''}${
    l.deleteOn && (l.what === 'warned' || l.what === 'would-warn' || l.what === 'would-delete') ? `, deletion on ${day(l.deleteOn)}` : ''
  }${l.note ? `. ${escapeHtml(l.note)}` : ''}</li>`;
}

/** How long the rehearsal runs before admin is reminded to switch the job on. */
export const DRY_RUN_DAYS = 30;

/** Days since the dry run started (DATA_RETENTION_DRYRUN_SINCE), or null if not set. */
export function dryRunDays(now: Date): number | null {
  const since = Date.parse(process.env['DATA_RETENTION_DRYRUN_SINCE'] ?? '');
  return Number.isNaN(since) ? null : Math.floor((now.getTime() - since) / (24 * 60 * 60 * 1000));
}

const switchOnReminder = (days: number) =>
  para(
    `<b>Reminder: the rehearsal has run for ${days} days.</b> If the lists in these emails look right, switch the job on: set <code>dataRetention</code> to <code>on</code> in infrastructure/cdk.json and deploy MerchOS-AdminApi. Until then nothing is deleted and no seller is warned, so the 12-month promise in the emails and the privacy policy is not being kept.`,
  );

export function reportEmail(
  mode: 'dryrun' | 'on',
  checked: number,
  lines: ReportLine[],
  adminUrl: string,
  remindDays: number | null = null,
) {
  const dry = mode === 'dryrun';
  const listed = lines.length ? `${lines.length} account${lines.length === 1 ? '' : 's'} listed` : 'nothing due';
  const subject = dry
    ? remindDays !== null
      ? `Data deletion: rehearsal done, ready to switch on (${listed})`
      : `Data deletion rehearsal: ${listed}`
    : `Data deletion: ${lines.length} account${lines.length === 1 ? '' : 's'} today`;
  const body =
    (dry && remindDays !== null ? switchOnReminder(remindDays) : '') +
    para(
      dry
        ? '<b>Rehearsal (dry run).</b> Nothing was deleted and no seller was emailed. This is what the job would do today.'
        : 'Today\'s data deletion run.',
    ) +
    para(`${checked} seller account${checked === 1 ? '' : 's'} checked.`) +
    (lines.length ? `<ul>${lines.map(line).join('')}</ul>` : para('Nothing is due.')) +
    small(
      'Rules: closed accounts 12 months after closing; never-paid accounts 12 months after the last sign-in; sellers are warned 30 days before. Free unlimited and accounts on hold are never deleted. Disabled accounts are only listed here, for you to decide. Invoices and payments are kept for tax law.',
    ) +
    button('Open Customers', `${adminUrl}/customers`);
  const html = plainEmail({ preheader: subject, body, signature: false });
  return { subject, html, text: htmlToText(html) };
}

async function sendReport(mode: 'dryrun' | 'on', checked: number, lines: ReportLine[], now: Date): Promise<boolean> {
  const to = process.env['ALERT_EMAIL'];
  // Every run with something to report; otherwise a short weekly note (Mondays) so silence is never ambiguous.
  const monday = new Date(now.getTime() + 2 * 60 * 60 * 1000).getUTCDay() === 1;
  // After 30 days of rehearsal: a reminder to switch on, on day 30 and in every email after it.
  const days = mode === 'dryrun' ? dryRunDays(now) : null;
  const remind = days !== null && days >= DRY_RUN_DAYS ? days : null;
  const firstReminder = remind === DRY_RUN_DAYS;
  if (!to || (!lines.length && !monday && !firstReminder)) return false;
  const email = reportEmail(mode, checked, lines, (process.env['ADMIN_BASE_URL'] || 'https://admin.merchos.co.za').replace(/\/$/, ''), remind);
  ses ??= new SESv2Client({});
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: process.env['ALERT_FROM_EMAIL'] || 'MerchOS Alerts <noreply@merchos.co.za>',
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: email.html, Charset: 'UTF-8' }, Text: { Data: email.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
  return true;
}

export async function handler(): Promise<{ mode: string; checked: number; reported: number }> {
  const r = await runRetention();
  return { mode: r.mode, checked: r.checked, reported: r.lines.length };
}
