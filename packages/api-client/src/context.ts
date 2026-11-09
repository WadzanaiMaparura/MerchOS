'use client';

import { createContext, useContext } from 'react';
import { AxiosInstance } from 'axios';

/**
 * Context providing the configured Axios instance to React Query hooks.
 * The provider should wrap the app and supply the instance from createApiClient().
 */
export const ApiClientContext = createContext<AxiosInstance | null>(null);

/**
 * Hook to access the shared Axios instance from context.
 * Throws if used outside an ApiClientProvider.
 */
export function useApiClient(): AxiosInstance {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error(
      'useApiClient must be used within an ApiClientProvider. ' +
        'Wrap your app with <ApiClientContext.Provider value={axiosInstance}>.'
    );
  }
  return client;
}

/**
 * Context providing an Axios instance pointed at the Product Intelligence API.
 *
 * The Intelligence API (`/intelligence/*`) is a SEPARATE HTTP API from the main
 * MerchOS API, with its own base URL (NEXT_PUBLIC_INTELLIGENCE_API_URL). It is
 * supplied as a distinct context so synthesis hooks target the right endpoint
 * while every other hook keeps using the main client via useApiClient().
 */
export const IntelligenceClientContext = createContext<AxiosInstance | null>(null);

/**
 * Hook to access the Intelligence API Axios instance from context.
 * Throws if used outside a provider that supplies IntelligenceClientContext.
 */
export function useIntelligenceClient(): AxiosInstance {
  const client = useContext(IntelligenceClientContext);
  if (!client) {
    throw new Error(
      'useIntelligenceClient must be used within a provider supplying ' +
        'IntelligenceClientContext (see ApiClientProvider).'
    );
  }
  return client;
}
