/**
 * Provider-neutral payment provider abstraction.
 *
 * MerchOS billing is designed to support multiple payment providers behind a
 * single interface. The first implementation is PayFast (South Africa); others
 * (e.g. Stripe) can be added without touching the handlers.
 */

import type { PlanId } from '@merch-os/types';

/** Inputs needed to start a hosted checkout for a plan. */
export interface CheckoutRequest {
  tenantId: string;
  planId: PlanId;
  /**
   * Buyer email, if known. Optional: the API authenticates with Cognito ACCESS
   * tokens, which carry no `email` claim, and PayFast's email_address field is
   * optional. When omitted the buyer enters it on the hosted payment page.
   */
  email?: string;
  returnUrl: string;
  cancelUrl: string;
  /**
   * Server-computed amount to charge, in cents (e.g. after a voucher). When
   * omitted the plan's list price is used.
   */
  amountCents?: number;
}

/** Result of initiating checkout — where to redirect the buyer and our ref. */
export interface CheckoutResult {
  /** Fully-formed URL (incl. signed querystring) to redirect the buyer to. */
  redirectUrl: string;
  /** Our generated payment reference (PayFast m_payment_id). */
  mPaymentId: string;
}

/**
 * Result of verifying an inbound provider notification (PayFast ITN).
 * `valid` reflects signature/format validity only — business checks (amount
 * match, status COMPLETE, idempotency) are performed by the handler.
 */
export interface ItnVerificationResult {
  valid: boolean;
  mPaymentId?: string;
  amountGrossCents?: number;
  paymentStatus?: string;
  raw?: Record<string, string>;
  reason?: string;
  /**
   * True when verification could not be completed for a transient reason
   * (e.g. PayFast unreachable). The handler answers 5xx so PayFast retries.
   */
  retryable?: boolean;
}

/** A pluggable payment provider. */
export interface PaymentProvider {
  readonly name: string;
  initiateCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  verifyItn(
    rawBody: string,
    headers: Record<string, string | undefined>,
    sourceIp?: string
  ): Promise<ItnVerificationResult>;
}
