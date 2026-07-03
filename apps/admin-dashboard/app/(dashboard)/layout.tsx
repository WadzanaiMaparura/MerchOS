'use client';

import React from 'react';

/**
 * Placeholder dashboard layout for the admin (dashboard) route group.
 *
 * This will be fully implemented in task 5.10 with:
 * - AdminAppShell (sidebar + topbar + error boundary)
 * - AdminRouteGuard (auth enforcement + inactivity timeout)
 * - Offline indicator
 * - Loading indicator
 *
 * For now it renders children directly so that individual dashboard pages
 * can be developed and tested independently.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
