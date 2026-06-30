'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  BillingOverview,
  InvoiceSummary,
  PaginatedResponse,
  PlanId,
} from '@merch-os/types';
import { useApiClient } from '../context';
import type { ApiError } from '../errors';

/** Query key factory for billing domain */
export const billingKeys = {
  all: ['billing'] as const,
  overview: () => [...billingKeys.all, 'overview'] as const,
  invoices: (page?: number) => [...billingKeys.all, 'invoices', page] as const,
  invoicePdf: (invoiceId: string) => [...billingKeys.all, 'pdf', invoiceId] as const,
};

export interface InvoiceListParams {
  page?: number;
  pageSize?: number;
}

export interface PlanChangePayload {
  planId: PlanId;
}

/**
 * Fetches the tenant's billing overview including plan, usage, and limits.
 * Validates: Requirements 8.1, 8.2
 */
export function useBilling() {
  const client = useApiClient();

  return useQuery<BillingOverview, ApiError>({
    queryKey: billingKeys.overview(),
    queryFn: async () => {
      const { data } = await client.get<BillingOverview>('/billing');
      return data;
    },
  });
}

/**
 * Fetches a paginated list of invoices for the tenant.
 * Default page size: 20 items.
 * Validates: Requirements 8.3
 */
export function useInvoices(params?: InvoiceListParams) {
  const client = useApiClient();
  const page = params?.page ?? 1;
  const pageSize = params?.pageSize ?? 20;

  return useQuery<PaginatedResponse<InvoiceSummary>, ApiError>({
    queryKey: billingKeys.invoices(page),
    queryFn: async () => {
      const { data } = await client.get<PaginatedResponse<InvoiceSummary>>(
        '/billing/invoices',
        {
          params: { page, pageSize },
        }
      );
      return data;
    },
  });
}

/**
 * Mutation to change the tenant's subscription plan.
 * Invalidates billing queries on success.
 * Validates: Requirements 8.6
 */
export function usePlanChange() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, PlanChangePayload>({
    mutationFn: async (payload) => {
      await client.post('/billing/plan', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}
