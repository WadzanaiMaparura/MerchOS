/**
 * Route Permission Configuration
 *
 * Maps dashboard routes to the minimum required role for access.
 * Role hierarchy: owner > admin > editor > viewer
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * - viewer: Dashboard, Products (read-only)
 * - editor: + Inventory, Exports
 * - admin:  + Channels, Webhooks
 * - owner:  + Team, Billing
 */

import type { SellerRole } from '@merch-os/types';

export interface RoutePermission {
  /** The route path pattern (supports prefix matching) */
  path: string;
  /** Minimum role required to access this route */
  requiredRole: SellerRole;
  /** If true, viewer can still access but in read-only mode */
  readOnlyForViewer?: boolean;
}

/**
 * Route permission map defining access control for all dashboard routes.
 * Routes are matched by prefix — more specific routes should come first.
 */
export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // Owner-only routes
  { path: '/settings/team', requiredRole: 'owner' },
  { path: '/billing', requiredRole: 'owner' },

  // Admin-only routes
  { path: '/settings/channels', requiredRole: 'admin' },
  { path: '/settings/webhooks', requiredRole: 'admin' },
  { path: '/settings', requiredRole: 'admin' },

  // Editor routes
  { path: '/inventory', requiredRole: 'editor' },
  { path: '/exports', requiredRole: 'editor' },

  // Viewer routes (accessible by all authenticated users)
  { path: '/products', requiredRole: 'viewer', readOnlyForViewer: true },
  { path: '/review-queue', requiredRole: 'viewer' },
  { path: '/dashboard', requiredRole: 'viewer' },
];

/**
 * Role hierarchy levels — higher number = more permissions.
 */
export const ROLE_HIERARCHY: Record<SellerRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

/**
 * Check whether a user's role meets the required minimum role.
 */
export function hasRoleAccess(userRole: SellerRole, requiredRole: SellerRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Get the route permission for a given pathname.
 * Matches by prefix — first matching route wins.
 * Returns undefined if no explicit permission is defined (defaults to viewer access).
 */
export function getRoutePermission(pathname: string): RoutePermission | undefined {
  return ROUTE_PERMISSIONS.find((route) => pathname === route.path || pathname.startsWith(route.path + '/'));
}

/**
 * Determine if a user can access a route based on their role.
 */
export function canAccessRoute(pathname: string, userRole: SellerRole): boolean {
  const permission = getRoutePermission(pathname);
  if (!permission) {
    // No permission defined — allow access (viewer-level routes like dashboard)
    return true;
  }
  return hasRoleAccess(userRole, permission.requiredRole);
}

/**
 * Check if the route should display in read-only mode for a viewer.
 */
export function isReadOnlyForRole(pathname: string, userRole: SellerRole): boolean {
  if (userRole !== 'viewer') return false;
  const permission = getRoutePermission(pathname);
  return permission?.readOnlyForViewer === true;
}
