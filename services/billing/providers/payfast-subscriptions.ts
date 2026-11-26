/**
 * PayFast Subscriptions API (card subscriptions created by checkout with
 * subscription_type=1). Used to cancel a subscription, to change the monthly
 * amount (downgrades), to move the next charge date (referral free months),
 * plus the hosted "update card" link.
 *
 * Request signing (PayFast API, version v1): every header variable
 * (merchant-id, version, timestamp) and body variable, plus the passphrase,
 * sorted ALPHABETICALLY by name, joined as name=urlencoded(value) with "&",
 * then md5 (lowercase hex). Sandbox calls add ?testing=true.
 *
 * Reference: PayFast developer docs ("API" / "Recurring Billing"). Content was
 * rephrased for compliance with licensing restrictions. Verify against the
 * PayFast sandbox before switching CARD_SUBSCRIPTIONS on.
 */

import crypto from 'node:crypto';
import { payfastUrlEncode, type PayFastConfig } from './payfast';

const API_BASE = 'https://api.payfast.co.za';
const UPDATE_CARD_BASE: Record<PayFastConfig['mode'], string> = {
  sandbox: 'https://sandbox.payfast.co.za/eng/recurring/update',
  live: 'https://www.payfast.co.za/eng/recurring/update',
};

/** PayFast tokens are UUIDs; anything else is refused before any call. */
const TOKEN = /^[a-f0-9-]{36}$/i;

export function apiSignature(vars: Record<string, string>, passphrase?: string): string {
  const all: Record<string, string> = { ...vars, ...(passphrase ? { passphrase } : {}) };
  const str = Object.keys(all)
    .sort()
    .filter((k) => all[k] !== '')
    .map((k) => `${k}=${payfastUrlEncode(all[k]!)}`)
    .join('&');
  return crypto.createHash('md5').update(str).digest('hex');
}

export interface SubscriptionsApi {
  cancel(token: string): Promise<void>;
  /** New monthly amount from the next charge on. */
  updateAmount(token: string, amountCents: number): Promise<void>;
  /** Move the next automatic charge to this date (YYYY-MM-DD, South African time). */
  setNextChargeDate(token: string, date: string): Promise<void>;
}

const RUN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PayFastSubscriptionsApi implements SubscriptionsApi {
  constructor(
    private readonly config: PayFastConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async call(method: 'PUT' | 'PATCH', token: string, action: string, body: Record<string, string> = {}): Promise<void> {
    if (!TOKEN.test(token)) throw new Error('Invalid subscription token');
    const headers = {
      'merchant-id': this.config.merchantId,
      version: 'v1',
      // PayFast wants ISO 8601 without milliseconds.
      timestamp: this.now().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    };
    const signature = apiSignature({ ...headers, ...body }, this.config.passphrase);
    const query = this.config.mode === 'sandbox' ? '?testing=true' : '';
    const res = await this.fetchFn(`${API_BASE}/subscriptions/${token}/${action}${query}`, {
      method,
      headers: { ...headers, signature, 'Content-Type': 'application/json' },
      ...(Object.keys(body).length ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      // Never log the token or the response body (may echo card details).
      throw new Error(`PayFast subscriptions ${action} failed (${res.status})`);
    }
  }

  cancel(token: string): Promise<void> {
    return this.call('PUT', token, 'cancel');
  }

  updateAmount(token: string, amountCents: number): Promise<void> {
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Invalid amount');
    return this.call('PATCH', token, 'update', { amount: String(amountCents) });
  }

  /**
   * Referral free month: the card is not charged for it, so the next charge
   * moves one month later. PayFast's update call takes `run_date` (YYYY-MM-DD).
   * Not yet verified against a live subscription (part of the PayFast live test).
   */
  setNextChargeDate(token: string, date: string): Promise<void> {
    if (!RUN_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('Invalid run date');
    return this.call('PATCH', token, 'update', { run_date: date });
  }
}

/** PayFast's hosted page where the buyer replaces the card on their subscription. */
export function cardUpdateUrl(mode: PayFastConfig['mode'], token: string, returnUrl: string): string | null {
  if (!TOKEN.test(token)) return null;
  return `${UPDATE_CARD_BASE[mode]}/${token}?return=${encodeURIComponent(returnUrl)}`;
}

/** Card subscriptions (automatic monthly charges). Off unless CARD_SUBSCRIPTIONS=true. */
export function isCardSubscriptionsOn(): boolean {
  return process.env['CARD_SUBSCRIPTIONS'] === 'true';
}
