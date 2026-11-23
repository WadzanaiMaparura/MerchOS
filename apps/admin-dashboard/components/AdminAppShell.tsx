'use client';

/**
 * AdminAppShell — Persistent layout for the Admin Dashboard.
 *
 * Provides:
 * - Sidebar nav items (Health, Customers, Compliance, Taxonomy, Audit Log, Alerts, Billing, Support inbox, Reviews, Referrals)
 * - RBAC-based navigation filtering using @merch-os/rbac permission registry
 * - Sidebar collapse/expand toggle (icon-only when collapsed)
 * - Responsive hamburger menu at < 768px viewport
 * - Active nav item: distinct background + vertical accent indicator (via Sidebar component)
 * - Unresolved alert count badge on the Alerts nav item (useUnresolvedAlertCount)
 * - Top bar: operator email truncated at 30 chars + role "operator"
 * - Non-blocking loading indicator within 200ms of API requests
 * - Loading state while permissions are resolving
 * - Content area wrapped in ErrorBoundaryFallback
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { Sidebar } from '@merch-os/ui';
import type { SidebarItem } from '@merch-os/ui';
import { useUnresolvedAlertCount } from '@merch-os/api-client';
import { PermissionRegistry, defaultPermissionConfig, filterNavigationItems } from '@merch-os/rbac';
import type { NavigationItem } from '@merch-os/rbac';
import { useAdminAuth } from '../hooks/useAdminAuth';
import { usePlatformRole } from '../hooks/usePlatformRole';
import { useAdminUIStore } from '../stores/ui-store';
import { ErrorBoundaryFallback } from './ErrorBoundaryFallback';

// ─── SVG Icons ────────────────────────────────────────────────────────────────

const ActivityIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const UsersIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const ShieldIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const TreeIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <path d="M5 22h14M5 22V7l7-4 7 4v15M9 22V12h6v10" />
  </svg>
);

const FileTextIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const AlertIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CreditCardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const ChatIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5" aria-hidden="true">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

const LogOutIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const ReviewStarIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const GiftIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden="true">
    <polyline points="20 12 20 22 4 22 4 12" />
    <rect x="2" y="7" width="20" height="5" />
    <line x1="12" y1="22" x2="12" y2="7" />
    <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
  </svg>
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Permission registry instance (singleton, data-driven) */
const registry = new PermissionRegistry(defaultPermissionConfig);

/**
 * Admin navigation items annotated with requiredResource for RBAC filtering.
 * Each item maps to a resource in the permission registry.
 * Requirements: 8.1, 8.2, 8.3
 */
export const ADMIN_NAV_ITEMS: NavigationItem[] = [
  { id: 'health', label: 'Health', href: '/health', requiredResource: 'infrastructure' },
  // Customers replaces the old Tenants and Users pages (Support and Admin).
  { id: 'customers', label: 'Customers', href: '/customers', requiredResource: 'users.search' },
  { id: 'compliance', label: 'Compliance', href: '/compliance', requiredResource: 'compliance' },
  { id: 'taxonomy', label: 'Taxonomy', href: '/taxonomy', requiredResource: 'taxonomy' },
  { id: 'audit-log', label: 'Audit Log', href: '/audit-log', requiredResource: 'audit-log' },
  { id: 'alerts', label: 'Alerts', href: '/alerts', requiredResource: 'alerts' },
  { id: 'billing', label: 'Billing', href: '/billing', requiredResource: 'billing' },
  { id: 'support', label: 'Support inbox', href: '/support', requiredResource: 'support-inbox' },
  { id: 'reviews', label: 'Reviews', href: '/reviews', requiredResource: 'reviews' },
  { id: 'referrals', label: 'Referrals', href: '/referrals', requiredResource: 'referrals' },
];

/** Icon map for admin nav items */
const NAV_ICONS: Record<string, React.ReactNode> = {
  health: ActivityIcon,
  customers: UsersIcon,
  compliance: ShieldIcon,
  taxonomy: TreeIcon,
  'audit-log': FileTextIcon,
  alerts: AlertIcon,
  billing: CreditCardIcon,
  support: ChatIcon,
  reviews: ReviewStarIcon,
  referrals: GiftIcon,
};

/**
 * Truncate a string to maxLength characters, appending '…' if truncated.
 * Requirement 2.2: email truncated with ellipsis beyond 30 characters.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '\u2026';
}

// ─── ContentLoadingIndicator ──────────────────────────────────────────────────

/**
 * Shows a non-blocking top-of-content progress bar within 200ms of any active
 * React Query fetch or mutation.
 *
 * Requirement 2.5
 */
function ContentLoadingIndicator() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const isActive = isFetching > 0 || isMutating > 0;
  const [showLoading, setShowLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isActive) {
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => setShowLoading(true), 200);
      }
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShowLoading(false);
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive]);

  if (!showLoading) return null;

  return (
    <div
      className="absolute top-0 left-0 right-0 h-1 overflow-hidden z-10 bg-blue-100"
      role="progressbar"
      aria-label="Loading content"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-full bg-blue-500 animate-[loading-bar_1.5s_ease-in-out_infinite] w-1/3" />
    </div>
  );
}

