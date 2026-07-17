# Implementation Plan: RBAC Platform Access Control

## Overview

This plan implements a centralized Role-Based Access Control system for MerchOS using Amazon Cognito Groups (Admin, Support, Seller). The implementation creates a new shared `@merch-os/rbac` package, refactors the existing backend RBAC middleware to use the new permission registry, adds frontend permission guard components, integrates dynamic navigation rendering into both dashboards, and provides unauthorized access handling. Each task builds incrementally, with the shared package as the foundation.

## Tasks

- [x] 1. Create `@merch-os/rbac` package with types and permission registry
  - [x] 1.1 Scaffold the `packages/rbac` package structure
    - Create `packages/rbac/package.json` with name `@merch-os/rbac`, private, main pointing to `./src/index.ts`
    - Create `packages/rbac/tsconfig.json` extending root TypeScript config
    - Create `packages/rbac/vitest.config.ts` for unit testing
    - Create `packages/rbac/src/index.ts` barrel export
    - _Requirements: 2.1, 10.1_

  - [x] 1.2 Implement core types in `packages/rbac/src/types.ts`
    - Define `PlatformRole` type as `'Admin' | 'Support' | 'Seller'`
    - Define `Action` type as `'create' | 'read' | 'update' | 'delete'`
    - Define `Permission`, `RoleEntry`, `PermissionRegistryConfig`, and `PermissionCheckResult` interfaces
    - Ensure `PlatformRole` is defined as a string union to allow extensibility via configuration
    - _Requirements: 2.1, 2.3, 10.1, 10.4_

  - [x] 1.3 Implement `PermissionRegistry` class in `packages/rbac/src/registry.ts`
    - Implement constructor that validates config and builds an internal role map
    - Implement `hasPermission(role, resource, action)` returning `PermissionCheckResult`
    - Implement `getPermissionsForRole(role)` returning permissions array or null
    - Implement `hasResourceAccess(role, resource)` returning boolean
    - Implement `validate(config)` that rejects empty permission sets, invalid actions, resource strings >128 chars, and missing role identifiers
    - Ensure NO if/else or switch/case on role name values — all lookups are map-based
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.4, 10.5_

  - [x] 1.4 Implement default permission configuration in `packages/rbac/src/config.ts`
    - Define `defaultPermissionConfig` with Seller, Support, and Admin role entries
    - Seller: products, suppliers, ai-listings (full CRUD), analytics (read), exports (create, read), subscription (read, update)
    - Support: users.search (read), users.profile (read), processing-jobs (read), logs (read), users.verification (create)
    - Admin: superset of all permissions including platform-settings, billing, infrastructure, tenants, compliance, taxonomy, alerts, audit-log
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.3, 6.1, 6.2_

  - [x]* 1.5 Write unit tests for `PermissionRegistry`
    - Test that recognized roles return correct permissions
    - Test that unrecognized roles return denied with reason
    - Test that missing resource-action combos return implicit deny
    - Test validation rejects malformed configs (empty permissions, invalid actions, resource >128 chars)
    - Test that Admin has superset of Support and Seller permissions
    - Test that registry is data-driven (no role-name branching)
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 10.5_

- [x] 2. Implement JWT parsing and role resolution
  - [x] 2.1 Implement JWT claims types and role resolution in `packages/rbac/src/jwt.ts`
    - Define `JwtClaims` interface with `sub`, `iss`, `exp`, `cognito:groups`, `custom:tenantId`
    - Define `RoleResolutionResult` discriminated union (success/failure)
    - Implement `resolveRoleFromClaims(claims, expectedIssuer)` function
    - Implement role priority resolution: Admin(3) > Support(2) > Seller(1)
    - Return appropriate error codes: `INVALID_ISSUER` (401), `TOKEN_EXPIRED` (401), `MISSING_GROUP` (403), `UNRECOGNIZED_ROLE` (403)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

  - [x]* 2.2 Write unit tests for role resolution
    - Test valid single group resolves correctly
    - Test multiple groups resolves to highest priority
    - Test expired token returns 401 with TOKEN_EXPIRED
    - Test missing cognito:groups returns 403 with MISSING_GROUP
    - Test issuer mismatch returns 401 with INVALID_ISSUER
    - Test unrecognized group names return 403 with UNRECOGNIZED_ROLE
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7_

