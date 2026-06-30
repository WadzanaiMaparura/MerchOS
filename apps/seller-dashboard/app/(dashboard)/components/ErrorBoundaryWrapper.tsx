'use client';

import React, { ReactNode, useEffect } from 'react';
import { isApiError } from '@merch-os/api-client';
import { useErrorStore } from '../../stores/error-store';
import { useFormPreservationStore } from '../../stores/form-preservation-store';
import { useOfflineDetector } from '../../../lib/offline-detector';
import {
  GlobalErrorBoundary,
  loadFormsFromSessionStorage,
  clearFormsFromSessionStorage,
} from './GlobalErrorBoundary';
import { ErrorNotificationRegion } from './ErrorNotificationRegion';

/**
 * ErrorBoundaryWrapper - Top-level error handling wrapper for the dashboard content area.
 *
 * Combines all global error handling capabilities into a single wrapper:
 * 1. React Error Boundary with fallback UI and reload option (Req 13.4)
 * 2. Error notification container: dismissible, auto-dismiss 8s, max 3 simultaneous (Req 2.7)
 * 3. HTTP 403 handling: access denied message, no retry (Req 13.2)
 * 4. Offline detection: persistent indicator, removed within 5s of reconnection (Req 13.5)
 * 5. Form input preservation across error boundary reloads via sessionStorage (Req 13.6)
 * 6. ARIA live region for error announcements (aria-live="assertive") (Req 14.4)
 *
 * Requirements: 2.7, 2.8, 13.1, 13.2, 13.4, 13.5, 13.6, 14.4
 */
export interface ErrorBoundaryWrapperProps {
  children: ReactNode;
}

export function ErrorBoundaryWrapper({ children }: ErrorBoundaryWrapperProps) {
  // Initialize online/offline detection (navigator.onLine + online/offline events)
  useOfflineDetector();

  // Restore form data from sessionStorage on mount (after error boundary reload)
  useSessionStorageFormRestore();

  // Listen for unhandled promise rejections to surface API errors as notifications
  useUnhandledRejectionListener();

  return (
    <>
      {/* Error Boundary wrapping content area with form preservation */}
      <GlobalErrorBoundary>
        {children}
      </GlobalErrorBoundary>

      {/* Error notification toasts (max 3, auto-dismiss 8s) + ARIA live region */}
      <ErrorNotificationRegion />
    </>
  );
}

// ─── Internal Hooks ───────────────────────────────────────────────────────────

/**
 * Restores form data from sessionStorage into the Zustand store on mount.
 * This allows form data to survive full page reloads triggered by the error boundary.
 *
 * Requirement 13.6: Preserve user's in-progress input so that it remains available
 * after the error is resolved or the page is reloaded via the error boundary.
 */
function useSessionStorageFormRestore() {
  const saveFormData = useFormPreservationStore((state) => state.saveFormData);

  useEffect(() => {
    const stored = loadFormsFromSessionStorage();
    if (stored) {
      Object.entries(stored).forEach(([key, data]) => {
        saveFormData(key, data);
      });
      // Clear sessionStorage after restoring to memory store
      clearFormsFromSessionStorage();
    }
  }, [saveFormData]);
}

/**
 * Listens for unhandled promise rejections and surfaces them as error notifications.
 * Handles specific HTTP status codes:
 * - 403: Access denied — no retry option (Requirement 13.2)
 * - Timeout (code TIMEOUT): Request timed out
 * - Network errors (statusCode 0): Connection issues
 *
 * Requirements: 2.7, 2.8, 13.2
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

        // Network error (no response received)
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

export default ErrorBoundaryWrapper;
