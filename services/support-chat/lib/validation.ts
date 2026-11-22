/**
 * Input rules for chat. Plain text only: the UIs render messages as text
 * (never HTML), and we also strip control characters so nothing odd reaches
 * the inbox or the alert emails.
 */

import { z } from 'zod';

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_NAME_LENGTH = 80;
export const MAX_PAGE_LENGTH = 300;

/** Remove control characters (keeping newlines and tabs) and trim. */
export function cleanText(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E]/g, '').trim();
}

const messageText = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(1, 'Please type a message').max(MAX_MESSAGE_LENGTH, 'Messages can be up to 2,000 characters'));

const optionalName = z
  .string()
  .optional()
  .transform((v) => (v ? cleanText(v).slice(0, MAX_NAME_LENGTH) : undefined));

const optionalEmail = z
  .string()
  .optional()
  .transform((v) => (v ? cleanText(v).toLowerCase() : undefined))
  .pipe(z.string().email('Please enter a valid email address').max(254).optional());

/** Page the visitor was on, kept as a path only (no query strings). */
const page = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    const path = cleanText(v).split(/[?#]/)[0] ?? '';
    return path.startsWith('/') ? path.slice(0, MAX_PAGE_LENGTH) : undefined;
  });

/**
 * Honeypot: a field real visitors never see or fill. Bots that fill every
 * field are silently accepted and dropped.
 */
const honeypot = z.string().optional();

export const startChatSchema = z.object({
  message: messageText,
  name: optionalName,
  email: optionalEmail,
  page,
  website: honeypot,
});

export const leaveDetailsSchema = z.object({
  name: z
    .string()
    .transform(cleanText)
    .pipe(z.string().min(1, 'Please tell us your name').max(MAX_NAME_LENGTH)),
  email: z
    .string()
    .transform((v) => cleanText(v).toLowerCase())
    .pipe(z.string().email('Please enter a valid email address').max(254)),
  message: messageText,
  page,
  website: honeypot,
});

export const wsSendSchema = z.object({
  action: z.literal('send'),
  text: messageText,
  /** Agents name the conversation; visitors are bound to theirs by token. */
  conversationId: z.string().uuid().optional(),
});

export const presenceSchema = z.object({ online: z.boolean() });

export const holidaysSchema = z.object({
  holidays: z.array(z.string()).max(200),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'Push endpoints must be https'),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

/** First validation message, for a friendly 400. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request';
}
