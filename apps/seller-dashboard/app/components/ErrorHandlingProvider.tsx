'use client';

import React, { useEffect } from 'react';
import { useOfflineDetection } from '../hooks/use-offline-detection';
import { useErrorStore } from '../stores/error-store';
import { ErrorNotificationContainer } from './ErrorNotificationContainer';
import { OfflineIndicator } from './OfflineIndicator';
import { FormPreservingErrorBoundary } from './FormPreservingErrorBoundary';
import { isApiError } from '@merch-os/api-client';

/**
 * ErrorHandlingProvider - Global error handling wrapper for the seller dashboard.
 *
 * Responsibilities:
 * 1. Wraps content area with a React Error Boundary (preserving form input)
 * 2. Renders the error notification container (max 3, auto-dismiss 8s)
 * 3. Monitors offline/online status with persistent indicator
 * 4. Listens for unhandled promise rejections to surface API errors
 * 5. Announces error messages via aria-live="assertive" region
 *
 * Requirements: 2.7, 2.8, 13.1, 13.2, 13.4, 13.5, 13.6, 14.4
 */
export function ErrorHandlingProvider({ children }: { children: React.ReactNode }) {
  // Initialize offline detection
  useOfflineDetection();

  const addError = useErrorStore((state) => state.addError);

  // Listen for unhandled promise rejections (e.g., uncaught API errors)
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;

      // Handle ApiError instances from the api-client
      if (isApiError(error)) {
        if (error.statusCode === 403) {
          addError({
            type: 'access-denied',
            title: 'Access Denied',
            message: error.message || 'You do not have permission to perform this action.',
            allowRetry: false,
          });
          event.preventDefault();
          return;
        }

        if (error.code === 'TIMEOUT') {
          addError({
            type: 'timeout',
            title: 'Request Timed Out',
            message: 'The server did not respond in time. Please try again.',
            allowRetry: true,
          });
          event.preventDefault();
          return;
        }

        if (error.statusCode === 0) {
          // Network error (no response received)
          addError({
            type: 'network',
            title: 'Network Error',
            message: error.message || 'Unable to reach the server. Please check your connection.',
            allowRetry: true,
          });
          event.preventDefault();
          return;
        }

        // Generic API error
        addError({
          type: 'error',
          title: 'Error',
          message: error.message || 'An unexpected error occurred.',
          allowRetry: true,
        });
        event.preventDefault();
        return;
      }

      // Handle generic errors that look like network failures
      if (error instanceof Error) {
        if (error.message.includes('Network Error') || error.message.includes('fetch')) {
          addError({
            type: 'network',
            title: 'Network Error',
            message: 'Unable to reach the server. Please check your connection.',
            allowRetry: true,
          });
          event.preventDefault();
          return;
        }
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [addError]);

  return (
    <>
      <FormPreservingErrorBoundary>
        {children}
      </FormPreservingErrorBoundary>
      <ErrorNotificationContainer />
    </>
  );
}

/**
 * TopBarOfflineIndicator - Export for use in the App Shell top bar.
 * Renders the offline indicator inline within the top bar when offline.
 */
export { OfflineIndicator as TopBarOfflineIndicator };
