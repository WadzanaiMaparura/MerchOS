'use client';

/**
 * Auth hooks for consuming auth context in components.
 * - useAuth(): Full AuthContextValue
 * - useRole(): Current user's SellerRole
 * - useSession(): Access token and refresh helper
 */

import { useContext } from 'react';
import type { AuthContextValue } from '@merch-os/types';
import type { SellerRole } from '@merch-os/types';
import { AuthContext } from './provider';

/**
 * Access the full auth context value.
 * Must be used within an AuthProvider.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * Get the current user's role.
 * Returns null if not authenticated.
 */
export function useRole(): SellerRole | null {
  const { user } = useAuth();
  return user?.role ?? null;
}

/**
 * Get the current access token and a refresh function.
 * Useful for API client integration.
 */
export function useSession(): {
  accessToken: string | null;
  refreshSession: () => Promise<string>;
  isAuthenticated: boolean;
} {
  const { accessToken, refreshSession, isAuthenticated } = useAuth();
  return { accessToken, refreshSession, isAuthenticated };
}
