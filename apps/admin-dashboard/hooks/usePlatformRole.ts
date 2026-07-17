'use client';

/**
 * usePlatformRole — Extracts the user's PlatformRole from the Cognito access token.
 *
 * Decodes the JWT's `cognito:groups` claim and resolves the highest-priority
 * Platform_Role using the priority hierarchy: Admin > Support > Seller.
 *
 * Returns:
 *   - platformRole: The resolved PlatformRole, or null if not yet determined
 *   - isResolved: Whether the role resolution is complete (auth is no longer loading)
 *
 * Requirements: 8.1, 8.4, 8.5
 */

import { useMemo } from 'react';
import type { PlatformRole } from '@merch-os/rbac';
import { useAdminAuth } from './useAdminAuth';

/** Role priority for resolving multiple group memberships */
const ROLE_PRIORITY: Record<string, number> = {
  Admin: 3,
  Support: 2,
  Seller: 1,
};

const VALID_ROLES = new Set(['Admin', 'Support', 'Seller']);

/**
 * Decode a JWT payload (base64url) without verifying signature.
 * This is acceptable on the frontend since the backend enforces authorization.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    if (!payload) return null;
    // Base64url → base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Resolve the highest-priority PlatformRole from an array of Cognito groups.
 */
function resolveRole(groups: string[]): PlatformRole | null {
  const recognized = groups.filter((g) => VALID_ROLES.has(g));
  if (recognized.length === 0) return null;

  return recognized.reduce<string>((highest, current) =>
    (ROLE_PRIORITY[current] ?? 0) > (ROLE_PRIORITY[highest] ?? 0) ? current : highest,
    recognized[0]!,
  ) as PlatformRole;
}

export interface PlatformRoleState {
  /** The resolved platform role, or null if not determined */
  platformRole: PlatformRole | null;
  /** Whether the role resolution is complete (auth finished loading) */
  isResolved: boolean;
}

/**
 * Hook to get the current user's PlatformRole from the Cognito access token.
 */
export function usePlatformRole(): PlatformRoleState {
  const { accessToken, isLoading } = useAdminAuth();

  const platformRole = useMemo<PlatformRole | null>(() => {
    if (!accessToken) return null;
    const payload = decodeJwtPayload(accessToken);
    if (!payload) return null;

    const groups = payload['cognito:groups'];
    if (!Array.isArray(groups)) return null;

    return resolveRole(groups as string[]);
  }, [accessToken]);

  return {
    platformRole,
    isResolved: !isLoading,
  };
}
