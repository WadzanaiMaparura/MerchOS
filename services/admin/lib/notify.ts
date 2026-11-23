/** Alert emails to the alert address (admin@merchos.co.za), in the plain MerchOS layout. */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { button, escapeHtml, htmlToText, para, plainEmail, small } from '../../shared/email/plain-email';
import type { Alert } from './alerts';

let ses: SESv2Client | undefined;
/** @internal tests only */
export function _setSes(value: SESv2Client | undefined): void {
  ses = value;
}

const sast = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

export function alertEmail(alert: Alert, kind: 'opened' | 'resolved', adminUrl: string) {
  const subject = kind === 'opened' ? `MerchOS alert: ${alert.title}` : `Resolved: ${alert.title}`;
  const body =
    kind === 'opened'
      ? para(`<b>${escapeHtml(alert.title)}</b>`) +
        para(escapeHtml(alert.description)) +
        para(`<b>What to do:</b> ${escapeHtml(alert.whatToDo)}`) +
        small(`Started ${sast(alert.startedAt)} (SAST).`) +
        button('Open Alerts', `${adminUrl}/alerts`)
      : para(`<b>${escapeHtml(alert.title)}</b> is no longer happening.`) +
        small(`Started ${sast(alert.startedAt)}, cleared ${sast(alert.resolvedAt ?? alert.lastSeenAt)} (SAST).`) +
        button('Open Alerts', `${adminUrl}/alerts`);
  const html = plainEmail({ preheader: alert.description, body, signature: false });
  return { subject, html, text: htmlToText(html) };
}

export async function sendAlertEmail(alert: Alert, kind: 'opened' | 'resolved'): Promise<void> {
  const to = process.env['ALERT_EMAIL'];
  const from = process.env['ALERT_FROM_EMAIL'] || 'MerchOS Alerts <noreply@merchos.co.za>';
  if (!to) return;
  const email = alertEmail(alert, kind, (process.env['ADMIN_BASE_URL'] || 'https://admin.merchos.co.za').replace(/\/$/, ''));
  ses ??= new SESv2Client({});
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: email.html, Charset: 'UTF-8' }, Text: { Data: email.text, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}
