'use client';

/**
 * ApiClientProvider — supplies the shared Axios instance (from @merch-os/api-client)
 * to all seller React Query hooks via ApiClientContext.
 *
 * Without this, every seller hook that calls useApiClient() (billing, products,
 * dashboard, etc.) throws "useApiClient must be used within an ApiClientProvider".
 *
 *  - getAccessToken: reads the current access token from the Amplify session
 *    (no forceRefresh). We deliberately avoid a forced refresh here: a forced
 *    refresh that fails hard-redirects to /login and previously caused a
 *    post-login loop. If the token is not ready, requests fail quietly and the
 *    pages fall back to their demo/placeholder state.
 *  - onUnauthorized: clear Cognito state and return to login.
 *
 * Base URL comes from NEXT_PUBLIC_API_URL (the MerchOS API Gateway base).
 */

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import { ApiClientContext, createApiClient } from '@merch-os/api-client';

interface ApiClientProviderProps {
  children: React.ReactNode;
}

async function getAccessToken(): Promise<string> {
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
        baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
        getAccessToken,
        onUnauthorized: () => {
          void signOut({ global: true }).finally(() => {
            router.replace('/login');
          });
        },
      }),
    [router]
  );

  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}
