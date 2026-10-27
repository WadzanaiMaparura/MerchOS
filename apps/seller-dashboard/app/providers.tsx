'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, configureCognitoAuth } from '@merch-os/auth';
import { ToastProvider } from '@merch-os/ui';
import { ErrorHandlingProvider } from './components/ErrorHandlingProvider';

/**
 * Configure Amplify Auth against the Seller (tenant) Cognito Pool.
 * Must run once, at module-evaluation time (client-side only via 'use client'),
 * BEFORE any AuthProvider authentication operation (login/register/session)
 * runs — otherwise Amplify's signIn/signUp throw
 * "AuthUserPoolException: Auth UserPool not configured."
 *
 * Reads the NEXT_PUBLIC_COGNITO_* env vars via defaultCognitoConfig.
 */
configureCognitoAuth();

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * App-level providers wrapper (client component).
 * Order: QueryClientProvider > AuthProvider > ToastProvider > ErrorHandlingProvider > children
 *
 * ToastProvider supplies the toast context consumed via useToast() by the
 * dashboard pages and notification bridge (@merch-os/ui). It must wrap the
 * dashboard subtree or those components throw
 * "useToast must be used within a ToastProvider".
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
        <ToastProvider>
          <ErrorHandlingProvider>
            {children}
          </ErrorHandlingProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
