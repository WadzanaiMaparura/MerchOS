/**
 * Maps Inventory domain/service errors to HTTP responses using the Product API
 * error-envelope convention: { error: { code, message, field? } }.
 *
 * Internal/unknown errors never leak details — they collapse to a generic 500.
 */

import { InventoryServiceError } from '../service';

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
 * Typed InventoryServiceError instances carry their own `status` + `code`
 * (PRODUCT_NOT_FOUND 404, INVENTORY_NEGATIVE_STOCK 409,
 * INVENTORY_CONCURRENT_UPDATE 409, INVALID_QUANTITY 400, INVALID_SOURCE 400,
 * INTERNAL_ERROR 500). Everything else becomes a generic 500.
 */
export function mapErrorToResponse(error: unknown): MappedResponse {
  if (error instanceof InventoryServiceError) {
    // Service persistence errors are mapped to a generic message to avoid leaks.
    if (error.status >= 500) {
      return respond(error.status, error.code, 'An internal error occurred');
    }
    return respond(error.status, error.code, error.message);
  }
  return respond(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

/** Convenience builders for API-layer (pre-service) errors. */
export const ApiErrors = {
  unauthorized: (message = 'Tenant context required'): MappedResponse =>
    respond(401, 'UNAUTHORIZED', message),
  validation: (message: string, field?: string): MappedResponse =>
    respond(400, 'VALIDATION_ERROR', message, field),
  inventoryNotFound: (sku: string): MappedResponse =>
    respond(404, 'INVENTORY_NOT_FOUND', `No inventory found for SKU: ${sku}`),
  payloadTooLarge: (message = 'Request body too large'): MappedResponse =>
    respond(413, 'PAYLOAD_TOO_LARGE', message),
  csvTooManyRows: (max: number): MappedResponse =>
    respond(400, 'CSV_TOO_MANY_ROWS', `CSV exceeds the maximum of ${max} rows`),
  csvInvalidHeader: (message: string): MappedResponse =>
    respond(400, 'CSV_INVALID_HEADER', message),
};
