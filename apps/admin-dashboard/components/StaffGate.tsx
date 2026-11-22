'use client';

/**
 * StaffGate: the admin dashboard is for MerchOS staff (Admin and Support).
 *
 * - A signed-in account without a staff role (e.g. a seller account) sees a
 *   clear message instead of an empty dashboard.
 * - Staff can only open pages their role allows: each nav page's required
 *   permission is enforced here for the whole route, not only by hiding the
 *   menu item. Pages without a nav entry (access-denied, the landing route)
 *   are always reachable.
 *
 * The backend still authorises every API call; this is the UI layer.
 */

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { usePlatformRole } from '../hooks/usePlatformRole';
import { ADMIN_NAV_ITEMS } from './AdminAppShell';

const registry = new PermissionRegistry(defaultPermissionConfig);
const STAFF_ROLES = new Set(['Admin', 'Support']);

/** The nav item whose page contains this path, if any. */
export function navItemForPath(pathname: string) {
  return ADMIN_NAV_ITEMS.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
}

export function StaffGate({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isLoading, logout } = useAdminAuth();
  const { platformRole, isResolved } = usePlatformRole();
  const router = useRouter();
  const pathname = usePathname() ?? '/';

  const ready = !isLoading && isResolved && isAuthenticated;
  const isStaff = !!platformRole && STAFF_ROLES.has(platformRole);
  const item = navItemForPath(pathname);
  const allowed =
    !item?.requiredResource ||
    (!!platformRole && registry.hasPermission(platformRole, item.requiredResource, 'read').granted);

  useEffect(() => {
    if (ready && isStaff && !allowed) {
      router.replace(`/access-denied?path=${encodeURIComponent(pathname)}`);
    }
  }, [ready, isStaff, allowed, pathname, router]);

  if (!ready) return null;

  if (!isStaff) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">This is the MerchOS staff dashboard</h1>
          <p className="mt-3 text-sm text-gray-600">
            You are signed in as <strong>{user?.email}</strong>, which is not a staff account.
            Seller accounts use the MerchOS website.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <a
              href="https://merchos.co.za/login"
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Go to merchos.co.za
            </a>
            <button
              type="button"
              onClick={() => void logout().then(() => router.replace('/login'))}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!allowed) return null;
  return <>{children}</>;
}
