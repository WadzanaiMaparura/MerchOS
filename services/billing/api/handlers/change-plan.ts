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
import { PayFastProvider } from '../../providers/payfast';
import type { PaymentProvider } from '../../providers/payment-provider';
import { upsertSubscription } from '../../services/subscription-store';
import { changePlanSchema } from '../schemas';
import { mapErrorToResponse, ApiErrors } from '../error-mapper';

let injectedProvider: PaymentProvider | undefined;

/** Test seam: inject a payment provider (overrides the production PayFast one). */
export function setPaymentProvider(provider: PaymentProvider): void {
  injectedProvider = provider;
}

function resolveProvider(): PaymentProvider {
  return injectedProvider ?? new PayFastProvider();
}

/** Reads the seller's email from the JWT authorizer claims. */
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

  const email = extractEmail(event);
  if (!email) {
    return ApiErrors.validation('No email claim present on the token') as APIGatewayProxyResultV2;
  }

  // Default return/cancel URLs point at the seller-dashboard billing page.
  const appBase = process.env['APP_BASE_URL'] ?? ''; // PLACEHOLDER — set to the deployed seller-dashboard origin
  const returnUrl = parsed.data.returnUrl ?? `${appBase}/billing?checkout=success`;
  const cancelUrl = parsed.data.cancelUrl ?? `${appBase}/billing?checkout=cancelled`;

  try {
    const provider = resolveProvider();
    const checkout = await provider.initiateCheckout({
      tenantId,
      planId: parsed.data.planId,
      email,
      returnUrl,
      cancelUrl,
    });

    // Persist a PENDING subscription intent. Status 'incomplete' until the ITN
    // confirms payment. We capture the expected price so the ITN handler can
    // verify the posted amount server-side (never trust the posted amount).
    await upsertSubscription(tenantId, {
      planId: parsed.data.planId,
      status: 'incomplete',
      provider: provider.name as 'payfast',
      providerRef: checkout.mPaymentId,
      mPaymentId: checkout.mPaymentId,
      priceZARCents: plan.priceZARCents,
    });

    // NOTE: the payment idempotency record (PAYMENT#<mPaymentId>) is created by
    // the ITN handler on first confirmation (first-write-wins), NOT here — so a
    // replayed ITN can't double-activate. The PENDING subscription intent above
    // (with the captured price) is what the ITN correlates against.

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
