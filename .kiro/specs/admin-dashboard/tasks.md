# Implementation Plan: MerchOS Admin Dashboard

## Overview

Bottom-up implementation of the Admin Dashboard Next.js 14 App Router application. We start with project scaffolding, extend shared packages with admin-specific types and API hooks, build the app shell and auth pages, then implement each feature page. Property-based tests validate correctness properties from the design document.

## Tasks

- [ ] 1. Project scaffolding and configuration
  - [ ] 1.1 Create Next.js 14 App Router project at `apps/admin-dashboard/`
    - Initialize `package.json` with dependencies: next, react, react-dom, tailwindcss, zustand, recharts, zod, react-hook-form
    - Add workspace references: `@merch-os/types`, `@merch-os/auth`, `@merch-os/api-client`, `@merch-os/ui`
    - Create `next.config.js` with transpilePackages for workspace packages
    - Create `tsconfig.json` extending the root TypeScript configuration
    - Create `tailwind.config.ts` sharing design tokens from `@merch-os/ui`
    - Create root `app/layout.tsx` with providers (QueryClientProvider, AuthProvider)
    - Create root `app/page.tsx` that redirects to `/health`
    - _Requirements: 2.8_

  - [ ] 1.2 Set up Vitest and testing infrastructure
    - Add `vitest.config.ts` with jsdom environment and path aliases
    - Add `fast-check` as a dev dependency for property-based testing
    - Add `@testing-library/react` and `@testing-library/jest-dom`
    - Create `__tests__/properties/` and `__tests__/unit/` directories
    - _Requirements: (testing infrastructure)_

- [ ] 2. Shared package extensions — admin types
  - [ ] 2.1 Add admin types to `packages/types/src/admin.ts`
    - Define `AdminUser`, `TenantStatus`, `TenantSummary`, `TenantDetail`
    - Define `SuspendTenantPayload`, `ActivateTenantPayload`
    - Define `HealthMetrics`, `HealthSummary`, `MetricSeries`, `MetricDatapoint`
    - Define `ComplianceChannelSummary`, `ComplianceRuleSet`, `SaveCompliancePayload`
    - Define `TaxonomyStatusValue`, `TaxonomyStatus`
    - Define `AuditEvent`, `AuditListParams`
    - Define `AlertItem`, `ResolveAlertPayload`, `AlertStatusFilter`
    - Define `SubscriptionStatus`, `AdminBillingSummary`, `AdminBillingDetail`, `PlanOverridePayload`
    - Export all admin types from the package index
    - _Requirements: 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

- [ ] 3. Shared package extensions — admin API hooks
  - [ ] 3.1 Create `packages/api-client/src/hooks/useAdminHealth.ts`
    - Implement `useHealthMetrics(range: TimeRange)` query hook with `adminHealthKeys`
    - Implement `useHealthSummary()` query hook
    - Configure staleTime and retry logic per error handling design
    - _Requirements: 3.1, 3.2, 3.3, 3.7_

  - [ ] 3.2 Create `packages/api-client/src/hooks/useAdminTenants.ts`
    - Implement `useAdminTenants(params: TenantListParams)` with pagination and filters
    - Implement `useAdminTenantDetail(tenantId: string)` detail query
    - Implement `useSuspendTenant()` mutation with optimistic update and rollback
    - Implement `useActivateTenant()` mutation with optimistic update and rollback
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ] 3.3 Create `packages/api-client/src/hooks/useAdminCompliance.ts`
    - Implement `useComplianceChannels()` query hook
    - Implement `useComplianceRuleSet(channelId: string)` query hook
    - Implement `useSaveComplianceRules()` mutation with cache invalidation
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [ ] 3.4 Create `packages/api-client/src/hooks/useAdminTaxonomy.ts`
    - Implement `useTaxonomyList()` query hook
    - Implement `useTriggerTaxonomyRefresh()` mutation
    - Configure 10-second `refetchInterval` for REFRESHING state polling
    - _Requirements: 6.1, 6.3, 6.5_

  - [ ] 3.5 Create `packages/api-client/src/hooks/useAdminAuditLog.ts`
    - Implement `useAuditLog(params: AuditListParams)` query with pagination, search, date range, and action type filters
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.7_

  - [ ] 3.6 Create `packages/api-client/src/hooks/useAdminAlerts.ts`
    - Implement `useAlerts(status?: AlertStatusFilter)` query hook
    - Implement `useUnresolvedAlertCount()` query hook
    - Implement `useResolveAlert()` mutation with cache invalidation
    - _Requirements: 8.1, 8.3, 8.5, 8.6_

  - [ ] 3.7 Create `packages/api-client/src/hooks/useAdminBilling.ts`
    - Implement `useAdminBillingList(params: AdminBillingListParams)` with pagination and filters
    - Implement `useAdminBillingDetail(tenantId: string)` query hook
    - Implement `usePlanOverride()` mutation with cache invalidation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7_

  - [ ] 3.8 Export all admin hooks from `packages/api-client` package index
    - Add barrel export for all new admin hook modules
    - _Requirements: (wiring)_

