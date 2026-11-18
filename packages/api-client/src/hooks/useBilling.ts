'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  BillingOverview,
  InvoiceSummary,
  PaginatedResponse,
  PlanId,
} from '@merch-os/types';
import { useBillingClient } from '../context';
import type { ApiError } from '../errors';

/** Query key factory for billing domain */
export const billingKeys = {
  all: ['billing'] as const,
  overview: () => [...billingKeys.all, 'overview'] as const,
  invoices: (page?: number) => [...billingKeys.all, 'invoices', page] as const,
  invoicePdf: (invoiceId: string) => [...billingKeys.all, 'pdf', invoiceId] as const,
  profile: () => [...billingKeys.all, 'profile'] as const,
};

export interface InvoiceListParams {
  page?: number;
  pageSize?: number;
}

export interface PlanChangePayload {
  planId: PlanId;
  /** Optional discount voucher. The server prices it; the client never sends an amount. */
  voucherCode?: string;
  /** Where PayFast sends the buyer after paying. Defaults server-side if omitted. */
  returnUrl?: string;
  /** Where PayFast sends the buyer if they cancel. */
  cancelUrl?: string;
}

/** Result of starting a plan change: where to send the buyer to pay. */
export interface PlanChangeResult {
  /** Signed PayFast hosted-checkout URL. Navigate the browser here. */
  redirectUrl: string;
  /** Our payment reference (PayFast m_payment_id). */
  mPaymentId: string;
}

export interface UseBillingOptions {
  /**
   * Poll interval in ms, or false to disable. Used right after returning from
   * the PayFast hosted page, while the server-to-server payment notification
   * (ITN) is still being processed and the plan has not flipped to active yet.
   */
  refetchIntervalMs?: number | false;
}

/**
 * Fetches the tenant's billing overview: plan, status, credits, limits and the
 * purchasable plan catalogue. Targets the Billing API (separate base URL).
 * Validates: Requirements 8.1, 8.2
 */
export function useBilling(options?: UseBillingOptions) {
  const client = useBillingClient();

  return useQuery<BillingOverview, ApiError>({
    queryKey: billingKeys.overview(),
    queryFn: async () => {
      const { data } = await client.get<BillingOverview>('/billing');
      return data;
    },
    refetchInterval: options?.refetchIntervalMs ?? false,
  });
}

/**
 * Fetches a paginated list of invoices for the tenant.
 * Default page size: 20 items.
 * Validates: Requirements 8.3
 */
export function useInvoices(params?: InvoiceListParams) {
  const client = useBillingClient();
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
 * Mutation to start a plan change. Does NOT change the plan: it returns a signed
 * PayFast checkout URL the caller must navigate to. The plan only changes once
 * PayFast confirms payment server-to-server.
 * Validates: Requirements 8.6
 */
export function usePlanChange() {
  const client = useBillingClient();
  const queryClient = useQueryClient();

  return useMutation<PlanChangeResult, ApiError, PlanChangePayload>({
    mutationFn: async (payload) => {
      const { data } = await client.post<PlanChangeResult>('/billing/plan', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
    },
  });
}

/** The seller's invoicing details, printed in the "Bill to" block of invoices. */
export interface BillingProfile {
  companyName: string;
  registrationNumber?: string;
  vatNumber?: string;
  email?: string;
  addressLines?: string[];
  updatedAt: string;
}

/** What the seller submits; omitted optional fields are cleared (PUT semantics). */
export type BillingProfileInput = Omit<BillingProfile, 'updatedAt'>;

/** Fetches the invoicing details, or null if the seller has not set any yet. */
export function useBillingProfile() {
  const client = useBillingClient();
  return useQuery<BillingProfile | null, ApiError>({
    queryKey: billingKeys.profile(),
    queryFn: async () => {
      const { data } = await client.get<{ profile: BillingProfile | null }>('/billing/profile');
      return data.profile;
    },
  });
}

/** Saves the invoicing details. Affects FUTURE invoices only. */
export function useUpdateBillingProfile() {
  const client = useBillingClient();
  const queryClient = useQueryClient();
  return useMutation<BillingProfile, ApiError, BillingProfileInput>({
    mutationFn: async (input) => {
      const { data } = await client.put<{ profile: BillingProfile }>('/billing/profile', input);
      return data.profile;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(billingKeys.profile(), profile);
    },
  });
}

/** A short-lived link to an invoice PDF. */
export interface InvoicePdfResult {
  url: string;
  invoiceNumber: string;
  expiresInSeconds: number;
}

/**
 * Mutation that asks the Billing API for a download link for one invoice (the
 * server issues the PDF first if needed). The caller opens `url` right away; it
 * expires after a few minutes, so it must not be cached or stored.
 */
export function useInvoicePdf() {
  const client = useBillingClient();
  return useMutation<InvoicePdfResult, ApiError, string>({
    mutationFn: async (invoiceId) => {
      const { data } = await client.get<InvoicePdfResult>(
        `/billing/invoices/${encodeURIComponent(invoiceId)}/pdf`
      );
      return data;
    },
  });
}
