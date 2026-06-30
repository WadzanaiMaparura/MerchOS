'use client';

import { useCallback } from 'react';
import { useErrorStore, ErrorNotificationType } from '../stores/error-store';
import { ApiError, isApiError } from '@merch-os/api-client';

/**
 * Hook providing imperative error handling functions.
 * Use this in components to display error notifications for caught errors.
 *
 * Usage:
 *   const { handleApiError, showError } = useErrorHandler();
 *   try { await apiCall(); } catch (e) { handleApiError(e); }
 */
export function useErrorHandler() {
  const addError = useErrorStore((state) => state.addError);
  const dismissError = useErrorStore((state) => state.dismissError);

  /**
   * Handle an API error and display appropriate notification.
   * HTTP 403 errors show "access denied" with no retry.
   */
  const handleApiError = useCallback(
    (error: unknown, context?: string) => {
      if (isApiError(error)) {
        const apiError = error as ApiError;

        if (apiError.statusCode === 403) {
          addError({
            type: 'access-denied',
            title: 'Access Denied',
            message: context
              ? `${context}: You do not have permission to perform this action.`
              : 'You do not have permission to perform this action.',
            allowRetry: false,
          });
          return;
        }

        if (apiError.code === 'TIMEOUT') {
          addError({
            type: 'timeout',
            title: 'Request Timed Out',
            message: context
              ? `${context}: The server did not respond in time.`
              : 'The server did not respond in time. Please try again.',
            allowRetry: true,
          });
          return;
        }

        if (apiError.statusCode === 0) {
          addError({
            type: 'network',
            title: 'Network Error',
            message: context
              ? `${context}: Unable to reach the server.`
              : 'Unable to reach the server. Please check your connection and try again.',
            allowRetry: true,
          });
          return;
        }

        addError({
          type: 'error',
          title: 'Error',
          message: context
            ? `${context}: ${apiError.message}`
            : apiError.message || 'An unexpected error occurred.',
          allowRetry: true,
        });
        return;
      }

      // Generic error fallback
      const message =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred.';

      addError({
        type: 'error',
        title: context || 'Error',
        message,
        allowRetry: true,
      });
    },
    [addError]
  );

  /**
   * Show a custom error notification.
   */
  const showError = useCallback(
    (
      title: string,
      message: string,
      options?: { type?: ErrorNotificationType; allowRetry?: boolean }
    ) => {
      return addError({
        type: options?.type ?? 'error',
        title,
        message,
        allowRetry: options?.allowRetry ?? true,
      });
    },
    [addError]
  );

  return { handleApiError, showError, dismissError };
}
