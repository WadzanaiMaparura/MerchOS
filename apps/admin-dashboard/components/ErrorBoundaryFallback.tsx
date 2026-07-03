'use client';

/**
 * ErrorBoundaryFallback — Page-level React error boundary for the Admin App Shell.
 *
 * Wraps page content. When a child component throws, renders a fallback UI
 * with a "Reload Page" button while keeping the App Shell (sidebar + topbar)
 * fully functional.
 *
 * Requirements: 10.5
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryFallbackProps {
  children: ReactNode;
}

interface ErrorBoundaryFallbackState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundaryFallback extends Component<
  ErrorBoundaryFallbackProps,
  ErrorBoundaryFallbackState
> {
  constructor(props: ErrorBoundaryFallbackProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryFallbackState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error for debugging while keeping the App Shell intact
    console.error('[AdminDashboard] Uncaught error in page component:', error, errorInfo);
  }

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
          className="flex flex-col items-center justify-center gap-6 rounded-lg border border-red-200 bg-red-50 p-12 text-center mx-auto max-w-lg mt-16"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-14 w-14 text-red-500"
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
            <h2 className="text-xl font-semibold text-gray-900">Something went wrong</h2>
            <p className="mt-2 text-sm text-gray-600">
              {this.state.error?.message || 'An unexpected error occurred on this page.'}
            </p>
          </div>
          <button
            onClick={this.handleReload}
            className="rounded-md bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundaryFallback;
