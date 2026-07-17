'use client';

/**
 * AdminRouteGuard — Enforces authentication AND authorization for protected admin routes.
 *
 * Behavior:
 * - While auth/role is loading: render nothing (avoid flash of protected content).
 * - If not authenticated: redirect to /login.
 * - If authenticated but lacking required permission: redirect to /access-denied?path={currentPathname}.
 * - If authenticated (and authorized, when requiredResource specified): render children.
 *
 * Props:
 * - requiredResource (optional): The resource identifier to check in the PermissionRegistry.
 * - requiredAction (optional, default 'read'): The action to check for the resource.
 *
 * When no requiredResource is specified, the guard only checks authentication (backwards compatible).
 *
 * Requirements: 9.1, 9.3, 9.4
 */

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { usePlatformRole } from '../hooks/usePlatformRole';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import type { Action } from '@merch-os/rbac';

// Singleton registry instance
const registry = new PermissionRegistry(defaultPermissionConfig);

interface AdminRouteGuardProps {
  children: React.ReactNode;
  /** The resource identifier to check permissions against (optional — if omitted, only authentication is checked) */
  requiredResource?: string;
  /** The action to check for the resource (defaults to 'read') */
  requiredAction?: Action;
}

export function AdminRouteGuard({
  children,
  requiredResource,
  requiredAction = 'read',
}: AdminRouteGuardProps) {
  const { isAuthenticated, isLoading: isAuthLoading } = useAdminAuth();
  const { platformRole, isResolved: isRoleResolved } = usePlatformRole();
  const router = useRouter();
  const pathname = usePathname();

  // Determine if we're still loading
  const isLoading = isAuthLoading || !isRoleResolved;

  // Determine authorization status
  const hasPermission = (() => {
    // If no resource is specified, only authentication is required (backwards compatible)
    if (!requiredResource) return true;
    // If role is not yet resolved or null, we can't determine permission
    if (!platformRole) return false;
    // Check the permission registry
    const result = registry.hasPermission(platformRole, requiredResource, requiredAction);
    return result.granted;
  })();

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // Unauthenticated → redirect to login
      router.replace('/login');
      return;
    }

    if (requiredResource && !hasPermission) {
      // Authenticated but lacks permission → redirect to access-denied with attempted path
      router.replace(`/access-denied?path=${encodeURIComponent(pathname)}`);
    }
  }, [isAuthenticated, isLoading, hasPermission, requiredResource, router, pathname]);

  // Show nothing while loading or redirecting to avoid flash of protected content
  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (requiredResource && !hasPermission) {
    return null;
  }

  return <>{children}</>;
}

export default AdminRouteGuard;
