'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  AdminBillingSummary,
  AdminBillingDetail,
  AdminBillingListParams,
  PlanOverridePayload,
  SubscriptionStatus,
  PaginatedResponse,
} from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminBillingKeys = {
  all: ['admin', 'billing'] as const,
  list: (params: AdminBillingListParams) => [...adminBillingKeys.all, 'list', params] as const,
  detail: (tenantId: string) => [...adminBillingKeys.all, 'detail', tenantId] as const,
};

// Re-export for consumers
export type { AdminBillingListParams, SubscriptionStatus };

// ─── useAdminBillingList ──────────────────────────────────────────────────────

/**
 * Fetches the paginated admin billing list.
 */
export function useAdminBillingList(
  params: AdminBillingListParams
): UseQueryResult<PaginatedResponse<AdminBillingSummary>, ApiError> {
  const client = useApiClient();

  return useQuery<PaginatedResponse<AdminBillingSummary>, ApiError>({
    queryKey: adminBillingKeys.list(params),
    queryFn: async () => {
      const response = await client.get<PaginatedResponse<AdminBillingSummary>>(
        '/admin/billing',
        { params }
      );
      return response.data;
    },
  });
}

// ─── useAdminBillingDetail ────────────────────────────────────────────────────

/**
 * Fetches full billing detail for a specific tenant.
 */
export function useAdminBillingDetail(
  tenantId: string
): UseQueryResult<AdminBillingDetail, ApiError> {
  const client = useApiClient();

  return useQuery<AdminBillingDetail, ApiError>({
    queryKey: adminBillingKeys.detail(tenantId),
    queryFn: async () => {
      const response = await client.get<AdminBillingDetail>(
        `/admin/billing/${tenantId}`
      );
      return response.data;
    },
    enabled: !!tenantId,
  });
}

// ─── usePlanOverride ──────────────────────────────────────────────────────────

/**
 * Mutation to override a tenant's subscription plan.
 * Invalidates the billing list and tenant detail on settled.
 */
export function usePlanOverride(): UseMutationResult<
  void,
  ApiError,
  PlanOverridePayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, PlanOverridePayload>({
    mutationFn: async (payload) => {
      await client.post(`/admin/billing/${payload.tenantId}/plan-override`, {
        targetPlan: payload.targetPlan,
        reason: payload.reason,
      });
    },
    onSettled: (_data, _error, payload) => {
      queryClient.invalidateQueries({
        queryKey: adminBillingKeys.detail(payload.tenantId),
      });
      queryClient.invalidateQueries({
        queryKey: [...adminBillingKeys.all, 'list'],
      });
    },
  });
}