- [x] 3. Implement backend authorization middleware
  - [x] 3.1 Implement authorization check factory in `packages/rbac/src/middleware.ts`
    - Define `EndpointPermission` interface with `resource` and `action`
    - Define `AuthorizationContext` interface with `role`, `userId`, `tenantId`
    - Define `AuthErrorResponse` interface for structured error responses
    - Implement `createAuthorizationCheck(registry, expectedIssuer)` that returns an `authorize` function
    - The `authorize` function checks claims, resolves role, checks permission, and returns authorized context or error
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.2 Refactor `services/shared/middleware/rbac.ts` to use the new `@merch-os/rbac` package
    - Replace old `Role` type (viewer/editor/admin/owner) with `PlatformRole` from `@merch-os/rbac`
    - Replace old `Action` type and `ROLE_PERMISSIONS` matrix with `PermissionRegistry` from `@merch-os/rbac`
    - Update middy middleware to extract `cognito:groups` from JWT claims (via API Gateway authorizer context)
    - Use `createAuthorizationCheck` from `@merch-os/rbac` for permission evaluation
    - Attach `AuthorizationContext` (role, userId, tenantId) to the request for downstream handlers
    - Return HTTP 401 for authentication failures and HTTP 403 for authorization failures with structured JSON error bodies
    - Add `@merch-os/rbac` as a dependency in `services/shared/package.json`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 3.3 Write unit tests for authorization middleware
    - Test that missing JWT returns 401 with MISSING_TOKEN
    - Test that expired JWT returns 401 with TOKEN_EXPIRED
    - Test that valid JWT with insufficient permission returns 403
    - Test that valid JWT with sufficient permission returns authorized context
    - Test that AuthorizationContext includes role, userId, tenantId
    - Test that denied requests do not invoke endpoint handler (short-circuit)
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement frontend permission guard components
  - [x] 5.1 Implement permission guard components in `packages/rbac/src/components/PermissionGuard.tsx`
    - Implement `BaseGuard` that renders nothing while unresolved or when role is null
    - Implement `RequireAdmin` — renders children only for Admin role
    - Implement `RequireSupport` — renders children for Admin or Support roles
    - Implement `RequireSeller` — renders children only for Seller role
    - Implement `RequirePermission` — renders children if role has specified resource+action in the registry
    - If invalid/unrecognized permission identifier is passed to `RequirePermission`, render nothing without throwing
    - All guards derive decisions from `PermissionRegistry` + `userRole`, no hardcoded role checks in component logic
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x]* 5.2 Write unit tests for permission guard components
    - Test that guards render nothing while `isResolved` is false
    - Test that `RequireAdmin` renders children only for Admin
    - Test that `RequireSupport` renders children for Admin and Support, not Seller
    - Test that `RequireSeller` renders children only for Seller
    - Test that `RequirePermission` renders based on registry lookup
    - Test that invalid permission identifiers cause no runtime error and render nothing
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 6. Implement dynamic navigation rendering
  - [x] 6.1 Implement navigation filter utility in `packages/rbac/src/navigation.ts`
    - Define `NavigationItem` interface with `id`, `label`, `href`, `icon`, `requiredResource`, `requiredAction`, `children`
    - Implement `filterNavigationItems(items, role, registry)` that returns only permitted items
    - Recursively filter child navigation items
    - Default `requiredAction` to `'read'` when not specified
    - No hardcoded role checks — all decisions come from the registry
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [x] 6.2 Integrate navigation filtering into Admin Dashboard
    - Update `apps/admin-dashboard/components/AdminAppShell.tsx` to annotate nav items with `requiredResource`
    - Import `filterNavigationItems` and `PermissionRegistry` from `@merch-os/rbac`
    - Get current user's role from auth context and filter nav items before rendering
    - Add loading state: render a loading indicator while permissions are resolving
    - Render empty menu container if role has no permitted items
    - Add `@merch-os/rbac` as a dependency in `apps/admin-dashboard/package.json`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 6.3 Integrate navigation filtering into Seller Dashboard
    - Update the seller dashboard navigation component to annotate nav items with `requiredResource`
    - Import and apply `filterNavigationItems` with Seller role from auth context
    - Add loading state: render a loading indicator while permissions are resolving
    - Add `@merch-os/rbac` as a dependency in `apps/seller-dashboard/package.json`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 6.4 Write unit tests for navigation filtering
    - Test that items without permission are excluded from output
    - Test that items with permission are included
    - Test that children are recursively filtered
    - Test default action is 'read' when not specified
    - Test empty result when role has no permissions
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

