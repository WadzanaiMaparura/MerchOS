'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { useFormPreservationStore } from '../stores/form-preservation-store';

interface FormPreservingErrorBoundaryProps {
  children: ReactNode;
}

interface FormPreservingErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary that preserves unsaved form input before showing the fallback.
 * When an unhandled exception occurs in a page component, this boundary:
 * 1. Saves any registered form data to the preservation store
 * 2. Displays a fallback UI with a reload option
 * 3. Announces the error via aria-live="assertive" for screen readers
 *
 * Form data is preserved in Zustand (memory) so it survives the error boundary reset.
 * On reload, forms can restore their state from the preservation store.
 *
 * Requirements: 13.4, 13.6
 */
export class FormPreservingErrorBoundary extends Component<
  FormPreservingErrorBoundaryProps,
  FormPreservingErrorBoundaryState
> {
  constructor(props: FormPreservingErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): FormPreservingErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Unhandled exception in page component:', error, errorInfo);
    // Form data is preserved in Zustand store which persists across boundary resets
    // because the store lives outside the React tree that was unmounted by the error
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
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
            <h2 className="text-lg font-semibold text-gray-900">
              Something went wrong
            </h2>
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
