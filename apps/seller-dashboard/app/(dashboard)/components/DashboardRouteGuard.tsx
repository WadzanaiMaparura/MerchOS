'use client';

/**
 * DashboardRouteGuard — Per-route permission-based access control for the seller dashboard.
 *
 * Wraps page content and checks the current route against the PermissionRegistry.
 * Uses the platform role (Seller) and checks whether the user has permission to
 * the route's required resource.
 *
 * Behavior:
 * - While auth is loading: render nothing (no flash of protected content).
 * - If the user's platform role lacks permission for the route: redirect to /access-denied?path={pathname}.
 * - If authorized: render children.
 *
 * Props:
 * - requiredResource (optional): The resource identifier to check permissions against.
 * - requiredAction (optional, default 'read'): The action to check for the resource.
 *
 * When no requiredResource is specified, the guard falls back to the legacy
 * tenant-role-based route check for backwards compatibility.
 *
 * Requirements: 9.1, 9.3, 9.4
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth, useRole } from '@merch-os/auth';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import type { Action, PlatformRole } from '@merch-os/rbac';
import type { SellerRole } from '@merch-os/types';
import { canAccessRoute } from '../../config/route-permissions';

// Singleton registry instance
const registry = new PermissionRegistry(defaultPermissionConfig);

interface DashboardRouteGuardProps {
  children: React.ReactNode;
  /** The resource identifier to check permissions against (optional) */
  requiredResource?: string;
  /** The action to check for the resource (defaults to 'read') */
  requiredAction?: Action;
}

/**
 * Dispatch an access denied notification that auto-dismisses after 5 seconds.
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

export function DashboardRouteGuard({
  children,
  requiredResource,
  requiredAction = 'read',
}: DashboardRouteGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoading: isAuthLoading, user } = useAuth();
  const role = useRole();
  const [authorized, setAuthorized] = useState(false);
  const redirectingRef = useRef(false);

  // The seller dashboard always uses the 'Seller' platform role
  const platformRole: PlatformRole = 'Seller';
  const isAuthenticated = !!user;
  const isLoading = isAuthLoading;

  useEffect(() => {
    // Reset redirect flag on route change
    redirectingRef.current = false;

    if (isLoading) return;

    // If a requiredResource is specified, use the PermissionRegistry for RBAC checks
    if (requiredResource) {
      const result = registry.hasPermission(platformRole, requiredResource, requiredAction);
      if (result.granted) {
        setAuthorized(true);
      } else {
        setAuthorized(false);
        if (!redirectingRef.current) {
          redirectingRef.current = true;
          dispatchAccessDeniedNotification();
          router.replace(`/access-denied?path=${encodeURIComponent(pathname)}`);
        }
      }
      return;
    }

    // Fallback: Use legacy tenant-role-based route check (backwards compatible)
    const userRole: SellerRole = role ?? 'viewer';
    if (canAccessRoute(pathname, userRole)) {
      setAuthorized(true);
    } else {
      setAuthorized(false);
      if (!redirectingRef.current) {
        redirectingRef.current = true;
        dispatchAccessDeniedNotification();
        router.replace(`/access-denied?path=${encodeURIComponent(pathname)}`);
      }
    }
  }, [pathname, role, router, isLoading, requiredResource, requiredAction, platformRole]);

  // Show nothing while loading or unauthorized to prevent flash of protected content
  if (isLoading || !authorized) {
    return null;
  }

  return <>{children}</>;
}
