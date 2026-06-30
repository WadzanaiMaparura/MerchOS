'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SellerRole } from '@merch-os/types';
import { useApiClient } from '../context';
import type { ApiError } from '../errors';

/** Query key factory for team domain */
export const teamKeys = {
  all: ['team'] as const,
  members: () => [...teamKeys.all, 'members'] as const,
};

/** Represents a team member in the tenant */
export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: SellerRole;
  joinedAt: string;
}

export interface InviteMemberPayload {
  email: string;
  role: Exclude<SellerRole, 'owner'>;
}

export interface ChangeRolePayload {
  userId: string;
  role: Exclude<SellerRole, 'owner'>;
}

export interface RemoveMemberPayload {
  userId: string;
}

/**
 * Fetches all team members in the tenant.
 * Validates: Requirements 10.1
 */
export function useTeamMembers() {
  const client = useApiClient();

  return useQuery<TeamMember[], ApiError>({
    queryKey: teamKeys.members(),
    queryFn: async () => {
      const { data } = await client.get<TeamMember[]>('/team/members');
      return data;
    },
  });
}

/**
 * Mutation to invite a new team member.
 * Invalidates team queries on success.
 * Validates: Requirements 10.2
 */
export function useInviteMember() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, InviteMemberPayload>({
    mutationFn: async (payload) => {
      await client.post('/team/members/invite', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
}

/**
 * Mutation to change a team member's role.
 * Invalidates team queries on success.
 * Validates: Requirements 10.4
 */
export function useChangeRole() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ChangeRolePayload>({
    mutationFn: async (payload) => {
      await client.patch(`/team/members/${payload.userId}/role`, {
        role: payload.role,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
}

/**
 * Mutation to remove a team member from the tenant.
 * Invalidates team queries on success.
 * Validates: Requirements 10.5
 */
export function useRemoveMember() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, RemoveMemberPayload>({
    mutationFn: async (payload) => {
      await client.delete(`/team/members/${payload.userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: teamKeys.all });
    },
  });
}
