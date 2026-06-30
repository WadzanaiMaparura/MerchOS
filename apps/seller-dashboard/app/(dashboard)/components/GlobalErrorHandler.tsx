'use client';

import React, { ReactNode, useEffect } from 'react';
import { isApiError } from '@merch-os/api-client';
import { useErrorStore } from '../../stores/error-store';
import { useFormPreservationStore } from '../../stores/form-preservation-store';
import { useOfflineDetector } from '../../../lib/offline-detector';
import { GlobalErrorBoundary, loadFormsFromSessionStorage, clearFormsFromSessionStorage } from './GlobalErrorBoundary';
import { OfflineIndicator } from './OfflineIndicator';
import { ErrorNotificationRegion } from './ErrorNotificationRegion';

// Re-export sub-components for convenience
export { GlobalErrorBoundary } from './GlobalErrorBoundary';
export { OfflineIndicator, OfflineIndicator as OfflineStatusIndicator } from './OfflineIndicator';
export { ErrorNotificationRegion } from './ErrorNotificationRegion';

// ─── Global Error Handler (Main Component) ────────────────────────────────────
// Combines all error handling functionality into a single wrapper component.
//
// Responsibilities:
// 1. Wraps content area with React Error Boundary (form-preserving, fallback + reload)
// 2. Monitors online/offline status via useOfflineDetector hook
// 3. Renders error notifications (max 3, auto-dismiss 8s, dismissible)
// 4. Handles HTTP 403 with access denied message (no retry)
// 5. Preserves unsaved form input across error boundary reloads via sessionStorage
// 6. Announces error messages via aria-live="assertive" region
//
// Requirements: 2.7, 2.8, 13.1, 13.2, 13.4, 13.5, 13.6, 14.4

export interface GlobalErrorHandlerProps {
  children: ReactNode;
}

export function GlobalErrorHandler({ children }: GlobalErrorHandlerProps) {
  // Initialize online/offline detection
  useOfflineDetector();

  // Restore form data from sessionStorage on mount
  useSessionStorageFormRestore();

  // Listen for unhandled promise rejections to surface API errors
  useUnhandledRejectionListener();

  return (
    <>
      {/* Error Boundary wrapping the content area with form preservation */}
      <GlobalErrorBoundary>
        {children}
      </GlobalErrorBoundary>

      {/* Error notification toasts + ARIA live region for announcements */}
      <ErrorNotificationRegion />
    </>
  );
}

// ─── Hooks (internal) ─────────────────────────────────────────────────────────

/**
 * Restores form data from sessionStorage into the Zustand store on mount.
 * This allows form data to survive full page reloads triggered by the error boundary.
 */
function useSessionStorageFormRestore() {
  const saveFormData = useFormPreservationStore((state) => state.saveFormData);

  useEffect(() => {
    const stored = loadFormsFromSessionStorage();
    if (stored) {
      Object.entries(stored).forEach(([key, data]) => {
        saveFormData(key, data);
      });
      // Clear sessionStorage after restoring to memory
      clearFormsFromSessionStorage();
    }
  }, [saveFormData]);
}

/**
 * Listens for unhandled promise rejections and surfaces them as error notifications.
 * Handles specific HTTP status codes:
 * - 403: Access denied (no retry) — Requirement 13.2
 * - Timeout: Request timed out
 * - Network errors: Connection issues
 */
function useUnhandledRejectionListener() {
  const addError = useErrorStore((state) => state.addError);

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason;

      if (isApiError(error)) {
        // HTTP 403: Access denied, no retry (Requirement 13.2)
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

        // Request timeout
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

        // Network error (no response)
        if (error.statusCode === 0) {
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
}

export default GlobalErrorHandler;
