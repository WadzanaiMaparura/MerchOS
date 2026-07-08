'use client';

/**
 * Dashboard Layout — Composes all shell and resilience components.
 *
 * Composition order:
 * 1. AdminRouteGuard — Redirects to /login if unauthenticated
 * 2. AdminAppShell — Sidebar + top bar + error boundary around content
 * 3. InactivityTimer — 30-min idle logout
 * 4. OfflineIndicator — Persistent banner when network is lost
 *
 * Requirements: 1.1, 1.9, 2.1, 10.5, 10.6
 */

import React from 'react';
import { AdminRouteGuard } from '../../components/AdminRouteGuard';
import { AdminAppShell } from '../../components/AdminAppShell';
import { InactivityTimer } from '../../components/InactivityTimer';
import { OfflineIndicator } from '../../components/OfflineIndicator';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminRouteGuard>
      <AdminAppShell>
        {/* Offline banner appears above page content */}
        <OfflineIndicator />
        {children}
      </AdminAppShell>
      {/* Inactivity timer renders nothing — just mounts the hook */}
      <InactivityTimer />
    </AdminRouteGuard>
  );
}
