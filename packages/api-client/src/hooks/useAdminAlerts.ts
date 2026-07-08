'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  AlertItem,
  AlertStatusFilter,
  ResolveAlertPayload,
} from '@merch-os/types';

// Re-export for consumers
export type { AlertStatusFilter };
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminAlertKeys = {
  all: ['admin', 'alerts'] as const,
  list: (status?: AlertStatusFilter) => [...adminAlertKeys.all, 'list', status] as const,
  unresolvedCount: () => [...adminAlertKeys.all, 'unresolvedCount'] as const,
};

// ─── Configuration ───────────────────────────────────────────────────────────

const UNRESOLVED_COUNT_STALE_TIME = 60_000; // 60 seconds

// ─── useAlerts ────────────────────────────────────────────────────────────────

/**
 * Fetches the list of alerts, optionally filtered by status.
 */
export function useAlerts(
  status?: AlertStatusFilter
): UseQueryResult<AlertItem[], ApiError> {
  const client = useApiClient();

  return useQuery<AlertItem[], ApiError>({
    queryKey: adminAlertKeys.list(status),
    queryFn: async () => {
      const response = await client.get<AlertItem[]>('/admin/alerts', {
        params: status ? { status } : undefined,
      });
      return response.data;
    },
    staleTime: 30_000,
  });
}

// ─── useUnresolvedAlertCount ──────────────────────────────────────────────────

/**
 * Fetches the count of unresolved alerts.
 * Cached for 60 seconds.
 */
export function useUnresolvedAlertCount(): UseQueryResult<number, ApiError> {
  const client = useApiClient();

  return useQuery<number, ApiError>({
    queryKey: adminAlertKeys.unresolvedCount(),
    queryFn: async () => {
      const response = await client.get<number>('/admin/alerts/unresolved-count');
      return response.data;
    },
    staleTime: UNRESOLVED_COUNT_STALE_TIME,
  });
}

// ─── useResolveAlert ──────────────────────────────────────────────────────────

/**
 * Mutation to resolve an alert with a resolution note.
 * Invalidates the alert list and unresolved count on settled.
 */
export function useResolveAlert(): UseMutationResult<
  void,
  ApiError,
  ResolveAlertPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ResolveAlertPayload>({
    mutationFn: async (payload) => {
      await client.post(`/admin/alerts/${payload.alertId}/resolve`, {
        note: payload.note,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: [...adminAlertKeys.all, 'list'],
      });
      queryClient.invalidateQueries({
        queryKey: adminAlertKeys.unresolvedCount(),
      });
    },
  });
}
