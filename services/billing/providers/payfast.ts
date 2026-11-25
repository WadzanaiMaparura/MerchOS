/**
 * PayFast payment provider adapter (South Africa).
 *
 * Implements the provider-neutral {@link PaymentProvider} interface for PayFast
 * hosted checkout ("Custom Integration" redirect) and ITN (Instant Transaction
 * Notification) verification.
 *
 * SECURITY-SENSITIVE. The signature algorithm and verification are reproduced
 * from the PayFast spec below. Two independent rules protect against tampering:
 *   1. Signature verification (this file) — proves the payload came from PayFast
 *      (knowledge of merchant key + passphrase).
 *   2. Server-side amount check + idempotency (the ITN handler) — never trust
 *      the posted amount; it is re-derived from our own subscription intent.
 *
 * ---------------------------------------------------------------------------
 * PayFast MD5 signature algorithm (both outbound checkout and inbound ITN):
 *
 *   1. Build a parameter string by concatenating `key=value&` pairs IN ORDER:
 *        - Outbound (checkout): the EXACT order the fields are placed in the
 *          submitted form (NOT alphabetical). We control this order via
 *          CHECKOUT_FIELD_ORDER below.
 *        - Inbound (ITN): the order the fields were POSTED to us, excluding the
 *          `signature` field itself. We preserve POST order by parsing the raw
 *          urlencoded body left-to-right.
 *   2. URL-encode each VALUE using PHP urlencode() semantics:
 *        - spaces become '+'
 *        - all other reserved chars are percent-encoded with UPPERCASE hex.
 *      Keys are NOT encoded. Empty values are omitted entirely.
 *   3. Trim the trailing '&'.
 *   4. If a passphrase is configured, append `&passphrase=<urlencoded passphrase>`.
 *   5. signature = md5(parameterString) as lowercase hex.
 *
 * Reference: PayFast developer docs ("Custom Integration" / "Confirm the
 * payment" signature section). Content was rephrased for compliance with
 * licensing restrictions.
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

import type {
  CheckoutRequest,
  CheckoutResult,
  ItnVerificationResult,
  PaymentProvider,
} from './payment-provider';
import { getPlan, centsToDecimalString } from '../config/plans';
import type { ItnChecks } from './payfast-itn-checks';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type PayFastMode = 'sandbox' | 'live';

export interface PayFastConfig {
  merchantId: string;
  merchantKey: string;
  /** Optional passphrase. If set it MUST be included in the signature. */
  passphrase?: string;
  mode: PayFastMode;
  /** Absolute URL PayFast POSTs the ITN to (our webhook). */
  notifyUrl: string;
}

/** PayFast process (redirect) endpoints. */
const PROCESS_URL: Record<PayFastMode, string> = {
  sandbox: 'https://sandbox.payfast.co.za/eng/process',
  live: 'https://www.payfast.co.za/eng/process',
};

/**
 * The EXACT field order PayFast expects for the checkout signature. The
 * signature must be computed over the fields in this order, and the same order
 * is used to build the redirect querystring.
 */
const CHECKOUT_FIELD_ORDER = [
  // Merchant details
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  // Customer details — PayFast's documented order puts these BEFORE the
  // transaction details. Getting this wrong yields "generated signature does
  // not match submitted signature" on the hosted page.
  'email_address',
  // Transaction details
  'm_payment_id',
  'amount',
  'item_name',
  // custom_str1 carries our tenantId. PayFast echoes it back on the ITN so the
  // webhook (which has no JWT) can locate the correct tenant partition.
  'custom_str1',
  // Recurring billing (card subscriptions). PayFast's documented order puts
  // these last. Blank for once-off payments, so they drop out of both the
  // signature and the redirect.
  'subscription_type',
  'billing_date',
  'recurring_amount',
  'frequency',
  'cycles',
] as const;

/** PayFast frequency code for monthly billing; 0 cycles = until cancelled. */
export const PAYFAST_MONTHLY = '3';
export const PAYFAST_UNTIL_CANCELLED = '0';

