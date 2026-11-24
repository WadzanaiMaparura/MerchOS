/**
 * Signed links in emails (HMAC-SHA256 with a server-only secret).
 *
 *   review       the star buttons in the review email: lets one tenant leave
 *                one review, without signing in
 *   unsubscribe  the marketing-email unsubscribe link
 *   feedback     the "why did you leave?" answers (one tenant, one answer)
 *
 * Format: <purpose>.<tenantId>.<expiresAtEpochSeconds>.<base64url signature>
 * The purpose is inside the signature, so a review link cannot be replayed as
 * an unsubscribe link (or the other way round).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type TokenPurpose = 'review' | 'unsubscribe' | 'feedback';

const PURPOSE_CODE: Record<TokenPurpose, string> = { review: 'rv', unsubscribe: 'un', feedback: 'fb' };

/** Review and "why did you leave" links stay valid for 60 days; unsubscribe links for 2 years. */
export const TOKEN_TTL_SECONDS: Record<TokenPurpose, number> = {
  review: 60 * 24 * 60 * 60,
  unsubscribe: 2 * 365 * 24 * 60 * 60,
  feedback: 60 * 24 * 60 * 60,
};

const TENANT_ID = /^[A-Za-z0-9-]{8,64}$/;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueToken(purpose: TokenPurpose, tenantId: string, secret: string, nowMs = Date.now()): string {
  if (!secret) throw new Error('Token secret is not configured');
  if (!TENANT_ID.test(tenantId)) throw new Error('Invalid tenant id');
  const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS[purpose];
  const payload = `${PURPOSE_CODE[purpose]}.${tenantId}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

export type TokenCheck = { ok: true; tenantId: string } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyToken(
  purpose: TokenPurpose,
  token: string | undefined | null,
  secret: string,
  nowMs = Date.now(),
): TokenCheck {
  if (!token || !secret || token.length > 200) return { ok: false, reason: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'invalid' };
  const [code, tenantId, expRaw, signature] = parts as [string, string, string, string];
  if (code !== PURPOSE_CODE[purpose] || !TENANT_ID.test(tenantId) || !/^\d{1,12}$/.test(expRaw)) {
    return { ok: false, reason: 'invalid' };
  }
  const expected = Buffer.from(sign(`${code}.${tenantId}.${expRaw}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  if (Number(expRaw) * 1000 < nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, tenantId };
}
