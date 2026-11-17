/**
 * Maps billing domain/service errors to HTTP responses using the platform
 * error-envelope convention: { error: { code, message, field? } }.
 *
 * Internal/unknown errors never leak details — they collapse to a generic 500.
 * Mirrors services/inventory/api/error-mapper.ts.
 */

import { CreditLimitError } from '../services/credit-ledger';
import { VoucherError } from '../services/vouchers';

export interface ErrorBody {
  error: { code: string; message: string; field?: string };
}

export interface MappedResponse {
  statusCode: number;
  headers: { 'Content-Type': string };
  body: string;
}

function respond(statusCode: number, code: string, message: string, field?: string): MappedResponse {
  const body: ErrorBody = {
    error: { code, message, ...(field ? { field } : {}) },
  };
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Map any thrown error to a safe HTTP response.
 *
 * Known typed errors carry their own status/code. A DynamoDB
 * ConditionalCheckFailedException (tenant isolation / idempotency guard)
 * becomes a 409. Everything else collapses to a generic 500 with no detail.
 */
export function mapErrorToResponse(error: unknown): MappedResponse {
  if (error instanceof VoucherError) {
    return respond(error.status, error.code, error.message, 'voucherCode');
  }
  if (error instanceof CreditLimitError) {
    return respond(error.status, error.code, error.message);
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  ) {
    return respond(409, 'CONFLICT', 'The request conflicts with current state');
  }
  return respond(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

/** Convenience builders for API-layer (pre-service) errors. */
export const ApiErrors = {
  unauthorized: (message = 'Tenant context required'): MappedResponse =>
    respond(401, 'UNAUTHORIZED', message),
  validation: (message: string, field?: string): MappedResponse =>
    respond(400, 'VALIDATION_ERROR', message, field),
  planNotFound: (planId: string): MappedResponse =>
    respond(404, 'PLAN_NOT_FOUND', `Unknown plan: ${planId}`),
  planNotPurchasable: (planId: string): MappedResponse =>
    respond(400, 'PLAN_NOT_PURCHASABLE', `Plan ${planId} is custom/quote-based and cannot be self-checked-out`),
  subscriptionNotFound: (): MappedResponse =>
    respond(404, 'SUBSCRIPTION_NOT_FOUND', 'No subscription found for this tenant'),
};