- [ ] 4. Checkpoint — Shared packages compile
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. App shell, auth, and resilience components
  - [ ] 5.1 Implement `apps/admin-dashboard/hooks/useAdminAuth.ts`
    - Wrap `@merch-os/auth` configured for Admin Cognito Pool
    - Expose `login`, `completeMfa`, `logout`, `refreshSession`
    - Handle MFA_REQUIRED challenge flow
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 1.8_

  - [ ] 5.2 Implement `apps/admin-dashboard/hooks/useInactivityTimeout.ts`
    - Track mousedown, keydown, scroll, touchstart events
    - Fire timeout callback after 30 minutes of inactivity
    - Reset timer on each activity event
    - Clean up event listeners on unmount
    - _Requirements: 1.9_

  - [ ] 5.3 Implement `apps/admin-dashboard/stores/ui-store.ts`
    - Zustand store: `sidebarCollapsed`, `mobileSidebarOpen`, toggle actions
    - _Requirements: 2.1, 2.6_

  - [ ] 5.4 Implement `apps/admin-dashboard/components/AdminRouteGuard.tsx`
    - Check authentication state; redirect to `/login` if unauthenticated
    - Integrate inactivity timeout hook triggering logout
    - _Requirements: 1.1, 1.9_

  - [ ] 5.5 Implement `apps/admin-dashboard/components/AdminAppShell.tsx`
    - Sidebar with 7 nav items (Health, Tenants, Compliance, Taxonomy, Audit Log, Alerts, Billing)
    - Top bar with operator email (truncated to 30 chars) and role display
    - Collapse/expand toggle and responsive hamburger menu at <768px
    - Active nav item visual indicator
    - Unresolved alert count badge on Alerts nav item
    - Content area wrapped in error boundary
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 8.6_

  - [ ] 5.6 Implement `apps/admin-dashboard/components/InactivityTimer.tsx`
    - Client component wrapping `useInactivityTimeout` with logout action
    - _Requirements: 1.9_

  - [ ] 5.7 Implement `apps/admin-dashboard/components/OfflineIndicator.tsx`
    - Listen to `navigator.onLine` and `online`/`offline` events
    - Show persistent banner when offline; remove within 5s of reconnection
    - _Requirements: 10.6_

  - [ ] 5.8 Implement `apps/admin-dashboard/components/ErrorBoundaryFallback.tsx`
    - Page-level error boundary with reload option; App Shell remains functional
    - _Requirements: 10.5_

  - [ ] 5.9 Implement auth pages: `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/mfa/page.tsx`
    - Login form: email + password → calls `login()` → redirects to MFA page
    - MFA page: 6-digit TOTP input → calls `completeMfa()` → redirects to /health
    - Error display for invalid credentials/code
    - Account lockout messaging after 5 failed attempts
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [ ] 5.10 Implement dashboard layout at `app/(dashboard)/layout.tsx`
    - Compose AdminRouteGuard, AdminAppShell, InactivityTimer, OfflineIndicator
    - _Requirements: 2.1, 1.1, 1.9, 10.5, 10.6_

