'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { Sidebar } from '@merch-os/ui';
import type { SidebarItem } from '@merch-os/ui';
import { useAuth, RouteGuard } from '@merch-os/auth';
import { filterNavigationItems, PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import type { NavigationItem, PlatformRole } from '@merch-os/rbac';
import { useUIStore } from '../stores/ui-store';
import { NotificationProvider, NotificationHistoryDropdown, ConnectionStatusIndicator } from '../components/notifications';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ErrorBoundaryWrapper } from './components/ErrorBoundaryWrapper';
import { DashboardRouteGuard } from './components/DashboardRouteGuard';

// --- Permission Registry (singleton) ---
const registry = new PermissionRegistry(defaultPermissionConfig);

// --- Navigation Configuration ---

// SVG icon components for nav items
const HomeIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const PackageIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const ClipboardCheckIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M9 14l2 2 4-4" />
  </svg>
);

const WarehouseIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v4M12 14v4M16 14v4" />
  </svg>
);

const DownloadIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

const SettingsIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const CreditCardIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const ChannelsIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const TeamIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
  </svg>
);

/**
 * SELLER_NAV_ITEMS — Navigation items annotated with requiredResource
 * mapping to the permission registry resources for the Seller role.
 * Items are filtered by the registry at render time.
 */
const SELLER_NAV_ITEMS: (NavigationItem & { icon: React.ReactNode })[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: HomeIcon, requiredResource: 'analytics' },
  { id: 'products', label: 'Products', href: '/products', icon: PackageIcon, requiredResource: 'products' },
  { id: 'review-queue', label: 'Review Queue', href: '/review-queue', icon: ClipboardCheckIcon, requiredResource: 'products' },
  { id: 'inventory', label: 'Inventory', href: '/inventory', icon: WarehouseIcon, requiredResource: 'products' },
  { id: 'exports', label: 'Exports', href: '/exports', icon: DownloadIcon, requiredResource: 'exports' },
  { id: 'channels', label: 'Channels', href: '/settings/channels', icon: ChannelsIcon, requiredResource: 'ai-listings' },
  { id: 'settings', label: 'Settings', href: '/settings', icon: SettingsIcon, requiredResource: 'subscription' },
  { id: 'team', label: 'Team', href: '/settings/team', icon: TeamIcon, requiredResource: 'subscription' },
  { id: 'billing', label: 'Billing', href: '/billing', icon: CreditCardIcon, requiredResource: 'subscription' },
];

// --- Helper: truncate string ---
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '\u2026';
}

// --- Loading Indicator ---
/**
 * ContentLoadingIndicator - Displays a non-blocking progress bar in the content
 * area within 200ms of an API request starting.
 *
 * Uses React Query's useIsFetching and useIsMutating to detect active requests.
 * Shows indicator after a 200ms delay to avoid flicker for fast responses.
 *
 * Requirement 2.5:
 * WHILE the application is loading data from the API, THE App_Shell SHALL display
 * a non-blocking loading indicator in the content area within 200 milliseconds
 * of the request starting.
 */
function ContentLoadingIndicator() {
  const isFetching = useIsFetching();
  const isMutating = useIsMutating();
  const isActive = isFetching > 0 || isMutating > 0;
  const [showLoading, setShowLoading] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isActive) {
      // Show loading indicator after 200ms delay
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          setShowLoading(true);
        }, 200);
      }
    } else {
      // Clear timer and hide indicator when no active requests
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
      className="absolute top-0 left-0 right-0 h-1 bg-primary-100 overflow-hidden z-10"
      role="progressbar"
      aria-label="Loading content"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="h-full bg-primary-500 animate-[loading-bar_1.5s_ease-in-out_infinite] w-1/3" />
    </div>
  );
}

// --- Navigation Loading Indicator ---
/**
 * NavLoadingIndicator - Displays a loading skeleton in place of the navigation
 * while permissions are being resolved (Requirement 8.5).
 */
function NavLoadingIndicator() {
  return (
    <div
      className="flex flex-col gap-3 p-4"
      role="status"
      aria-label="Loading navigation"
      aria-busy="true"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-8 bg-gray-200 rounded animate-pulse" />
      ))}
    </div>
  );
}

// --- Hamburger Menu Button ---
function HamburgerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="md:hidden p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      aria-label="Open navigation menu"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

