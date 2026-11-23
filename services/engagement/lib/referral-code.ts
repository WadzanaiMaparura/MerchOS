/**
 * Personal referral codes: up to 6 letters of the seller's first name plus 2
 * random characters, e.g. THANDI7K. Random characters avoid look-alikes
 * (0/O, 1/I/L) so a code read aloud or retyped still works.
 */

import { randomInt } from 'node:crypto';

const SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const REFERRAL_CODE = /^[A-Z2-9]{4,12}$/;

function randomChars(n: number): string {
  let out = '';
  for (let i = 0; i < n; i++) out += SAFE[randomInt(SAFE.length)];
  return out;
}

/** A candidate code; `attempt` lengthens the random part after collisions. */
export function candidateCode(firstName: string | undefined, attempt = 0): string {
  const letters = (firstName ?? '')
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 6);
  const prefix = letters.length >= 2 ? letters : 'SELLER';
  return `${prefix}${randomChars(2 + Math.min(attempt, 4))}`;
}

/** Normalises what a visitor typed or the URL carried; null if not a code. */
export function normaliseCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return REFERRAL_CODE.test(code) ? code : null;
}
