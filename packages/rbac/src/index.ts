// @merch-os/rbac barrel export
// Exports will be added as modules are implemented.

export type { PlatformRole, Action, Permission, RoleEntry, PermissionRegistryConfig, PermissionCheckResult } from './types';
export { PermissionRegistry } from './registry';
export { defaultPermissionConfig } from './config';
export { resolveRoleFromClaims } from './jwt';
export type { JwtClaims, RoleResolutionResult } from './jwt';
export { createAuthorizationCheck } from './middleware';
export type { EndpointPermission, AuthorizationContext, AuthErrorResponse } from './middleware';
export { RequireAdmin, RequireSupport, RequireSeller, RequirePermission } from './components/PermissionGuard';
export type { PermissionGuardProps } from './components/PermissionGuard';
export { filterNavigationItems } from './navigation';
export type { NavigationItem } from './navigation';
