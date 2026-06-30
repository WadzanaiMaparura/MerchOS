'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@merch-os/auth';
import { ErrorHandlingProvider } from './components/ErrorHandlingProvider';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * App-level providers wrapper (client component).
 * Order: QueryClientProvider > AuthProvider > ErrorHandlingProvider > children
 *
 * QueryClient is configured with:
 * - retry: 3 (default retries for failed queries)
 * - staleTime: 30s (data considered fresh for 30 seconds)
 *
 * ErrorHandlingProvider wraps content with:
 * - Error Boundary (form-preserving, fallback UI with reload)
 * - Error notification container (max 3, auto-dismiss 8s)
 * - Offline detection
 * - aria-live assertive announcements
 */
export function Providers({ children }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 3,
            staleTime: 30 * 1000, // 30 seconds
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ErrorHandlingProvider>
          {children}
        </ErrorHandlingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