- [x] 7. Implement unauthorized access handling
  - [x] 7.1 Create Access Denied page for Admin Dashboard
    - Create `apps/admin-dashboard/app/(dashboard)/access-denied/page.tsx`
    - Display the attempted resource path and a message indicating lack of permission
    - Provide navigation link back to the admin dashboard home
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 7.2 Create Access Denied page for Seller Dashboard
    - Create `apps/seller-dashboard/app/(dashboard)/access-denied/page.tsx`
    - Display the attempted resource path and a message indicating lack of permission
    - Provide navigation link back to the seller dashboard home
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 7.3 Update route guards to enforce RBAC redirection
    - Update `apps/admin-dashboard/components/AdminRouteGuard.tsx` to check role permissions via the registry
    - Redirect authenticated users without permission to `/access-denied`
    - Redirect unauthenticated users to `/login`
    - Ensure protected content is never rendered before permission check completes
    - Create equivalent permission-aware route guard for seller dashboard
    - _Requirements: 9.1, 9.3, 9.4_

- [x] 8. Wire package exports and ensure integration
  - [x] 8.1 Finalize `packages/rbac/src/index.ts` barrel exports
    - Export all types from `./types`
    - Export `PermissionRegistry` from `./registry`
    - Export `defaultPermissionConfig` from `./config`
    - Export `resolveRoleFromClaims` and JWT types from `./jwt`
    - Export `createAuthorizationCheck` and middleware types from `./middleware`
    - Export permission guard components from `./components/PermissionGuard`
    - Export `filterNavigationItems` and `NavigationItem` from `./navigation`
    - _Requirements: 2.1, 10.1, 10.2, 10.3_

  - [x]* 8.2 Write integration tests for end-to-end authorization flow
    - Test full flow: JWT claims → role resolution → permission check → authorized/denied
    - Test Seller role can access own resources but not admin resources
    - Test Support role can read user info and logs but cannot modify
    - Test Admin role has access to all resources
    - Test that adding a new role config entry works without code changes
    - _Requirements: 4.1, 4.4, 5.1, 6.1, 6.3, 10.2_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The existing `services/shared/middleware/rbac.ts` has an old role model (viewer/editor/admin/owner) that will be replaced by the new Cognito Groups model (Admin/Support/Seller)
- The `@merch-os/rbac` package is the single source of truth shared between frontend and backend
- Frontend guards provide UX convenience; backend middleware is the security boundary
- Unit tests validate specific examples and edge cases

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4"] },
    { "id": 3, "tasks": ["1.5", "2.1"] },
    { "id": 4, "tasks": ["2.2", "3.1"] },
    { "id": 5, "tasks": ["3.2", "5.1", "6.1"] },
    { "id": 6, "tasks": ["3.3", "5.2", "6.4"] },
    { "id": 7, "tasks": ["6.2", "6.3", "7.1", "7.2"] },
    { "id": 8, "tasks": ["7.3", "8.1"] },
    { "id": 9, "tasks": ["8.2"] }
  ]
}
```
