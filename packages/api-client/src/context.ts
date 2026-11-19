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

/**
 * Context providing an Axios instance pointed at the Export API.
 *
 * The Export API (`/validate`, `/export`) is a SEPARATE HTTP API from the main
 * MerchOS API, with its own base URL (NEXT_PUBLIC_EXPORT_API_URL). Supplied as a
 * distinct context so validate/export hooks target the right endpoint while
 * every other hook keeps using the main client via useApiClient().
 */
export const ExportClientContext = createContext<AxiosInstance | null>(null);

/**
 * Hook to access the Export API Axios instance from context.
 * Throws if used outside a provider that supplies ExportClientContext.
 */
export function useExportClient(): AxiosInstance {
  const client = useContext(ExportClientContext);
  if (!client) {
    throw new Error(
      'useExportClient must be used within a provider supplying ' +
        'ExportClientContext (see ApiClientProvider).'
    );
  }
  return client;
}

/**
 * Context providing an Axios instance pointed at the Billing API.
 *
 * The Billing API (`/billing`, `/billing/invoices`, `/billing/plan`) is a
 * SEPARATE HTTP API from the main MerchOS API, with its own base URL
 * (NEXT_PUBLIC_BILLING_API_URL). Supplied as a distinct context so billing hooks
 * target the right endpoint while every other hook keeps using the main client
 * via useApiClient().
 */
export const BillingClientContext = createContext<AxiosInstance | null>(null);

/**
 * Hook to access the Billing API Axios instance from context.
 * Throws if used outside a provider that supplies BillingClientContext.
 */
export function useBillingClient(): AxiosInstance {
  const client = useContext(BillingClientContext);
  if (!client) {
    throw new Error(
      'useBillingClient must be used within a provider supplying ' +
        'BillingClientContext (see ApiClientProvider).'
    );
  }
  return client;
}

// ---------------------------------------------------------------------------
// Per-service clients
//
// Each MerchOS service is a SEPARATE HTTP API with its own base URL. Previously
// only Intelligence, Export and Billing had their own client; products,
// suppliers/imports, inventory and images all fell through to the main client,
// whose base URL is the Auth API, where those routes do not exist (404). Every
// hook now uses the client for the service that actually serves its routes.
// ---------------------------------------------------------------------------

function serviceClient(name: string) {
  const context = createContext<AxiosInstance | null>(null);
  function useClient(): AxiosInstance {
    const client = useContext(context);
    if (!client) {
      throw new Error(
        `use${name}Client must be used within a provider supplying ${name}ClientContext ` +
          '(see ApiClientProvider).'
      );
    }
    return client;
  }
  return [context, useClient] as const;
}

/** Product API: /products/** (NEXT_PUBLIC_PRODUCT_API_URL). */
export const [ProductClientContext, useProductClient] = serviceClient('Product');
/** Supplier Intelligence API: /suppliers/**, /imports/** (NEXT_PUBLIC_SUPPLIER_API_URL). */
export const [SupplierClientContext, useSupplierClient] = serviceClient('Supplier');
/** Inventory API: /inventory/** (NEXT_PUBLIC_INVENTORY_API_URL). */
export const [InventoryClientContext, useInventoryClient] = serviceClient('Inventory');
/** Image Intelligence API: /v1/images/** (NEXT_PUBLIC_IMAGE_API_URL). */
export const [ImageClientContext, useImageClient] = serviceClient('Image');