// ─── HamburgerButton ──────────────────────────────────────────────────────────

function HamburgerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label="Open navigation menu"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="w-6 h-6"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

// ─── AdminAppShell ────────────────────────────────────────────────────────────

export interface AdminAppShellProps {
  children: React.ReactNode;
}

export function AdminAppShell({ children }: AdminAppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAdminAuth();
  const { platformRole, isResolved } = usePlatformRole();

  const sidebarCollapsed = useAdminUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAdminUIStore((s) => s.toggleSidebar);
  const mobileSidebarOpen = useAdminUIStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useAdminUIStore((s) => s.setMobileSidebarOpen);

  // Unresolved alert count for badge on Alerts nav item (Requirement 8.6).
  // Only fetched for roles that can see alerts (Admin, and Support view only).
  const canSeeAlerts =
    isResolved && !!platformRole && registry.hasPermission(platformRole, 'alerts', 'read').granted;
  const { data: unresolvedCount = 0 } = useUnresolvedAlertCount({ enabled: canSeeAlerts });

  // Filter nav items based on the user's platform role (Requirements 8.1, 8.2, 8.3)
  const permittedNavItems = useMemo<NavigationItem[]>(() => {
    if (!isResolved || !platformRole) return [];
    return filterNavigationItems(ADMIN_NAV_ITEMS, platformRole, registry);
  }, [platformRole, isResolved]);

  // Build SidebarItem[] from the filtered NavigationItems
  const navItems: SidebarItem[] = useMemo(() => {
    return permittedNavItems.map((item) => ({
      label: item.label,
      href: item.href,
      icon: NAV_ICONS[item.id] ?? ActivityIcon,
      active: pathname === item.href || pathname.startsWith(item.href + '/'),
      badge: item.id === 'alerts' && unresolvedCount > 0 ? unresolvedCount : undefined,
    }));
  }, [permittedNavItems, pathname, unresolvedCount]);

  const handleNavigate = (href: string) => {
    router.push(href);
    setMobileSidebarOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  const operatorEmail = user?.email ?? '';
  const displayEmail = truncate(operatorEmail, 30);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — hidden on mobile unless open (Requirement 2.6) */}
      {/* Loading state while permissions are resolving (Requirement 8.5) */}
      <nav
        className={[
          'fixed inset-y-0 left-0 z-50 md:relative md:z-0',
          'transform transition-transform duration-200 ease-in-out',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full',
          'md:translate-x-0',
        ].join(' ')}
        aria-label="Primary navigation"
      >
        <div className="flex h-full flex-col bg-sidebar-bg">
          {/* MerchOS brand block (top-left) — the product brand. */}
          <div className="flex items-center gap-2 border-b border-gray-300 px-4 py-4">
            {/* Same mark as the browser tab icon (public/favicon.svg). */}
            <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">
              <circle cx="16" cy="16" r="16" fill="#2563EB" />
              <path d="M8 23V9h2.4l5.6 9.2L21.6 9H24v14h-2.2V13.1L16.6 21h-1.2L10.2 13.1V23H8z" fill="white" />
            </svg>
            {!sidebarCollapsed && (
              <span className="truncate text-base font-bold tracking-tight text-primary-600">
                MerchOS
              </span>
            )}
          </div>
          {!isResolved ? (
            <div
              className={[
                'flex flex-1 flex-col items-center justify-center',
                sidebarCollapsed ? 'w-16' : 'w-64',
              ].join(' ')}
              role="status"
              aria-label="Loading navigation"
            >
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-gray-400 border-t-primary-600" />
            </div>
          ) : (
            <div className="flex-1">
              <Sidebar
                items={navItems}
                collapsed={sidebarCollapsed}
                onToggleCollapse={toggleSidebar}
                onNavigate={handleNavigate}
                theme="light"
              />
            </div>
          )}
        </div>
      </nav>

      {/* Main content column */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar (Requirement 2.2) */}
        <header
          className="flex items-center justify-between h-16 px-4 bg-white border-b border-gray-200 shadow-sm shrink-0"
          role="banner"
        >
          <div className="flex items-center gap-3">
            {/* Hamburger — visible only below 768px (Requirement 2.6) */}
            <HamburgerButton onClick={() => setMobileSidebarOpen(true)} />
            <div className="flex flex-col">
              <span
                className="text-sm font-semibold text-gray-900 truncate max-w-[220px]"
                title={operatorEmail}
                aria-label={`Logged in as ${operatorEmail}`}
              >
                {displayEmail}
              </span>
              <span className="text-xs text-gray-500">operator</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Log out"
            >
              {LogOutIcon}
              <span className="hidden sm:inline">Log out</span>
            </button>
          </div>
        </header>

        {/* Content area */}
        <main
          id="main-content"
          className="relative flex-1 overflow-auto p-6"
          role="main"
        >
          {/* Non-blocking loading indicator (Requirement 2.5) */}
          <ContentLoadingIndicator />

          {/* Page-level error boundary (Requirement 10.5) */}
          <ErrorBoundaryFallback>
            {children}
          </ErrorBoundaryFallback>
        </main>
      </div>
    </div>
  );
}

export default AdminAppShell;
