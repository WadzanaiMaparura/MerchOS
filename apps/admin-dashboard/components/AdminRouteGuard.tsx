'use client';

/**
 * AdminRouteGuard — Enforces authentication for protected admin routes.
 *
 * Behavior:
 * - While auth is loading: render nothing (avoid flash of protected content).
 * - If not authenticated: redirect to /login.
 * - If authenticated: render children.
 *
 * Requirements: 1.1, 1.7
 */

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '../hooks/useAdminAuth';

interface AdminRouteGuardProps {
  children: React.ReactNode;
}

export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const { isAuthenticated, isLoading } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  // Show nothing while loading or redirecting to avoid flash of protected content
  if (isLoading || !isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}

export default AdminRouteGuard;
