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

    return {
      statusCode: response?.status ?? 0,
      message:
        (typeof data?.message === 'string' ? data.message : undefined) ??
        error.message ??
        'An unexpected error occurred',
      requestId:
        (typeof data?.requestId === 'string' ? data.requestId : undefined) ??
        (typeof response?.headers?.['x-request-id'] === 'string'
          ? response.headers['x-request-id']
          : '') ??
        '',
      code: typeof data?.code === 'string' ? data.code : error.code,
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