// --- Main Dashboard Layout ---
/**
 * DashboardLayout — App Shell layout for the (dashboard) route group.
 *
 * Implements:
 * - Sidebar navigation filtered by permission registry (Requirement 8.1, 8.2, 8.3)
 * - Display name (truncated 30 chars), role, and org name (truncated 40 chars) in top bar (Requirement 2.2)
 * - Client-side navigation without full page reload (Requirement 2.3)
 * - Active nav item with distinct background and vertical accent (Requirement 2.4)
 * - Non-blocking loading indicator within 200ms of API request start (Requirement 2.5)
 * - Responsive: hamburger menu below 768px (Requirement 2.6)
 * - Loading indicator while permissions resolve (Requirement 8.5)
 * - Connection status indicator and offline indicator in top bar (Requirements 12.5, 13.5)
 * - Unread notification count badge in top bar (implicit from 12.4)
 * - RouteGuard for protected routes
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading: isAuthLoading, refreshSession } = useAuth();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const mobileSidebarOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen);

  // WebSocket URL from environment variable
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'wss://ws.merchos.io';

  // Access token getter for WebSocket authentication
  const getAccessToken = useCallback(async () => {
    return refreshSession();
  }, [refreshSession]);

  // Resolve Platform Role from user context. This is the seller dashboard,
  // so we use 'Seller' as the platform role.
  const platformRole: PlatformRole = 'Seller';
  const isPermissionsResolved = !isAuthLoading && user != null;

  const displayName = user?.givenName
    ? `${user.givenName}${user.familyName ? ' ' + user.familyName : ''}`
    : user?.email ?? 'User';
  const organisationName = (user as { organisationName?: string })?.organisationName
    ?? user?.tenantId
    ?? 'Organisation';

  // Build a map from nav item id → icon for lookup after filtering
  const iconMap = useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    for (const item of SELLER_NAV_ITEMS) {
      map.set(item.id, item.icon);
    }
    return map;
  }, []);

  // Filter nav items using the permission registry (Requirements 8.1, 8.2, 8.3)
  const filteredNavItems: SidebarItem[] = useMemo(() => {
    if (!isPermissionsResolved) return [];

    // Strip icons for filterNavigationItems (it expects NavigationItem shape)
    const navItems: NavigationItem[] = SELLER_NAV_ITEMS.map(({ icon, ...rest }) => rest);
    const permitted = filterNavigationItems(navItems, platformRole, registry);

    return permitted.map((item) => ({
      label: item.label,
      href: item.href,
      icon: iconMap.get(item.id),
      active: pathname === item.href || pathname.startsWith(item.href + '/'),
    }));
  }, [isPermissionsResolved, platformRole, pathname, iconMap]);

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href);
      setMobileSidebarOpen(false);
    },
    [router, setMobileSidebarOpen]
  );

  return (
    <RouteGuard loginPath="/login">
      <NotificationProvider wsUrl={wsUrl} getAccessToken={getAccessToken}>
        <div className="flex h-screen overflow-hidden bg-gray-50">
          {/* Mobile sidebar overlay */}
          {mobileSidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 md:hidden"
              onClick={() => setMobileSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Sidebar - hidden on mobile unless open */}
          <nav
            className={`
              fixed inset-y-0 left-0 z-50 md:relative md:z-0
              transform transition-transform duration-200 ease-in-out
              ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
              md:translate-x-0
            `}
            aria-label="Primary navigation"
          >
            {!isPermissionsResolved ? (
              <NavLoadingIndicator />
            ) : (
              <Sidebar
                items={filteredNavItems}
                collapsed={sidebarCollapsed}
                onToggleCollapse={toggleSidebar}
                onNavigate={handleNavigate}
              />
            )}
          </nav>

          {/* Main content area */}
          <div className="flex flex-1 flex-col min-w-0">
            {/* Top bar */}
            <header
              className="flex items-center justify-between h-16 px-4 bg-white border-b border-gray-200 shadow-sm"
              role="banner"
            >
              <div className="flex items-center gap-3">
                <HamburgerButton onClick={() => setMobileSidebarOpen(true)} />
                <div className="hidden sm:flex flex-col">
                  <span
                    className="text-sm font-semibold text-gray-900"
                    title={displayName}
                  >
                    {truncate(displayName, 30)}
                  </span>
                  <span className="text-xs text-gray-500">
                    Seller ·{' '}
                    <span title={organisationName}>
                      {truncate(organisationName, 40)}
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <ConnectionStatusIndicator />
                <OfflineIndicator />
                <NotificationHistoryDropdown />
              </div>
            </header>

            {/* Content area with loading indicator */}
            <main
              id="main-content"
              className="relative flex-1 overflow-auto p-6"
              role="main"
            >
              <ContentLoadingIndicator />
              <ErrorBoundaryWrapper>
                <DashboardRouteGuard>
                  {children}
                </DashboardRouteGuard>
              </ErrorBoundaryWrapper>
            </main>
          </div>
        </div>
      </NotificationProvider>
    </RouteGuard>
  );
}
