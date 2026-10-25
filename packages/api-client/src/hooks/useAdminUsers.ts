'use client';

/**
 * Admin user-management hooks — wraps the Category 2 auth endpoints
 * (ADR-005) that manage tenant users: list, invite, update-role, disable,
 * delete. All are served by the auth API behind the JWT authorizer + RBAC
 * middleware and operate on a specific tenant's users.
 *
 * `role` here is the TENANT-level SellerRole (owner/admin/editor/viewer), not
 * the platform role. Callers must be a platform operator with the `users`
 * permission (enforced server-side; the UI gates with AdminRouteGuard).
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type { SellerRole } from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Types ─────────────────────────────────────────────────────────────────

/** A tenant user as returned by GET /auth/users. */
export interface AdminUserSummary {
  userId: string;
  email: string;
  role: string;
  tenantId: string;
  /** Cognito UserStatus, e.g. CONFIRMED, FORCE_CHANGE_PASSWORD. */
  status: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface ListUsersResponse {
  users: AdminUserSummary[];
  /** Opaque Cognito pagination token, present only when more pages exist. */
  nextToken?: string;
}

export interface ListUsersParams {
  tenantId: string;
  limit?: number;
  nextToken?: string;
}

export interface InviteUserPayload {
  tenantId: string;
  email: string;
  role: SellerRole;
}

export interface InviteUserResponse {
  invitationId: string;
  expiresAt: string;
}

export interface UpdateUserRolePayload {
  tenantId: string;
  userId: string;
  role: SellerRole;
}

export interface UpdateUserRoleResponse {
  userId: string;
  role: string;
  updatedAt: string;
}

export interface DisableUserPayload {
  tenantId: string;
  userId: string;
}

export interface DeleteUserPayload {
  tenantId: string;
  userId: string;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const adminUserKeys = {
  all: ['admin', 'users'] as const,
  list: (params: ListUsersParams) => [...adminUserKeys.all, 'list', params] as const,
  /** Scope key for invalidating every list of a given tenant's users. */
  tenant: (tenantId: string) => [...adminUserKeys.all, 'tenant', tenantId] as const,
};

// ─── useAdminUsers (GET /auth/users) ───────────────────────────────────────────

/**
 * Lists a tenant's users. Requires `tenantId`; the query is disabled until one
 * is provided.
 */
export function useAdminUsers(
  params: ListUsersParams
): UseQueryResult<ListUsersResponse, ApiError> {
  const client = useApiClient();

  return useQuery<ListUsersResponse, ApiError>({
    queryKey: adminUserKeys.list(params),
    queryFn: async () => {
      const response = await client.get<ListUsersResponse>('/auth/users', {
        params: {
          tenantId: params.tenantId,
          ...(params.limit ? { limit: params.limit } : {}),
          ...(params.nextToken ? { nextToken: params.nextToken } : {}),
        },
      });
      return response.data;
    },
    enabled: !!params.tenantId,
    staleTime: 30_000,
  });
}

// ─── useInviteUser (POST /auth/invite) ──────────────────────────────────────────

/**
 * Invites a user to a tenant with a seller role. Invalidates that tenant's user
 * lists on success so the (pending) user appears.
 */
export function useInviteUser(): UseMutationResult<
  InviteUserResponse,
  ApiError,
  InviteUserPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<InviteUserResponse, ApiError, InviteUserPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<InviteUserResponse>('/auth/invite', {
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
      });
      return response.data;
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.tenant(payload.tenantId) });
    },
  });
}

// ─── useUpdateUserRole (PUT /auth/users/{id}/role) ──────────────────────────────

/**
 * Changes a user's tenant role. The server rejects changing one's own role.
 */
export function useUpdateUserRole(): UseMutationResult<
  UpdateUserRoleResponse,
  ApiError,
  UpdateUserRolePayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<UpdateUserRoleResponse, ApiError, UpdateUserRolePayload>({
    mutationFn: async (payload) => {
      const response = await client.put<UpdateUserRoleResponse>(
        `/auth/users/${encodeURIComponent(payload.userId)}/role`,
        { role: payload.role }
      );
      return response.data;
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.tenant(payload.tenantId) });
    },
  });
}

// ─── useDisableUser (POST /auth/users/{id}/disable) ─────────────────────────────

/**
 * Disables a user (blocks sign-in). Reversible out-of-band; the UI surfaces the
 * resulting Cognito status on next list refresh.
 */
export function useDisableUser(): UseMutationResult<
  { success: boolean; userId: string; disabled: boolean },
  ApiError,
  DisableUserPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean; userId: string; disabled: boolean },
    ApiError,
    DisableUserPayload
  >({
    mutationFn: async (payload) => {
      const response = await client.post<{
        success: boolean;
        userId: string;
        disabled: boolean;
      }>(`/auth/users/${encodeURIComponent(payload.userId)}/disable`);
      return response.data;
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.tenant(payload.tenantId) });
    },
  });
}

// ─── useDeleteUser (DELETE /auth/users/{id}) ────────────────────────────────────

/**
 * Permanently deletes a user. The server rejects deleting an `owner`.
 */
export function useDeleteUser(): UseMutationResult<
  { success: boolean; userId: string },
  ApiError,
  DeleteUserPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<
    { success: boolean; userId: string },
    ApiError,
    DeleteUserPayload
  >({
    mutationFn: async (payload) => {
      const response = await client.delete<{ success: boolean; userId: string }>(
        `/auth/users/${encodeURIComponent(payload.userId)}`
      );
      return response.data;
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: adminUserKeys.tenant(payload.tenantId) });
    },
  });
}