- [ ] 6. Checkpoint — Auth flow and app shell functional
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Health monitoring page
  - [ ] 7.1 Implement `app/(dashboard)/health/page.tsx`
    - Render HealthSummary cards (active tenants, products processed today)
    - Render TimeRangeSelector component (1h, 6h, 24h, 7d)
    - Render HealthChart components for each metric series
    - Skeleton placeholders while loading
    - Error state with retry action
    - Refresh button triggering refetch
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

  - [ ] 7.2 Implement `HealthChart` component using Recharts
    - Line/area chart with 5-minute interval data points
    - Tooltip showing ISO 8601 timestamp and value with unit label
    - Accessible: keyboard navigable, ARIA labels
    - _Requirements: 3.1, 3.4, 11.1_

  - [ ] 7.3 Implement `TimeRangeSelector` component
    - Toggle between 1h, 6h, 24h, 7d options
    - On change, update query params feeding `useHealthMetrics`
    - _Requirements: 3.3_

- [ ] 8. Tenant management page
  - [ ] 8.1 Implement `app/(dashboard)/tenants/page.tsx`
    - DataTable with columns: name, plan, status, user count, product count, registration date
    - Pagination with 25-row default page size
    - Search input (2+ chars) filtering by name/ID
    - Status filter dropdown (all, active, suspended)
    - Plan filter dropdown (all, starter, growth, professional, enterprise)
    - Row click opens TenantDetailPanel
    - Error state with retry action
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.9_

  - [ ] 8.2 Implement `TenantDetailPanel` component
    - Slide-out panel showing full tenant info
    - Suspend button (active tenants) with confirmation modal requiring reason (1–500 chars)
    - Activate button (suspended tenants) with confirmation modal
    - Error handling for failed mutations
    - _Requirements: 4.5, 4.6, 4.7, 4.8_

- [ ] 9. Compliance rule editor page
  - [ ] 9.1 Implement `app/(dashboard)/compliance/page.tsx`
    - Channel list showing channel name, version, last updated timestamp
    - On channel select, load rule set and render ComplianceFormRenderer
    - Save button validates against JSON schema then submits
    - Field-level validation errors on schema violation
    - Success confirmation with updated version + timestamp
    - Error handling preserving unsaved changes
    - Navigation guard prompt for unsaved changes
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [ ] 9.2 Implement `ComplianceFormRenderer` component
    - Dynamically generate form from JSON schema using React Hook Form + Zod
    - Pre-populate with current rule values
    - Support nested fields, arrays, enums as defined by schema
    - _Requirements: 5.2, 5.3, 5.4_

- [ ] 10. Taxonomy management page
  - [ ] 10.1 Implement `app/(dashboard)/taxonomy/page.tsx`
    - Table: channel name, version, last refresh date, node count, status
    - Visual distinction for STALE vs CURRENT status (colour/icon)
    - Refresh button per row; disabled during REFRESHING state
    - Progress indicator on REFRESHING rows
    - 10-second polling while any taxonomy is REFRESHING
    - Error handling for failed refresh and failed data load
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [ ] 11. Audit log viewer page
  - [ ] 11.1 Implement `app/(dashboard)/audit-log/page.tsx`
    - DataTable: timestamp, actor, action type, resource, tenant ID, details summary
    - Pagination with 50-row default page size, sorted by timestamp descending
    - Search input (3+ chars) filtering actor, action type, resource, tenant ID
    - Date range picker (start/end)
    - Action type dropdown filter
    - All filters applied as logical AND
    - Expandable row showing full event details as formatted JSON
    - Error state with retry action
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [ ] 12. Alert dashboard page
  - [ ] 12.1 Implement `app/(dashboard)/alerts/page.tsx`
    - Alert list: function name, error rate %, error count, triggered-at, status
    - Default sort: unresolved first, then resolved
    - Visual distinction between unresolved/resolved (background colour/icon)
    - Status filter (all, unresolved, resolved)
    - Resolve button opening AlertResolutionForm
    - Unresolved count badge fed into AppShell sidebar via `useUnresolvedAlertCount`
    - Error state with retry action
    - _Requirements: 8.1, 8.2, 8.3, 8.5, 8.6, 8.7_

  - [ ] 12.2 Implement `AlertResolutionForm` component
    - Inline form: resolution note textarea (1–1000 chars)
    - Submit calls `useResolveAlert` mutation
    - Error handling leaving alert unresolved on failure
    - _Requirements: 8.3, 8.4_

