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
import {
  ApiClientContext,
  IntelligenceClientContext,
  ExportClientContext,
  createApiClient,
} from '@merch-os/api-client';

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

  const onUnauthorized = useMemo(
    () => () => {
      void signOut({ global: true }).finally(() => {
        router.replace('/login');
      });
    },
    [router]
  );

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '',
        getAccessToken,
        onUnauthorized,
      }),
    [onUnauthorized]
  );

  // Separate client for the Product Intelligence API (its own base URL). Shares
  // the same Cognito token getter and unauthorized handling as the main client.
  const intelligenceClient = useMemo(
    () =>
      createApiClient({
        baseUrl: process.env.NEXT_PUBLIC_INTELLIGENCE_API_URL ?? '',
        getAccessToken,
        onUnauthorized,
      }),
    [onUnauthorized]
  );

  // Separate client for the Export API (validate + export pipeline, its own
  // base URL). Shares the same Cognito token getter and unauthorized handling.
  const exportClient = useMemo(
    () =>
      createApiClient({
        baseUrl: process.env.NEXT_PUBLIC_EXPORT_API_URL ?? '',
        getAccessToken,
        onUnauthorized,
      }),
    [onUnauthorized]
  );

  return (
    <ApiClientContext.Provider value={client}>
      <IntelligenceClientContext.Provider value={intelligenceClient}>
        <ExportClientContext.Provider value={exportClient}>
          {children}
        </ExportClientContext.Provider>
      </IntelligenceClientContext.Provider>
    </ApiClientContext.Provider>
  );
}
