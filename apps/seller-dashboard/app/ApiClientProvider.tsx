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
 * Each MerchOS service is its own HTTP API, so each gets its own client and base
 * URL (NEXT_PUBLIC_<SERVICE>_API_URL). NEXT_PUBLIC_API_URL is the Auth API.
 * Products, suppliers/imports, inventory and images previously fell through to
 * the Auth API (where those routes 404) because they had no client of their own.
 */

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';
import {
  ApiClientContext,
  IntelligenceClientContext,
  ExportClientContext,
  BillingClientContext,
  ProductClientContext,
  SupplierClientContext,
  InventoryClientContext,
  ImageClientContext,
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

  // Separate client for the Billing API (subscriptions, credits, PayFast
  // checkout; its own base URL). Shares the same Cognito token getter and
  // unauthorized handling.
  const billingClient = useMemo(
    () =>
      createApiClient({
        baseUrl: process.env.NEXT_PUBLIC_BILLING_API_URL ?? '',
        getAccessToken,
        onUnauthorized,
      }),
    [onUnauthorized]
  );

  // One client per remaining service (same token getter and 401 handling).
  const serviceClient = (baseUrl: string | undefined) =>
    createApiClient({ baseUrl: baseUrl ?? '', getAccessToken, onUnauthorized });
  const productClient = useMemo(
    () => serviceClient(process.env.NEXT_PUBLIC_PRODUCT_API_URL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUnauthorized]
  );
  const supplierClient = useMemo(
    () => serviceClient(process.env.NEXT_PUBLIC_SUPPLIER_API_URL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUnauthorized]
  );
  const inventoryClient = useMemo(
    () => serviceClient(process.env.NEXT_PUBLIC_INVENTORY_API_URL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUnauthorized]
  );
  const imageClient = useMemo(
    () => serviceClient(process.env.NEXT_PUBLIC_IMAGE_API_URL),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onUnauthorized]
  );

  return (
    <ApiClientContext.Provider value={client}>
      <IntelligenceClientContext.Provider value={intelligenceClient}>
        <ExportClientContext.Provider value={exportClient}>
          <BillingClientContext.Provider value={billingClient}>
            <ProductClientContext.Provider value={productClient}>
              <SupplierClientContext.Provider value={supplierClient}>
                <InventoryClientContext.Provider value={inventoryClient}>
                  <ImageClientContext.Provider value={imageClient}>
                    {children}
                  </ImageClientContext.Provider>
                </InventoryClientContext.Provider>
              </SupplierClientContext.Provider>
            </ProductClientContext.Provider>
          </BillingClientContext.Provider>
        </ExportClientContext.Provider>
      </IntelligenceClientContext.Provider>
    </ApiClientContext.Provider>
  );
}
