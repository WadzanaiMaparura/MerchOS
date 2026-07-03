'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  ComplianceChannelSummary,
  ComplianceRuleSet,
  SaveCompliancePayload,
} from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminComplianceKeys = {
  all: ['admin', 'compliance'] as const,
  channels: () => [...adminComplianceKeys.all, 'channels'] as const,
  ruleSet: (channelId: string) => [...adminComplianceKeys.all, 'ruleSet', channelId] as const,
};

// ─── useComplianceChannels ────────────────────────────────────────────────────

/**
 * Fetches the list of compliance channels.
 */
export function useComplianceChannels(): UseQueryResult<ComplianceChannelSummary[], ApiError> {
  const client = useApiClient();

  return useQuery<ComplianceChannelSummary[], ApiError>({
    queryKey: adminComplianceKeys.channels(),
    queryFn: async () => {
      const response = await client.get<ComplianceChannelSummary[]>(
        '/admin/compliance/channels'
      );
      return response.data;
    },
  });
}

// ─── useComplianceRuleSet ─────────────────────────────────────────────────────

/**
 * Fetches the full compliance rule set for a specific channel.
 */
export function useComplianceRuleSet(
  channelId: string
): UseQueryResult<ComplianceRuleSet, ApiError> {
  const client = useApiClient();

  return useQuery<ComplianceRuleSet, ApiError>({
    queryKey: adminComplianceKeys.ruleSet(channelId),
    queryFn: async () => {
      const response = await client.get<ComplianceRuleSet>(
        `/admin/compliance/channels/${channelId}`
      );
      return response.data;
    },
    enabled: !!channelId,
  });
}

// ─── useSaveComplianceRules ───────────────────────────────────────────────────

/**
 * Mutation to save compliance rules for a channel.
 * Invalidates the rule set and channels list on success.
 */
export function useSaveComplianceRules(): UseMutationResult<
  ComplianceRuleSet,
  ApiError,
  SaveCompliancePayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ComplianceRuleSet, ApiError, SaveCompliancePayload>({
    mutationFn: async (payload) => {
      const response = await client.put<ComplianceRuleSet>(
        `/admin/compliance/channels/${payload.channelId}`,
        { rules: payload.rules }
      );
      return response.data;
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({
        queryKey: adminComplianceKeys.ruleSet(payload.channelId),
      });
      queryClient.invalidateQueries({
        queryKey: adminComplianceKeys.channels(),
      });
    },
  });
}
