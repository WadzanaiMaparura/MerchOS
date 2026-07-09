'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  TenantSummary,
  TenantDetail,
  AdminTenantStatus,
  PaginatedResponse,
  SuspendTenantPayload,
  ActivateTenantPayload,
} from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminTenantKeys = {
  all: ['admin', 'tenants'] as const,
  list: (params: TenantListParams) => [...adminTenantKeys.all, 'list', params] as const,
  detail: (tenantId: string) => [...adminTenantKeys.all, 'detail', tenantId] as const,
};

// ─── Params Interface ─────────────────────────────────────────────────────────

export interface TenantListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: 'active' | 'suspended';
  plan?: string;
}

// ─── Optimistic mutation context ──────────────────────────────────────────────

interface TenantMutationContext {
  previousDetail: TenantDetail | undefined;
}

// ─── useAdminTenants ──────────────────────────────────────────────────────────

/**
 * Fetches a paginated list of tenants with optional filtering.
 */
export function useAdminTenants(
  params: TenantListParams
): UseQueryResult<PaginatedResponse<TenantSummary>, ApiError> {
  const client = useApiClient();

  return useQuery<PaginatedResponse<TenantSummary>, ApiError>({
    queryKey: adminTenantKeys.list(params),
    queryFn: async () => {
      const response = await client.get<PaginatedResponse<TenantSummary>>(
        '/admin/tenants',
        { params }
      );
      return response.data;
    },
    staleTime: 30_000,
  });
}

// ─── useAdminTenantDetail ─────────────────────────────────────────────────────

/**
 * Fetches full detail for a single tenant by ID.
 */
export function useAdminTenantDetail(
  tenantId: string
): UseQueryResult<TenantDetail, ApiError> {
  const client = useApiClient();

  return useQuery<TenantDetail, ApiError>({
    queryKey: adminTenantKeys.detail(tenantId),
    queryFn: async () => {
      const response = await client.get<TenantDetail>(`/admin/tenants/${tenantId}`);
      return response.data;
    },
    staleTime: 30_000,
    enabled: !!tenantId,
  });
}

// ─── useSuspendTenant ─────────────────────────────────────────────────────────

/**
 * Mutation to suspend a tenant.
 * Optimistically sets tenant status to 'suspended'; rolls back on error.
 * Invalidates list and detail queries on settled.
 */
export function useSuspendTenant(): UseMutationResult<
  void,
  ApiError,
  SuspendTenantPayload,
  TenantMutationContext
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, SuspendTenantPayload, TenantMutationContext>({
    mutationFn: async (payload) => {
      await client.post(`/admin/tenants/${payload.tenantId}/suspend`, {
        reason: payload.reason,
      });
    },
    onMutate: async (payload): Promise<TenantMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: adminTenantKeys.detail(payload.tenantId),
      });

      const previousDetail = queryClient.getQueryData<TenantDetail>(
        adminTenantKeys.detail(payload.tenantId)
      );

      if (previousDetail) {
        queryClient.setQueryData<TenantDetail>(
          adminTenantKeys.detail(payload.tenantId),
          (old) => old ? { ...old, status: 'suspended' as AdminTenantStatus } : undefined
        );
      }

      return { previousDetail };
    },
    onError: (_error, payload, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(
          adminTenantKeys.detail(payload.tenantId),
          context.previousDetail
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: adminTenantKeys.all,
      });
    },
  });
}

// ─── useActivateTenant ────────────────────────────────────────────────────────

/**
 * Mutation to activate a suspended tenant.
 * Optimistically sets tenant status to 'active'; rolls back on error.
 * Invalidates list and detail queries on settled.
 */
export function useActivateTenant(): UseMutationResult<
  void,
  ApiError,
  ActivateTenantPayload,
  TenantMutationContext
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ActivateTenantPayload, TenantMutationContext>({
    mutationFn: async (payload) => {
      await client.post(`/admin/tenants/${payload.tenantId}/activate`);
    },
    onMutate: async (payload): Promise<TenantMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: adminTenantKeys.detail(payload.tenantId),
      });

      const previousDetail = queryClient.getQueryData<TenantDetail>(
        adminTenantKeys.detail(payload.tenantId)
      );

      if (previousDetail) {
        queryClient.setQueryData<TenantDetail>(
          adminTenantKeys.detail(payload.tenantId),
          (old) => old ? { ...old, status: 'active' as AdminTenantStatus } : undefined
        );
      }

      return { previousDetail };
    },
    onError: (_error, payload, context) => {
      if (context?.previousDetail) {
        queryClient.setQueryData(
          adminTenantKeys.detail(payload.tenantId),
          context.previousDetail
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: adminTenantKeys.all,
      });
    },
  });
}
