/**
 * Alerts for the support team: Web Push to every subscribed inbox browser and
 * email to the support mailbox. No SMS or WhatsApp (by decision).
 *
 * Alerts are best-effort: a failed push or email is logged and never blocks
 * the visitor's chat.
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import webpush from 'web-push';
import { config, getChatSecret } from './config';
import { deletePushSubscription, listPushSubscriptions, type Conversation } from './store';

let ses: SESv2Client | undefined;

export interface PushPayload {
  title: string;
  body: string;
  /** Path inside the admin dashboard to open on click. */
  url: string;
  /** Same tag replaces an earlier notification for the same chat. */
  tag: string;
}

/** Send a push to every subscribed agent browser. Returns how many were delivered. */
export async function pushToAgents(payload: PushPayload): Promise<number> {
  const secret = await getChatSecret();
  if (!secret.vapidPublicKey || !secret.vapidPrivateKey) {
    console.warn('Web Push skipped: VAPID keys are not set in the chat secret');
    return 0;
  }
  const subs = await listPushSubscriptions();
  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, {
          vapidDetails: {
            subject: `mailto:${config.supportEmail}`,
            publicKey: secret.vapidPublicKey!,
            privateKey: secret.vapidPrivateKey!,
          },
          TTL: 120,
          urgency: 'high',
        });
        return true;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The browser unsubscribed or the subscription expired.
        if (status === 404 || status === 410) {
          await deletePushSubscription(s.id).catch(() => undefined);
        } else {
          console.warn('Web Push failed', { status, error: (err as Error).message });
        }
        return false;
      }
    }),
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value).length;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Keep header values on one line (no header injection through visitor input). */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 120);
}

export async function emailSupport(input: {
  subject: string;
  intro: string;
  conversation: Conversation;
  message?: string;
}): Promise<void> {
  const { conversation: c } = input;
  const link = `${config.adminBaseUrl}/support?c=${encodeURIComponent(c.conversationId)}`;
  const rows: Array<[string, string]> = [
    ['Name', c.name ?? 'Not given'],
    ['Email', c.email ?? 'Not given'],
    ['Page', c.page ?? 'Unknown'],
    ['Started', new Date(c.createdAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })],
  ];
  const text = [
    input.intro,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(input.message ? ['', 'Message:', input.message] : []),
    '',
    `Open in the Support inbox: ${link}`,
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937">
<p>${escapeHtml(input.intro)}</p>
<table style="border-collapse:collapse">${rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`,
    )
    .join('')}</table>
${input.message ? `<p style="margin-top:16px;color:#6b7280">Message</p><p style="white-space:pre-wrap">${escapeHtml(input.message)}</p>` : ''}
<p style="margin-top:20px"><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none">Open in the Support inbox</a></p>
</div>`;

  ses ??= new SESv2Client({});
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: config.fromEmail,
      Destination: { ToAddresses: [config.supportEmail] },
      // Replying to the alert goes straight to the visitor.
      ...(c.email ? { ReplyToAddresses: [c.email] } : {}),
      Content: {
        Simple: {
          Subject: { Data: headerSafe(input.subject), Charset: 'UTF-8' },
          Body: { Text: { Data: text, Charset: 'UTF-8' }, Html: { Data: html, Charset: 'UTF-8' } },
        },
      },
    }),
  );
}

/** Run an alert without letting its failure break the caller. */
export async function bestEffort(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.error(`${label} failed`, { error: (err as Error).message });
  }
}
