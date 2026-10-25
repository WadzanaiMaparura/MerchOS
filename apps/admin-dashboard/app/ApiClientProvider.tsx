'use client';

/**
 * ApiClientProvider — supplies the shared Axios instance (from @merch-os/api-client)
 * to all admin React Query hooks via ApiClientContext.
 *
 * Without this, every admin hook that calls useApiClient() throws. The instance
 * is created once and bridges auth to the HTTP layer:
 *  - getAccessToken: always fetches a FRESH token from Amplify (fetchAuthSession),
 *    so long-lived pages don't send a stale access token. Amplify transparently
 *    refreshes when near expiry.
 *  - onUnauthorized: when the session is irrecoverable, sign out and redirect to
 *    login.
 *
 * Base URL comes from NEXT_PUBLIC_ADMIN_API_URL (the MerchOS API Gateway base,
 * which serves /auth/* admin endpoints and the other /admin/* resources).
 */

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { ApiClientContext, createApiClient } from '@merch-os/api-client';

interface ApiClientProviderProps {
  children: React.ReactNode;
}

async function getFreshAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error('No access token available');
  }
  return token;
}

export function ApiClientProvider({ children }: ApiClientProviderProps) {
  const router = useRouter();

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: process.env.NEXT_PUBLIC_ADMIN_API_URL ?? '',
        getAccessToken: getFreshAccessToken,
        onUnauthorized: () => {
          // Session is irrecoverable — clear Cognito state and return to login.
          void signOut({ global: true }).finally(() => {
            router.replace('/login');
          });
        },
      }),
    [router]
  );

  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}
