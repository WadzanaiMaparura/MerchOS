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
