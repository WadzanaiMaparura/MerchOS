/**
 * Sends lifecycle email through SES (from info@, replies to info@).
 *
 * Marketing emails (review request, referral) carry RFC 8058 one-click
 * unsubscribe headers, so Gmail/Outlook show their own "Unsubscribe" button,
 * which POSTs straight to our API.
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config } from './config';

let ses: SESv2Client | undefined;

/** @internal tests only */
export function _setSes(value: SESv2Client | undefined): void {
  ses = value;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One-click unsubscribe endpoint (marketing only). */
  listUnsubscribeUrl?: string | undefined;
}

export async function sendEmail(email: OutgoingEmail): Promise<string | undefined> {
  ses ??= new SESv2Client({});
  const out = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: config.fromEmail,
      ReplyToAddresses: [config.supportEmail],
      Destination: { ToAddresses: [email.to] },
      Content: {
        Simple: {
          Subject: { Data: email.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: email.html, Charset: 'UTF-8' },
            Text: { Data: email.text, Charset: 'UTF-8' },
          },
          ...(email.listUnsubscribeUrl
            ? {
                Headers: [
                  { Name: 'List-Unsubscribe', Value: `<${email.listUnsubscribeUrl}>` },
                  { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
                ],
              }
            : {}),
        },
      },
    }),
  );
  return out.MessageId;
}
