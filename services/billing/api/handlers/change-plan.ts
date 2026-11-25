/**
 * Change Plan Lambda handler — POST /billing/plan
 *
 * Initiates a subscription / plan change by creating a PayFast hosted-checkout
 * redirect. Persists a PENDING subscription intent + a payment idempotency
 * record keyed by the generated m_payment_id, then returns the redirect URL for
 * the browser to send the seller to PayFast.
 *
 * The subscription is NOT activated here — activation happens only when the
 * PayFast ITN webhook confirms payment server-side.
 *
 * RBAC: subscription:update. tenantId comes only from the trusted JWT.
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { rbacMiddleware } from '../../../shared/middleware/rbac';
import {
  tenantContextMiddleware,
  extractTenantContext,
} from '../../../shared/middleware/tenant-context';
import { logger } from '../../../shared/middleware/logger';
import { getPlan } from '../../config/plans';
import { PayFastProvider, loadPayFastConfig } from '../../providers/payfast';
import type { PaymentProvider } from '../../providers/payment-provider';
import { createCheckoutIntent, getSubscription } from '../../services/subscription-store';
import { percentOff, resolveVoucher } from '../../services/vouchers';
import { comebackOffer, isBillingLifecycleOn } from '../../../shared/entitlements/billing-stage';
import { changePlanSchema } from '../schemas';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

let injectedProvider: PaymentProvider | undefined;

/** Test seam: inject a payment provider (overrides the production PayFast one). */
export function setPaymentProvider(provider: PaymentProvider): void {
  injectedProvider = provider;
}

async function resolveProvider(notifyUrl?: string): Promise<PaymentProvider> {
  if (injectedProvider) return injectedProvider;
  const config = await loadPayFastConfig(notifyUrl ? { notifyUrl } : {});
  return new PayFastProvider(config);
}

/**
 * Origins PayFast may send the buyer back to: ALLOWED_RETURN_ORIGINS (set by the
 * stack from the seller-dashboard origins) plus APP_BASE_URL's origin.
 */
export function allowedReturnOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const raw of (process.env['ALLOWED_RETURN_ORIGINS'] ?? '').split(',')) {
    const v = raw.trim();
    if (v) origins.add(v.replace(/\/+$/, ''));
  }
  try {
    if (process.env['APP_BASE_URL']) origins.add(new URL(process.env['APP_BASE_URL']).origin);
  } catch {
    // An invalid APP_BASE_URL simply adds nothing.
  }
  return origins;
}

/** True only for absolute http(s) URLs on an allowed origin (no userinfo tricks). */
export function isAllowedReturnUrl(url: string, allowed: Set<string>): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (parsed.username || parsed.password) return false;
  return allowed.has(parsed.origin);
}

