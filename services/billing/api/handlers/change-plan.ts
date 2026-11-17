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
import { createCheckoutIntent } from '../../services/subscription-store';
import { resolveVoucher } from '../../services/vouchers';
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
  const appBase = process.env['APP_BASE_URL'] ?? ''; // PLACEHOLDER — set to the deployed seller-dashboard origin
  const returnUrl = parsed.data.returnUrl ?? `${appBase}/billing?checkout=success`;
  const cancelUrl = parsed.data.cancelUrl ?? `${appBase}/billing?checkout=cancelled`;

  try {
    // Price the checkout on the server. A voucher (if any) is validated and
    // applied here; the resulting amount is what PayFast is asked to charge AND
    // what the ITN is later verified against.
    const pricing = parsed.data.voucherCode
      ? await resolveVoucher(parsed.data.voucherCode, parsed.data.planId, plan.priceZARCents)
      : undefined;
    const chargeCents = pricing?.finalCents ?? plan.priceZARCents;

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
