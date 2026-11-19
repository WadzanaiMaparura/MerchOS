import { AxiosError } from 'axios';

/**
 * Normalized API error type used across the application.
 * All API errors are mapped to this shape for consistent handling.
 */
export interface ApiError {
  statusCode: number;
  message: string;
  requestId: string;
  code?: string;
  /** The request field the error refers to, when the API names one (validation errors). */
  field?: string;
}

/**
 * Checks if an unknown value is an ApiError.
 */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    'message' in error &&
    'requestId' in error
  );
}

/**
 * Normalizes an Axios error (or unknown error) into a consistent ApiError shape.
 */
export function normalizeError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  if (error instanceof AxiosError) {
    const response = error.response;
    const data = response?.data as Record<string, unknown> | undefined;
    // MerchOS services answer with { error: { code, message, field? } }. Older or
    // third-party responses may be flat ({ code, message }). Read the nested shape
    // first, then fall back, so the seller sees our message and the UI can branch
    // on the code instead of Axios's generic "Request failed with status code 4xx".
    const nested =
      data && typeof data['error'] === 'object' && data['error'] !== null
        ? (data['error'] as Record<string, unknown>)
        : undefined;
    const pick = (key: string): string | undefined => {
      const v = nested?.[key] ?? data?.[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const field = pick('field');

    return {
      statusCode: response?.status ?? 0,
      message: pick('message') ?? error.message ?? 'An unexpected error occurred',
      requestId:
        (typeof data?.requestId === 'string' ? data.requestId : undefined) ??
        (typeof response?.headers?.['x-request-id'] === 'string'
          ? response.headers['x-request-id']
          : '') ??
        '',
      code: pick('code') ?? error.code,
      ...(field ? { field } : {}),
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 0,
      message: error.message,
      requestId: '',
      code: 'UNKNOWN_ERROR',
    };
  }

  return {
    statusCode: 0,
    message: 'An unexpected error occurred',
    requestId: '',
    code: 'UNKNOWN_ERROR',
  };
}