- [ ] 13. Billing administration page
  - [ ] 13.1 Implement `app/(dashboard)/billing/page.tsx`
    - DataTable: tenant name, plan, billing cycle, status, current period end
    - Pagination with 25-row default page size
    - Search input (2+ chars) filtering by name/ID
    - Subscription status filter dropdown
    - Row click opens billing detail panel
    - Error state with retry action
    - _Requirements: 9.1, 9.2, 9.7, 9.8_

  - [ ] 13.2 Implement billing detail panel and PlanOverrideModal
    - Detail panel: plan, billing cycle, status, usage counters with limits, recent invoices
    - Plan override button opens modal with plan selection + reason (1–500 chars)
    - Success confirmation showing previous → new plan
    - Error handling preserving current plan on failure
    - _Requirements: 9.3, 9.4, 9.5, 9.6_

- [ ] 14. Checkpoint — All feature pages implemented
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Property-based tests
  - [ ]* 15.1 Write property test for inactivity timeout logic
    - **Property 1: Inactivity timeout fires only after idle period exceeds threshold**
    - Test that timeout fires iff elapsed time since last event > 1,800,000ms; timer resets on each event
    - **Validates: Requirements 1.9**

  - [ ]* 15.2 Write property test for email display truncation
    - **Property 2: Email display truncation**
    - Test that emails ≤30 chars display unchanged; emails >30 chars display first 30 chars + "…"
    - **Validates: Requirements 2.2**

  - [ ]* 15.3 Write property test for notification queue management
    - **Property 3: Error notification queue maintains maximum of 3 visible notifications**
    - Test max 3 visible; oldest dismissed on overflow; FIFO eviction
    - **Validates: Requirements 2.7**

  - [ ]* 15.4 Write property test for text search filter
    - **Property 4: Text search filter returns only matching results**
    - Test case-insensitive match on name/ID; non-matching excluded; minimum 2-char query
    - **Validates: Requirements 4.2, 9.2**

  - [ ]* 15.5 Write property test for category filter invariant
    - **Property 5: Category filter invariant**
    - Test that filtered results all match selected filter value; non-matching excluded
    - **Validates: Requirements 4.3, 4.4, 8.5, 9.7**

  - [ ]* 15.6 Write property test for length-bounded input validation
    - **Property 6: Length-bounded input validation**
    - Test acceptance iff trimmed length in [min, max]; rejection for empty, whitespace-only, or exceeding max
    - **Validates: Requirements 4.6, 8.3, 9.4**

  - [ ]* 15.7 Write property test for unsaved changes detection
    - **Property 7: Unsaved changes detection**
    - Test deep equality: hasUnsavedChanges returns true iff current ≠ saved (deep comparison)
    - **Validates: Requirements 5.7**

  - [ ]* 15.8 Write property test for audit log combined filter
    - **Property 8: Audit log combined filter (logical AND)**
    - Test that filtered results satisfy ALL active criteria; events failing any criterion excluded
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.7**

  - [ ]* 15.9 Write property test for alert partition ordering
    - **Property 9: Alert partition ordering**
    - Test all unresolved alerts appear before all resolved alerts in default sort
    - **Validates: Requirements 8.1**

  - [ ]* 15.10 Write property test for unresolved alert count accuracy
    - **Property 10: Unresolved alert count accuracy**
    - Test count equals exact number of alerts where resolved === false
    - **Validates: Requirements 8.6**

- [ ] 16. Final checkpoint — All tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The app reuses existing shared packages (`@merch-os/types`, `@merch-os/auth`, `@merch-os/api-client`, `@merch-os/ui`) — only admin-specific extensions are added
- All API hooks follow the same React Query patterns established in the Seller Dashboard
- Accessibility (Requirement 11) is addressed throughout implementation via Radix UI primitives, semantic HTML, and ARIA attributes — not as a separate task

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8"] },
    { "id": 3, "tasks": ["5.1", "5.2", "5.3"] },
    { "id": 4, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8"] },
    { "id": 5, "tasks": ["5.9", "5.10"] },
    { "id": 6, "tasks": ["7.1", "8.1", "9.1", "10.1", "11.1", "12.1", "13.1"] },
    { "id": 7, "tasks": ["7.2", "7.3", "8.2", "9.2", "12.2", "13.2"] },
    { "id": 8, "tasks": ["15.1", "15.2", "15.3", "15.4", "15.5", "15.6", "15.7", "15.8", "15.9", "15.10"] }
  ]
}
```
