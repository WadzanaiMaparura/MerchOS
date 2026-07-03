'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, configureCognitoAuth } from '@merch-os/auth';

/**
 * Configure Amplify Auth against the Admin Cognito Pool.
 * Uses NEXT_PUBLIC_ADMIN_COGNITO_* env vars instead of the seller pool vars.
 * Called once at module evaluation time (client-side only via 'use client').
 */
configureCognitoAuth({
  userPoolId: process.env.NEXT_PUBLIC_ADMIN_COGNITO_USER_POOL_ID ?? '',
  userPoolClientId: process.env.NEXT_PUBLIC_ADMIN_COGNITO_CLIENT_ID ?? '',
  domain: process.env.NEXT_PUBLIC_ADMIN_COGNITO_DOMAIN ?? '',
  redirectSignIn:
    process.env.NEXT_PUBLIC_ADMIN_REDIRECT_SIGN_IN ?? 'http://localhost:3001/callback',
  redirectSignOut:
    process.env.NEXT_PUBLIC_ADMIN_REDIRECT_SIGN_OUT ?? 'http://localhost:3001/login',
});

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * App-level providers wrapper (client component).
 * Order: QueryClientProvider > AuthProvider > children
 *
 * QueryClient is configured with:
 * - retry: 3 (default retries for failed queries with exponential backoff)
 * - staleTime: 30s (data considered fresh for 30 seconds)
 *
 * AuthProvider is configured against the Admin Cognito Pool via the
 * NEXT_PUBLIC_ADMIN_COGNITO_USER_POOL_ID and NEXT_PUBLIC_ADMIN_COGNITO_CLIENT_ID
 * environment variables, isolating operator credentials from tenant users.
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
        {children}
      </AuthProvider>
    </QueryClientProvider>
  );
}
