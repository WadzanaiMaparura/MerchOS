/**
 * Return-to-destination helpers for the login flow.
 *
 * When RouteGuard sends an unauthenticated visitor to /login it appends
 * `?next=<where they were>`; the login (and MFA) pages send them back there
 * after signing in. `next` is attacker-controllable (it is a URL parameter), so
 * it is only honoured when it is a plain same-site path - never an absolute URL,
 * protocol-relative URL, or one of the auth pages themselves (redirect loops).
 */

export const NEXT_PARAM = 'next';

/** Pages that must never be a post-login destination. */
const AUTH_PATH_PREFIXES = ['/login', '/register', '/verify', '/forgot-password', '/reset-password'];

const MAX_LENGTH = 2000;
const PLACEHOLDER_ORIGIN = 'http://return-to.invalid';

/**
 * Returns a safe in-app path (`/path?query#hash`) or null if `raw` is missing or
 * unsafe.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
  // Must be a rooted path; reject protocol-relative ("//host") and backslash tricks.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  // Reject control characters / whitespace that browsers may strip or normalise.
  if (/[\u0000-\u001F\u007F\s]/.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) return null;

  const path = parsed.pathname;
  if (AUTH_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  return `${path}${parsed.search}${parsed.hash}`;
}

/** `loginPath` plus `?next=` when `current` is a safe destination. */
export function buildLoginUrl(loginPath: string, current: string): string {
  const next = safeNextPath(current);
  // The site root carries no useful destination; the default (dashboard) is fine.
  return next && next !== '/' ? `${loginPath}?${NEXT_PARAM}=${encodeURIComponent(next)}` : loginPath;
}

/** Reads and validates `?next=` from a query string such as window.location.search. */
export function readNextFromSearch(search: string): string | null {
  return safeNextPath(new URLSearchParams(search).get(NEXT_PARAM));
}
