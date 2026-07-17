'use client';

/**
 * Access Denied Page — Displays when an authenticated user navigates to a route
 * their Platform_Role does not permit.
 *
 * Shows the attempted resource path (from URL search params) and provides a
 * navigation link back to the permitted dashboard area.
 *
 * Requirements: 9.1, 9.2, 9.3
 */

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

// ─── Icons ────────────────────────────────────────────────────────────────────

function ShieldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-16 w-16 text-red-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
      />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 19l-7-7m0 0l7-7m-7 7h18"
      />
    </svg>
  );
}

// ─── Access Denied Content ────────────────────────────────────────────────────

function AccessDeniedContent() {
  const searchParams = useSearchParams();
  const attemptedPath = searchParams.get('path');

  return (
    <main
      className="flex min-h-[60vh] items-center justify-center p-6"
      aria-labelledby="access-denied-heading"
    >
      <div className="max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <ShieldIcon />
        </div>

        <h1
          id="access-denied-heading"
          className="text-2xl font-bold text-gray-900"
        >
          Access Denied
        </h1>

        <p className="mt-3 text-sm text-gray-600">
          You do not have permission to access this resource.
        </p>

        {attemptedPath && (
          <p className="mt-2 text-sm text-gray-500">
            Attempted path:{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">
              {attemptedPath}
            </code>
          </p>
        )}

        <div className="mt-8">
          <Link
            href="/health"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <ArrowLeftIcon />
            Back to Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

// ─── Page Export ───────────────────────────────────────────────────────────────

export default function AccessDeniedPage() {
  return (
    <Suspense fallback={null}>
      <AccessDeniedContent />
    </Suspense>
  );
}
