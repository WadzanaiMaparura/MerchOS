'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type { TaxonomyStatus, TaxonomyStatusValue } from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminTaxonomyKeys = {
  all: ['admin', 'taxonomy'] as const,
  list: () => [...adminTaxonomyKeys.all, 'list'] as const,
};

// ─── useTaxonomyList ──────────────────────────────────────────────────────────

/**
 * Fetches the list of channel taxonomy statuses.
 * Polls every 10 seconds while any taxonomy is in REFRESHING state.
 */
export function useTaxonomyList(): UseQueryResult<TaxonomyStatus[], ApiError> {
  const client = useApiClient();

  return useQuery<TaxonomyStatus[], ApiError>({
    queryKey: adminTaxonomyKeys.list(),
    queryFn: async () => {
      const response = await client.get<TaxonomyStatus[]>('/admin/taxonomy');
      return response.data;
    },
    staleTime: 30_000,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.some((t) => t.status === 'REFRESHING') ? 10_000 : false;
    },
  });
}

// ─── useTriggerTaxonomyRefresh ────────────────────────────────────────────────

/**
 * Mutation to trigger a taxonomy refresh for a specific channel.
 * Invalidates the taxonomy list on settled.
 */
export function useTriggerTaxonomyRefresh(): UseMutationResult<
  void,
  ApiError,
  { channelId: string }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { channelId: string }>({
    mutationFn: async ({ channelId }) => {
      await client.post(`/admin/taxonomy/${channelId}/refresh`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: adminTaxonomyKeys.list(),
      });
    },
  });
}
