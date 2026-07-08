'use client';

import {
  useQuery,
  keepPreviousData,
  UseQueryResult,
} from '@tanstack/react-query';
import type {
  AuditEvent,
  AuditListParams,
  PaginatedResponse,
} from '@merch-os/types';

// Re-export for consumers
export type { AuditListParams };
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminAuditKeys = {
  all: ['admin', 'audit'] as const,
  list: (params: AuditListParams) => [...adminAuditKeys.all, 'list', params] as const,
};

// ─── useAuditLog ──────────────────────────────────────────────────────────────

/**
 * Fetches a paginated, filtered audit event log.
 */
export function useAuditLog(
  params: AuditListParams
): UseQueryResult<PaginatedResponse<AuditEvent>, ApiError> {
  const client = useApiClient();

  return useQuery<PaginatedResponse<AuditEvent>, ApiError>({
    queryKey: adminAuditKeys.list(params),
    queryFn: async () => {
      const response = await client.get<PaginatedResponse<AuditEvent>>(
        '/admin/audit',
        { params }
      );
      return response.data;
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
