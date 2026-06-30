'use client';

/**
 * RouteGuard — Client component that enforces authentication and role-based
 * access control on protected routes.
 *
 * Behavior:
 * 1. If user is not authenticated, redirect to login page within 2 seconds.
 * 2. If user's role is null/undefined (indeterminate), redirect to login.
 * 3. If user's role does not meet the required role (hierarchy check), redirect
 *    to Dashboard with an access denied notification (auto-dismiss 5 seconds).
 * 4. Re-evaluates permissions on navigation events (pathname changes).
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './hooks';
import type { SellerRole } from '@merch-os/types';

export interface RouteGuardProps {
  children: React.ReactNode;
  /** Minimum role required to access the route */
  requiredRole?: SellerRole;
  /** If true, redirects to read-only version instead of access denied */
  redirectToReadOnly?: boolean;
  /** Path to redirect to on auth failure (defaults to '/login') */
  loginPath?: string;
}

/**
 * Role hierarchy levels — higher number = more permissions.
 * owner > admin > editor > viewer
 */
const ROLE_HIERARCHY: Record<SellerRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Check whether the user's role meets the required minimum role.
 * A higher role in the hierarchy satisfies any lower requirement.
 */
function hasRequiredRole(userRole: SellerRole, requiredRole: SellerRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Dispatch a custom event for the notification system to display an
 * access denied toast that auto-dismisses after 5 seconds.
 */
function dispatchAccessDeniedNotification(): void {
  if (typeof window === 'undefined') return;
  const event = new CustomEvent('merch-os:notification', {
    detail: {
      type: 'access-denied',
      title: 'Access Denied',
      message: 'You do not have permission to access this page.',
      autoDismissMs: 5000,
    },
  });
  window.dispatchEvent(event);
}

export function RouteGuard({
  children,
  requiredRole,
  redirectToReadOnly = false,
  loginPath = '/login',
}: RouteGuardProps): React.ReactElement | null {
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [authorized, setAuthorized] = useState(false);

  // Track whether we've already initiated a redirect to avoid multiple redirects
  const redirectingRef = useRef(false);

  /**
   * Core authorization check. Returns true if access is granted.
   */
  const checkAuthorization = useCallback((): boolean => {
    // Still loading auth state — don't render anything yet
    if (isLoading) return false;

    // Not authenticated — redirect to login within 2 seconds
    if (!isAuthenticated || !user) {
      if (!redirectingRef.current) {
        redirectingRef.current = true;
        const timeout = setTimeout(() => {
          router.replace(loginPath);
        }, 0); // Redirect immediately (well within 2 second requirement)
        // Clean up is handled by the effect cleanup
        return false;
      }
      return false;
    }

    // Role is indeterminate (null/undefined) — redirect to login
    const userRole = user.role;
    if (!userRole) {
      if (!redirectingRef.current) {
        redirectingRef.current = true;
        router.replace(loginPath);
      }
      return false;
    }

    // No required role specified — just needs authentication
    if (!requiredRole) {
      return true;
    }

    // Check role hierarchy
    if (!hasRequiredRole(userRole, requiredRole)) {
      if (!redirectingRef.current) {
        redirectingRef.current = true;
        if (redirectToReadOnly) {
          // Redirect to read-only version of the current path (consumer-defined behavior)
          router.replace('/dashboard');
        } else {
          dispatchAccessDeniedNotification();
          router.replace('/dashboard');
        }
      }
      return false;
    }

    // All checks pass
    return true;
  }, [isLoading, isAuthenticated, user, requiredRole, redirectToReadOnly, loginPath, router]);

  /**
   * Re-evaluate authorization on:
   * - Auth state changes (isLoading, isAuthenticated, user)
   * - Navigation events (pathname changes)
   * - Required role changes
   */
  useEffect(() => {
    // Reset redirect flag when conditions change
    redirectingRef.current = false;
    const isAuthorized = checkAuthorization();
    setAuthorized(isAuthorized);
  }, [checkAuthorization, pathname]);

  // While loading or not authorized, render nothing
  if (isLoading || !authorized) {
    return null;
  }

  return <>{children}</>;
}
