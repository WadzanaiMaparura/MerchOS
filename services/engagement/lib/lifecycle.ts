/**
 * The lifecycle rules shared by the event and scheduled handlers.
 */

import { config, getTokenSecret } from './config';
import { sendEmail } from './mailer';
import { candidateCode } from './referral-code';
import { claimSend, getProfile, recordSent, releaseSend, reserveReferralCode, type Profile } from './store';
import type { RenderedEmail } from './templates';
import { issueToken } from './tokens';

export type EmailKey =
  | 'trial-welcome'
  | 'tips'
  | 'training'
  | 'subscription-welcome'
  | 'review-request'
  | 'referral-invite';

export const MARKETING_EMAILS: ReadonlySet<EmailKey> = new Set(['review-request', 'referral-invite']);

/** A review request goes only to sellers with at least this many products. */
export const REVIEW_MIN_PRODUCTS = 5;

export type SendOutcome = 'sent' | 'duplicate' | 'opted-out';

/**
 * Sends `key` to the tenant at most once, ever. The marker is claimed first
 * (so two concurrent deliveries cannot both send) and released if SES fails,
 * so the retry can try again.
 */
export async function sendOnce(
  profile: Profile,
  to: string,
  key: EmailKey,
  email: RenderedEmail,
  listUnsubscribeUrl?: string,
): Promise<SendOutcome> {
  if (MARKETING_EMAILS.has(key) && profile.marketingOptOut) return 'opted-out';
  if (!(await claimSend(profile.tenantId, key))) return 'duplicate';
  let messageId: string | undefined;
  try {
    messageId = await sendEmail({ to, ...email, listUnsubscribeUrl });
  } catch (error) {
    await releaseSend(profile.tenantId, key).catch(() => undefined);
    throw error;
  }
  await recordSent(profile.tenantId, key, messageId);
  // Never log the address or the content.
  console.info('Lifecycle email sent', { tenantId: profile.tenantId, key, messageId });
  return 'sent';
}

export interface UnsubscribeLinks {
  /** The page in the footer link (asks before unsubscribing). */
  page: string;
  /** RFC 8058 one-click endpoint (List-Unsubscribe header). */
  oneClick: string;
}

export async function unsubscribeLinks(tenantId: string): Promise<UnsubscribeLinks> {
  const token = encodeURIComponent(issueToken('unsubscribe', tenantId, await getTokenSecret()));
  return {
    page: `${config.siteUrl}/unsubscribe?t=${token}`,
    oneClick: `${config.apiUrl}/unsubscribe?t=${token}`,
  };
}

export async function reviewLink(tenantId: string): Promise<(rating: number) => string> {
  const token = encodeURIComponent(issueToken('review', tenantId, await getTokenSecret()));
  return (rating) => `${config.siteUrl}/review?t=${token}&r=${rating}`;
}

/** The tenant's personal referral code, created the first time it is needed. */
export async function ensureReferralCode(profile: Profile): Promise<string> {
  if (profile.referralCode) return profile.referralCode;
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await reserveReferralCode(profile.tenantId, candidateCode(profile.firstName, attempt))) {
      break;
    }
    // Either the code was taken, or a concurrent call already gave this tenant one.
    const fresh = await getProfile(profile.tenantId);
    if (fresh?.referralCode) return fresh.referralCode;
  }
  const stored = (await getProfile(profile.tenantId))?.referralCode;
  if (!stored) throw new Error('Could not create a referral code');
  return stored;
}

/** "merchos.co.za/r/THANDI7K" for display, and the full URL. */
export function referralLink(code: string): { url: string; label: string } {
  const url = `${config.siteUrl}/r/${code}`;
  return { url, label: url.replace(/^https?:\/\//, '') };
}