/** Reads the seller's email from the JWT authorizer claims, if present. */
function extractEmail(event: APIGatewayProxyEventV2): string | undefined {
  const authorizer = (event.requestContext as unknown as Record<string, unknown>)?.['authorizer'] as
    | Record<string, unknown>
    | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as Record<string, unknown> | undefined;
  const email = claims?.['email'];
  return typeof email === 'string' ? email : undefined;
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const tenantContext = extractTenantContext(event as unknown as Record<string, unknown>);
  if (!tenantContext) {
    return ApiErrors.unauthorized() as APIGatewayProxyResultV2;
  }
  const { tenantId } = tenantContext;

  // Launch gate: checkout stays closed until prices are final. Deliberately
  // checked here (not only in the UI) so the API cannot be used to start a real
  // payment directly. The ITN webhook is NOT gated, so payments already in
  // flight still complete.
  if (process.env['CHECKOUT_ENABLED'] !== 'true') {
    return ApiErrors.checkoutDisabled() as APIGatewayProxyResultV2;
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return ApiErrors.validation('Invalid JSON body') as APIGatewayProxyResultV2;
  }

  const parsed = changePlanSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    return ApiErrors.validation(
      first?.message ?? 'Invalid request body',
      first?.path.join('.')
    ) as APIGatewayProxyResultV2;
  }

  const plan = getPlan(parsed.data.planId);
  if (!plan) {
    return ApiErrors.planNotFound(parsed.data.planId) as APIGatewayProxyResultV2;
  }
  if (plan.priceZARCents === null) {
    // Enterprise / custom plans are quote-based — no self-service checkout.
    return ApiErrors.planNotPurchasable(parsed.data.planId) as APIGatewayProxyResultV2;
  }

  // Email is optional (access tokens carry no email claim); if an ID-token-style
  // claim happens to be present we pass it through, otherwise PayFast collects it.
  const email = extractEmail(event);

  // Default return/cancel URLs point at the seller-dashboard billing page.
  const appBase = process.env['APP_BASE_URL'] ?? '';
  const returnUrl = parsed.data.returnUrl ?? `${appBase}/billing?checkout=success`;
  const cancelUrl = parsed.data.cancelUrl ?? `${appBase}/billing?checkout=cancelled`;

  // PayFast sends the buyer to these URLs after paying. Without this check any
  // caller could make a genuine PayFast payment page bounce to a site of their
  // choosing (open redirect / phishing). Only our own dashboard origins pass.
  const allowed = allowedReturnOrigins();
  for (const [field, url] of [['returnUrl', returnUrl], ['cancelUrl', cancelUrl]] as const) {
    if (!isAllowedReturnUrl(url, allowed)) {
      logger.warn('Checkout refused: return URL outside the allowed origins', { field });
      return ApiErrors.validation(
        `${field} must point to the MerchOS dashboard`,
        field,
      ) as APIGatewayProxyResultV2;
    }
  }

  try {
    // Price the checkout on the server. A voucher (if any) is validated and
    // applied here; the resulting amount is what PayFast is asked to charge AND
    // what the ITN is later verified against.
    const pricing = parsed.data.voucherCode
      ? await resolveVoucher(parsed.data.voucherCode, parsed.data.planId, plan.priceZARCents)
      : undefined;
    // Win-back: 50% off the first month back, applied automatically in the 14
    // days after the day-90 email, once per seller. A voucher typed in wins.
    let comeback: { discountCents: number; finalCents: number } | undefined;
    if (!pricing && isBillingLifecycleOn()) {
      const current = await getSubscription(tenantId);
      const offer = comebackOffer(current?.currentPeriodEnd, current?.comebackUsedAt);
      if (offer) comeback = percentOff(plan.priceZARCents, offer.percentOff);
    }
    const chargeCents = pricing?.finalCents ?? comeback?.finalCents ?? plan.priceZARCents;

    // The ITN notify URL is derived from the API's own domain at request time
    // (not an env var) because wiring the API URL into the Lambda's environment
    // would create a CloudFormation circular dependency (API -> Lambda -> API).
    const domainName = (event.requestContext as unknown as Record<string, unknown>)?.['domainName'];
    const notifyUrl =
      typeof domainName === 'string' ? `https://${domainName}/billing/payfast/itn` : undefined;

    const provider = await resolveProvider(notifyUrl);
    const checkout = await provider.initiateCheckout({
      tenantId,
      planId: parsed.data.planId,
      ...(email ? { email } : {}),
      returnUrl,
      cancelUrl,
      amountCents: chargeCents,
    });

    // Record the checkout INTENT (plan + expected price) under CHECKOUT#<id>.
    // Deliberately NOT written to SUBSCRIPTION#current: starting (or abandoning)
    // a checkout must never alter a tenant's live subscription. The ITN verifies
    // the posted amount against this record and only then activates the plan.
    await createCheckoutIntent(tenantId, {
      mPaymentId: checkout.mPaymentId,
      planId: parsed.data.planId,
      priceZARCents: chargeCents,
      ...(pricing
        ? {
            voucherCode: pricing.voucherCode,
            listPriceCents: pricing.listPriceCents,
            discountCents: pricing.discountCents,
          }
        : {}),
      ...(comeback
        ? { listPriceCents: plan.priceZARCents, discountCents: comeback.discountCents, offer: 'comeback' as const }
        : {}),
    });

    // NOTE: the payment idempotency record (PAYMENT#<mPaymentId>) is created by
    // the ITN handler on first confirmation (first-write-wins), NOT here.

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUrl: checkout.redirectUrl, mPaymentId: checkout.mPaymentId }),
    };
  } catch (error) {
    logger.error('Change plan failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return mapErrorToResponse(error) as APIGatewayProxyResultV2;
  }
}

export const handler = middy(baseHandler)
  .use(rbacMiddleware({ resource: 'subscription', action: 'update' }))
  .use(tenantContextMiddleware());
