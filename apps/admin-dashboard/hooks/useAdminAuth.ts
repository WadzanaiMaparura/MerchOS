'use client';

/**
 * useAdminAuth — Admin-specific auth hook wrapping @merch-os/auth.
 *
 * Adapts the shared AuthContextValue for admin use:
 * - Types the user as AdminUser (email + operator role)
 * - Guarantees login() always returns MfaChallengeResult (mandatory TOTP)
 * - Surfaces all session management methods
 *
 * Requirements: 1.1–1.9
 */

import { useAuth } from '@merch-os/auth';
import type { AdminUser } from '@merch-os/types';
import type { MfaChallengeResult } from '@merch-os/types';

export type { MfaChallengeResult };

export interface AdminAuthState {
  /** Currently authenticated operator, or null if not authenticated. */
  user: AdminUser | null;
  /** True when a valid session exists. */
  isAuthenticated: boolean;
  /** True while the initial session check is in progress. */
  isLoading: boolean;
  /** Current access token, or null if not authenticated. */
  accessToken: string | null;
  /**
   * Authenticate with email + password.
   * Admin auth always requires TOTP — returns MfaChallengeResult.
   */
  login: (email: string, password: string) => Promise<MfaChallengeResult>;
  /**
   * Complete the TOTP MFA challenge with a 6-digit code.
   * Resolves on success, throws on invalid code.
   */
  completeMfa: (code: string) => Promise<void>;
  /** Revoke session, clear tokens, and redirect to /login. */
  logout: () => Promise<void>;
  /** Silently refresh the access token; returns the new token string. */
  refreshSession: () => Promise<string>;
}

/**
 * Admin authentication hook.
 *
 * Wraps the shared `useAuth()` hook and narrows the user type to AdminUser.
 * The underlying auth context is configured against the Admin Cognito Pool
 * (see apps/admin-dashboard/app/providers.tsx).
 */
export function useAdminAuth(): AdminAuthState {
  const {
    user,
    isAuthenticated,
    isLoading,
    accessToken,
    login: baseLogin,
    completeMfa,
    logout,
    refreshSession,
  } = useAuth();

  /**
   * Cast the generic AuthUser to AdminUser.
   * Admin users always have role: 'operator'; tenantId is absent from AdminUser.
   */
  const adminUser: AdminUser | null = user
    ? {
        userId: user.userId,
        email: user.email,
        role: 'operator',
      }
    : null;

  /**
   * Typed login that always returns MfaChallengeResult.
   * Admin Cognito Pool mandates TOTP MFA, so the underlying call will always
   * return a challenge. The cast here aligns with that constraint.
   */
  const login = async (email: string, password: string): Promise<MfaChallengeResult> => {
    const result = await baseLogin(email, password);
    if (!result) {
      // Should not happen for admin pool (MFA is mandatory), but guard anyway.
      throw new Error('MFA challenge was not returned. Ensure the Admin Cognito Pool has mandatory TOTP configured.');
    }
    return result;
  };

  return {
    user: adminUser,
    isAuthenticated,
    isLoading,
    accessToken,
    login,
    completeMfa,
    logout,
    refreshSession,
  };
}
