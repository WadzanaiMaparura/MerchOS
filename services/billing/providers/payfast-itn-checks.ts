/**
 * PayFast ITN defence-in-depth checks (in addition to the MD5 signature and the
 * handler's server-side amount re-derivation):
 *
 *   1. Source-IP allowlist: the request must come from an address that one of
 *      PayFast's published hostnames resolves to.
 *   2. Server-to-server postback: POST the received payload (minus `signature`)
 *      to PayFast's /eng/query/validate and require the body "VALID".
 *
 * Failures are classified so the handler can answer correctly:
 *   - `rejected`    -> the notification is not trustworthy (final; ack 200).
 *   - `unavailable` -> we could not complete the check (DNS/network/5xx). The
 *                      notification may be genuine, so the handler returns a
 *                      5xx and PayFast retries, instead of losing a real payment.
 */
import dns from 'node:dns/promises';

export type ItnCheckOutcome =
  | { ok: true }
  | { ok: false; kind: 'rejected' | 'unavailable'; reason: string };

export interface ItnChecks {
  checkSourceIp(sourceIp: string | undefined): Promise<ItnCheckOutcome>;
  postbackValidate(rawBody: string): Promise<ItnCheckOutcome>;
}

/** Hostnames PayFast publishes for ITN delivery. */
export const PAYFAST_ITN_HOSTS = [
  'www.payfast.co.za',
  'sandbox.payfast.co.za',
  'w1w.payfast.co.za',
  'w2w.payfast.co.za',
] as const;

const VALIDATE_URL = {
  sandbox: 'https://sandbox.payfast.co.za/eng/query/validate',
  live: 'https://www.payfast.co.za/eng/query/validate',
} as const;

const IP_CACHE_TTL_MS = 10 * 60 * 1000;
const POSTBACK_TIMEOUT_MS = 5000;

export interface LiveItnChecksOptions {
  mode: 'sandbox' | 'live';
  /** Test seams. */
  resolve4?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Strips an IPv4-mapped IPv6 prefix ("::ffff:1.2.3.4" -> "1.2.3.4"). */
export function normaliseIp(ip: string): string {
  return ip.trim().replace(/^::ffff:/i, '');
}

/** Removes the `signature` field from a raw urlencoded body, keeping the rest byte-for-byte. */
export function stripSignature(rawBody: string): string {
  return rawBody
    .split('&')
    .filter((part) => part !== '' && !part.startsWith('signature='))
    .join('&');
}

export function createLiveItnChecks(options: LiveItnChecksOptions): ItnChecks {
  const resolve4 = options.resolve4 ?? ((host: string) => dns.resolve4(host));
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  let cache: { ips: Set<string>; expiresAt: number } | undefined;

  async function allowedIps(): Promise<Set<string>> {
    if (cache && cache.expiresAt > now()) return cache.ips;
    const results = await Promise.allSettled(PAYFAST_ITN_HOSTS.map((h) => resolve4(h)));
    const ips = new Set<string>();
    for (const r of results) {
      if (r.status === 'fulfilled') r.value.forEach((ip) => ips.add(ip));
    }
    if (ips.size === 0) throw new Error('could not resolve any PayFast host');
    cache = { ips, expiresAt: now() + IP_CACHE_TTL_MS };
    return ips;
  }

  return {
    async checkSourceIp(sourceIp) {
      if (!sourceIp) return { ok: false, kind: 'rejected', reason: 'missing_source_ip' };
      let ips: Set<string>;
      try {
        ips = await allowedIps();
      } catch {
        return { ok: false, kind: 'unavailable', reason: 'ip_allowlist_unavailable' };
      }
      return ips.has(normaliseIp(sourceIp))
        ? { ok: true }
        : { ok: false, kind: 'rejected', reason: 'source_ip_not_allowed' };
    },

    async postbackValidate(rawBody) {
      let res: Response;
      try {
        res = await fetchImpl(VALIDATE_URL[options.mode], {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: stripSignature(rawBody),
          signal: AbortSignal.timeout(POSTBACK_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, kind: 'unavailable', reason: 'postback_unreachable' };
      }
      if (!res.ok) return { ok: false, kind: 'unavailable', reason: `postback_http_${res.status}` };
      const text = (await res.text()).trim();
      return text === 'VALID'
        ? { ok: true }
        : { ok: false, kind: 'rejected', reason: 'postback_invalid' };
    },
  };
}
