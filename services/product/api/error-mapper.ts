import {
  ProductNotFoundError,
  ProductAlreadyExistsError,
  ProductPersistenceError,
  ProductSkuAlreadyExistsError,
  ProductValidationError,
  InvalidProductLifecycleError,
} from '../service/errors';
import { isTrialError } from '../../shared/entitlements/trial-gate';

export function mapErrorToResponse(error: unknown): { statusCode: number; body: string } {
  if (error instanceof ProductNotFoundError) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: { code: 'PRODUCT_NOT_FOUND', message: error.message } }),
    };
  }
  if (error instanceof ProductSkuAlreadyExistsError) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: { code: 'PRODUCT_SKU_ALREADY_EXISTS', message: error.message } }),
    };
  }
  if (error instanceof ProductAlreadyExistsError) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: { code: 'PRODUCT_ALREADY_EXISTS', message: error.message } }),
    };
  }
  if (error instanceof ProductValidationError) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: { code: 'PRODUCT_VALIDATION_ERROR', message: error.message, field: error.field } }),
    };
  }
  if (error instanceof InvalidProductLifecycleError) {
    return {
      statusCode: 409,
      body: JSON.stringify({ error: { code: 'INVALID_PRODUCT_LIFECYCLE', message: error.message } }),
    };
  }
  if (error instanceof ProductPersistenceError) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } }),
    };
  }
  if (isTrialError(error)) {
    // Payment Required: the free trial is not active or is used up.
    return {
      statusCode: 402,
      body: JSON.stringify({ error: { code: error.code, message: error.message } }),
    };
  }
  // Unknown error — never expose details
  return {
    statusCode: 500,
    body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }),
  };
}