/** Shape of the JSON stored in the PayFast Secrets Manager secret. */
interface PayFastSecretPayload {
  merchantId?: string;
  merchantKey?: string;
  passphrase?: string;
}

/** Module-level cache so warm invocations don't re-fetch the secret. */
let cachedSecret: PayFastSecretPayload | undefined;

/** Test seam: clear the cached secret. */
export function resetPayFastSecretCache(): void {
  cachedSecret = undefined;
}

/**
 * Loads PayFast config for production use.
 *
 * Merchant credentials (merchantId, merchantKey, passphrase) are read from the
 * Secrets Manager secret named by PAYFAST_SECRET_ARN so they never appear in
 * Lambda environment variables or the CloudFormation template. Non-secret
 * settings (mode, notify URL) come from env. When PAYFAST_SECRET_ARN is unset
 * (local dev / unit tests) it falls back to plain env vars.
 *
 * `overrides` lets a handler supply request-derived values — notably the
 * notify URL, which is built from the API's own domain at request time to avoid
 * a CloudFormation circular dependency between the Lambda and the HTTP API.
 */
export async function loadPayFastConfig(
  overrides: Partial<PayFastConfig> = {}
): Promise<PayFastConfig> {
  const base = loadPayFastConfigFromEnv();
  const secretArn = process.env['PAYFAST_SECRET_ARN'];

  let merged: PayFastConfig = base;
  if (secretArn) {
    if (!cachedSecret) {
      const sm = new SecretsManagerClient({ region: process.env['AWS_REGION'] ?? 'eu-west-1' });
      const res = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
      cachedSecret = JSON.parse(res.SecretString ?? '{}') as PayFastSecretPayload;
    }
    merged = {
      ...base,
      merchantId: cachedSecret.merchantId ?? base.merchantId,
      merchantKey: cachedSecret.merchantKey ?? base.merchantKey,
      ...(cachedSecret.passphrase ? { passphrase: cachedSecret.passphrase } : {}),
    };
  }

  const config: PayFastConfig = { ...merged, ...overrides };
  if (!config.merchantId || !config.merchantKey) {
    throw new Error('PayFast merchant credentials are not configured');
  }
  return config;
}

/** Reads PayFast config from environment variables. */
export function loadPayFastConfigFromEnv(): PayFastConfig {
  const mode = (process.env['PAYFAST_MODE'] as PayFastMode) ?? 'sandbox'; // PLACEHOLDER — default to sandbox until live creds confirmed
  const passphrase = process.env['PAYFAST_PASSPHRASE'];
  return {
    merchantId: process.env['PAYFAST_MERCHANT_ID'] ?? '',
    merchantKey: process.env['PAYFAST_MERCHANT_KEY'] ?? '',
    ...(passphrase ? { passphrase } : {}),
    mode,
    notifyUrl: process.env['PAYFAST_NOTIFY_URL'] ?? '',
  };
}

// ---------------------------------------------------------------------------
// URL-encoding + signature helpers (unit-testable in isolation)
// ---------------------------------------------------------------------------

/**
 * PHP urlencode()-compatible encoder.
 *
 * encodeURIComponent() differs from PHP urlencode() in two ways PayFast cares
 * about: it does NOT turn spaces into '+', and it leaves !*'()~ unescaped. We
 * normalise to the PHP behaviour so our signature matches PayFast's.
 */
