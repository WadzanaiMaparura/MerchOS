'use client';

import React, { Component, ErrorInfo, ReactNode, useCallback } from 'react';
import { ErrorBoundary } from '@merch-os/ui';
import { useFormPreservationStore } from '../../stores/form-preservation-store';

/**
 * GlobalErrorBoundary - Error boundary wrapping dashboard content with
 * fallback UI and reload button. Preserves unsaved form input across
 * error boundary reloads using sessionStorage + Zustand.
 *
 * Uses ErrorBoundary from @merch-os/ui as the base component, extending it with
 * form preservation capabilities.
 *
 * Requirements: 13.4, 13.6
 */

const SESSION_STORAGE_KEY = 'merch-os-form-preservation';

function saveFormsToSessionStorage(forms: Record<string, Record<string, unknown>>): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(forms));
  } catch {
    // sessionStorage may be unavailable or full — silently fail
  }
}

export function loadFormsFromSessionStorage(): Record<string, Record<string, unknown>> | null {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as Record<string, Record<string, unknown>>;
    }
  } catch {
    // parse failure or unavailable — silently fail
  }
  return null;
}

export function clearFormsFromSessionStorage(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // silently fail
  }
}

interface GlobalErrorBoundaryProps {
  children: ReactNode;
}

interface GlobalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Class component error boundary that wraps dashboard content.
 * Built on top of @merch-os/ui's ErrorBoundary pattern.
 * On error:
 *  1. Saves registered form data to sessionStorage for preservation
 *  2. Displays fallback UI with "Try again" and "Reload page" options
 *  3. Announces error via aria-live="assertive" for screen readers
 */
export class GlobalErrorBoundary extends Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  constructor(props: GlobalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[GlobalErrorBoundary] Unhandled exception in page component:', error, errorInfo);

    // Preserve form data to sessionStorage when error boundary catches
    const formStore = useFormPreservationStore.getState();
    const savedForms = formStore.savedForms;
    if (Object.keys(savedForms).length > 0) {
      saveFormsToSessionStorage(savedForms);
    }
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    // Save form data before reload
    const formStore = useFormPreservationStore.getState();
    const savedForms = formStore.savedForms;
    if (Object.keys(savedForms).length > 0) {
      saveFormsToSessionStorage(savedForms);
    }
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-200 bg-red-50 p-8 text-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-12 w-12 text-red-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
            <p className="mt-1 text-sm text-gray-600">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Your unsaved form data has been preserved and will be restored.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Try again
            </button>
            <button
              onClick={this.handleReload}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default GlobalErrorBoundary;
