'use client';

/**
 * DashboardRouteGuard — Per-route role-based access control within the dashboard.
 *
 * Wraps page content and checks the current route against the route permission map.
 * If the user's role does not meet the required minimum, redirects to /dashboard
 * and dispatches an access denied notification that auto-dismisses after 5 seconds.
 *
 * This is used inside the dashboard layout to enforce route-level permissions
 * after the initial authentication check by the outer RouteGuard.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import React, { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useRole } from '@merch-os/auth';
import type { SellerRole } from '@merch-os/types';
import { canAccessRoute } from '../../config/route-permissions';

interface DashboardRouteGuardProps {
  children: React.ReactNode;
}

/**
 * Dispatch an access denied notification that auto-dismisses after 5 seconds.
 * Requirement 3.6: redirect to Dashboard with access denied notification.
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

export function DashboardRouteGuard({ children }: DashboardRouteGuardProps) {
  const pathname = usePathname();
  const router = useRouter();
  const role = useRole();
  const [authorized, setAuthorized] = useState(false);
  const redirectingRef = useRef(false);

  useEffect(() => {
    // Reset redirect flag on route change
    redirectingRef.current = false;

    const userRole: SellerRole = role ?? 'viewer';

    // Check if the user can access the current route
    if (canAccessRoute(pathname, userRole)) {
      setAuthorized(true);
    } else {
      setAuthorized(false);
      if (!redirectingRef.current) {
        redirectingRef.current = true;
        dispatchAccessDeniedNotification();
        router.replace('/dashboard');
      }
    }
  }, [pathname, role, router]);

  if (!authorized) {
    return null;
  }

  return <>{children}</>;
}