export function payfastUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    // Percent-encode the chars encodeURIComponent leaves alone that PHP encodes.
    .replace(/[!*'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Builds the signature parameter string from ordered key/value pairs.
 * Empty values are skipped (matches PayFast behaviour of omitting blank fields).
 * Appends the passphrase last if provided.
 */
export function buildSignatureString(
  orderedPairs: Array<[string, string]>,
  passphrase?: string
): string {
  const parts: string[] = [];
  for (const [key, value] of orderedPairs) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${payfastUrlEncode(value)}`);
  }
  let str = parts.join('&');
  if (passphrase !== undefined && passphrase !== '') {
    str += `&passphrase=${payfastUrlEncode(passphrase)}`;
  }
  return str;
}

/** Computes the lowercase-hex MD5 signature over ordered pairs. */
export function computeSignature(
  orderedPairs: Array<[string, string]>,
  passphrase?: string
): string {
  const str = buildSignatureString(orderedPairs, passphrase);
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Computes the signature PayFast puts on an ITN. Unlike the checkout signature
 * (which omits blank fields), PayFast signs EVERY posted field - including ones
 * with empty values - in posted order, excluding `signature` itself. Applying
 * the checkout rule here made real notifications fail verification.
 */
export function computeItnSignature(
  orderedPairs: Array<[string, string]>,
  passphrase?: string
): string {
  let str = orderedPairs.map(([k, v]) => `${k}=${payfastUrlEncode(v)}`).join('&');
  if (passphrase !== undefined && passphrase !== '') {
    str += `&passphrase=${payfastUrlEncode(passphrase)}`;
  }
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Parses a urlencoded body into ordered [key, value] pairs, preserving the
 * original POST order. PayFast ITN signature must be verified in POST order, so
 * we cannot use URLSearchParams iteration guarantees loosely — we split the raw
 * body ourselves and decode `+` as space and percent-escapes.
 */
export function parseUrlEncodedOrdered(rawBody: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (!rawBody) return pairs;
  for (const segment of rawBody.split('&')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    const rawKey = eq === -1 ? segment : segment.slice(0, eq);
    const rawVal = eq === -1 ? '' : segment.slice(eq + 1);
    const key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
    const val = decodeURIComponent(rawVal.replace(/\+/g, ' '));
    pairs.push([key, val]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class PayFastProvider implements PaymentProvider {
  readonly name = 'payfast';
  private readonly config: PayFastConfig;

  /**
   * @param itnChecks Optional source-IP + server postback checks. Production
   *   wiring passes `createLiveItnChecks`; omitted in unit tests, where the
   *   signature check alone is exercised.
   */
  constructor(
    config?: PayFastConfig,
    private readonly itnChecks?: ItnChecks,
  ) {
    this.config = config ?? loadPayFastConfigFromEnv();
  }

  async initiateCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const plan = getPlan(req.planId);
    if (plan.priceZARCents === null) {
      // Enterprise / custom plans are quote-based and cannot self-checkout.
      throw new Error(`Plan ${req.planId} has no self-service price (custom/enterprise)`);
    }

    const mPaymentId = crypto.randomUUID();
    const amount = centsToDecimalString(req.amountCents ?? plan.priceZARCents);
    if (req.recurring && !/^\d{4}-\d{2}-\d{2}$/.test(req.recurring.billingDate)) {
      throw new Error('Recurring billing date must be YYYY-MM-DD');
    }

    // Build the field map in the EXACT required order (see CHECKOUT_FIELD_ORDER).
    const values: Record<(typeof CHECKOUT_FIELD_ORDER)[number], string> = {
      merchant_id: this.config.merchantId,
      merchant_key: this.config.merchantKey,
      return_url: req.returnUrl,
      cancel_url: req.cancelUrl,
      notify_url: this.config.notifyUrl,
      m_payment_id: mPaymentId,
      amount,
      item_name: plan.name,
      // Empty string is skipped by both the signature and the querystring.
      email_address: req.email ?? '',
      custom_str1: req.tenantId,
      // Card subscription fields (blank = once-off payment).
      subscription_type: req.recurring ? '1' : '',
      billing_date: req.recurring?.billingDate ?? '',
      recurring_amount: req.recurring ? centsToDecimalString(req.recurring.recurringAmountCents) : '',
      frequency: req.recurring ? PAYFAST_MONTHLY : '',
      cycles: req.recurring ? PAYFAST_UNTIL_CANCELLED : '',
    };

    const orderedPairs = CHECKOUT_FIELD_ORDER.map(
      (k) => [k, values[k]] as [string, string]
    );

    const signature = computeSignature(orderedPairs, this.config.passphrase);

    // The redirect querystring uses the same order plus the signature last.
    const query = orderedPairs
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${k}=${payfastUrlEncode(v)}`)
      .concat([`signature=${signature}`])
      .join('&');

    const redirectUrl = `${PROCESS_URL[this.config.mode]}?${query}`;

    return { redirectUrl, mPaymentId };
  }

  async verifyItn(
    rawBody: string,
    _headers: Record<string, string | undefined>,
    sourceIp?: string
  ): Promise<ItnVerificationResult> {
    const ordered = parseUrlEncodedOrdered(rawBody);

    // Extract posted signature and build a flat map for business reads.
    const raw: Record<string, string> = {};
    let postedSignature: string | undefined;
    const pairsForSig: Array<[string, string]> = [];
    for (const [key, value] of ordered) {
      raw[key] = value;
      if (key === 'signature') {
        postedSignature = value;
        continue; // the signature field is excluded from the recomputation
      }
      pairsForSig.push([key, value]);
    }

    if (!postedSignature) {
      return { valid: false, raw, reason: 'missing_signature' };
    }

    // (a) Recompute the signature over the posted fields in POST order.
    // Primary: PayFast's ITN rule (blank fields included). Fallback: the
    // blank-fields-omitted form, which is identical when no field is blank.
    const signatureValid =
      timingSafeEqualHex(computeItnSignature(pairsForSig, this.config.passphrase), postedSignature) ||
      timingSafeEqualHex(computeSignature(pairsForSig, this.config.passphrase), postedSignature);

    if (!signatureValid) {
      return { valid: false, raw, reason: 'signature_mismatch' };
    }

    // (a2) Defence in depth: source-IP allowlist, then server-to-server postback.
    // Both run only after the signature passed, so unauthenticated callers cannot
    // make us issue DNS lookups or outbound requests.
    if (this.itnChecks) {
      const ipCheck = await this.itnChecks.checkSourceIp(sourceIp);
      if (!ipCheck.ok) {
        return {
          valid: false,
          raw,
          reason: ipCheck.reason,
          ...(ipCheck.kind === 'unavailable' ? { retryable: true } : {}),
        };
      }
      const postback = await this.itnChecks.postbackValidate(rawBody);
      if (!postback.ok) {
        return {
          valid: false,
          raw,
          reason: postback.reason,
          ...(postback.kind === 'unavailable' ? { retryable: true } : {}),
        };
      }
    }
    // (b) Surface gross amount (in cents) and payment status for the handler.
    const amountGross = raw['amount_gross'];
    const amountGrossCents =
      amountGross !== undefined ? decimalStringToCents(amountGross) : undefined;

    const result: ItnVerificationResult = {
      valid: true,
      raw,
    };
    if (raw['m_payment_id'] !== undefined) result.mPaymentId = raw['m_payment_id'];
    if (amountGrossCents !== undefined) result.amountGrossCents = amountGrossCents;
    if (raw['payment_status'] !== undefined) result.paymentStatus = raw['payment_status'];
    // Card subscriptions: the card token, and PayFast's own id for THIS charge
    // (every monthly charge has a new one; m_payment_id stays the first one's).
    if (raw['token']) result.token = raw['token'];
    if (raw['pf_payment_id']) result.pfPaymentId = raw['pf_payment_id'];
    return result;
  }
}

/** Timing-safe comparison of two hex strings of equal length. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Converts a PayFast decimal amount string (e.g. "499.00") to integer cents.
 * Returns undefined for malformed input rather than throwing.
 */
export function decimalStringToCents(decimal: string): number | undefined {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal.trim());
  if (!m) return undefined;
  const rands = Number(m[1]);
  const fraction = (m[2] ?? '').padEnd(2, '0');
  const cents = Number(fraction);
  return rands * 100 + cents;
}
