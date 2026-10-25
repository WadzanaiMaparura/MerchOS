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
   *
   * Returns the MFA challenge when the operator has TOTP enrolled (the
   * expected path — admin access is MFA-gated). Returns `null` when Cognito
   * established a session with no second factor, which means the operator has
   * no TOTP device enrolled yet. The caller must treat the `null` case as
   * "MFA enrollment required" rather than a completed admin login, because the
   * shared Cognito pool is `Mfa.OPTIONAL` and cannot by itself guarantee a
   * second factor for operators.
   */
  login: (email: string, password: string) => Promise<MfaChallengeResult | null>;
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
   * Admin login.
   *
   * The shared Cognito pool is `Mfa.OPTIONAL`, so a valid password can resolve
   * two ways:
   *  - a TOTP challenge is returned  -> operator has MFA; caller sends them to
   *    /mfa to complete the second factor (the normal, MFA-gated path);
   *  - no challenge (session established) -> operator has NO TOTP enrolled.
   *    We return `null` so the caller can route to MFA enrollment instead of
   *    silently admitting an operator who never passed a second factor.
   *
   * Invalid credentials still reject from `baseLogin`, as before.
   */
  const login = async (email: string, password: string): Promise<MfaChallengeResult | null> => {
    const result = await baseLogin(email, password);
    return result ?? null;
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
