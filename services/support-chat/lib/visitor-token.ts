/**
 * Visitor chat tokens.
 *
 * Website visitors have no account, so starting a chat issues a token signed
 * with a server-only secret (HMAC-SHA256). It names exactly one conversation
 * and expires, so it can read and send to that conversation only.
 *
 * Format: <conversationId>.<expiresAtEpochSeconds>.<base64url signature>
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Long enough to come back to an open chat later the same day. */
export const VISITOR_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const CONVERSATION_ID = /^[a-f0-9-]{36}$/;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueVisitorToken(
  conversationId: string,
  secret: string,
  nowMs: number = Date.now(),
): string {
  if (!secret) throw new Error('Visitor token secret is not configured');
  const exp = Math.floor(nowMs / 1000) + VISITOR_TOKEN_TTL_SECONDS;
  const payload = `${conversationId}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the conversation id the token grants, or null if it is invalid/expired. */
export function verifyVisitorToken(
  token: string | undefined | null,
  secret: string,
  nowMs: number = Date.now(),
): string | null {
  if (!token || !secret || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [conversationId, expRaw, signature] = parts as [string, string, string];
  if (!CONVERSATION_ID.test(conversationId) || !/^\d{1,12}$/.test(expRaw)) return null;

  const expected = Buffer.from(sign(`${conversationId}.${expRaw}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  if (Number(expRaw) * 1000 < nowMs) return null;
  return conversationId;
}
