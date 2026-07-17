'use client';

import React from 'react';
import type { PlatformRole, Action } from '../types';
import { PermissionRegistry } from '../registry';

/** Props shared by all permission guard components */
export interface PermissionGuardProps {
  children: React.ReactNode;
  registry: PermissionRegistry;
  userRole: PlatformRole | null;
  isResolved: boolean;
}

/** Base guard: renders nothing while unresolved or when role is null */
function BaseGuard({
  children,
  userRole,
  isResolved,
  check,
}: PermissionGuardProps & { check: (role: PlatformRole) => boolean }) {
  if (!isResolved || !userRole) return null;
  if (!check(userRole)) return null;
  return <>{children}</>;
}

/** RequireAdmin — renders children only for Admin role */
export function RequireAdmin(props: PermissionGuardProps) {
  return <BaseGuard {...props} check={(role) => role === 'Admin'} />;
}

/** RequireSupport — renders children for Admin or Support roles */
export function RequireSupport(props: PermissionGuardProps) {
  return (
    <BaseGuard
      {...props}
      check={(role) => role === 'Admin' || role === 'Support'}
    />
  );
}

/** RequireSeller — renders children only for Seller role */
export function RequireSeller(props: PermissionGuardProps) {
  return (
    <BaseGuard {...props} check={(role) => role === 'Seller'} />
  );
}

/** RequirePermission — renders children if role has specified resource+action in the registry */
export function RequirePermission(
  props: PermissionGuardProps & { resource: string; action?: Action },
) {
  const { registry, resource, action = 'read', ...rest } = props;
  return (
    <BaseGuard
      {...rest}
      registry={registry}
      check={(role) => {
        try {
          if (!resource || typeof resource !== 'string') return false;
          const result = registry.hasPermission(role, resource, action);
          return result.granted;
        } catch {
          // If invalid/unrecognized permission identifier, render nothing without throwing
          return false;
        }
      }}
    />
  );
}
