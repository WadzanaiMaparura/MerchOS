# Implementation Plan: MerchOS Website

## Overview

This plan implements the MerchOS Seller Dashboard as a Next.js 14 App Router application with TypeScript, Tailwind CSS, React Query, and Radix UI. The implementation follows a bottom-up approach: shared packages first (types, auth, api-client, ui), then the seller dashboard app shell, followed by individual feature modules, and finally integration wiring.

## Tasks

- [x] 1. Set up project structure and shared packages
  - [x] 1.1 Initialize the seller-dashboard Next.js app and shared packages
    - Create `apps/seller-dashboard/` with Next.js 14 App Router scaffolding (`next.config.js`, `tailwind.config.ts`, `tsconfig.json`, `package.json`)
    - Create `packages/types/`, `packages/auth/`, `packages/api-client/`, `packages/ui/` directory structures with `package.json` and `tsconfig.json` for each
    - Update root `package.json` workspaces to include `packages/*`
    - Install core dependencies: `next@14`, `react@18`, `tailwindcss`, `@tanstack/react-query@5`, `@radix-ui/react-dialog`, `@radix-ui/react-navigation-menu`, `@radix-ui/react-toast`, `@radix-ui/react-tabs`, `@radix-ui/react-select`, `@radix-ui/react-progress`, `zustand`, `zod`, `react-hook-form`, `@hookform/resolvers`, `axios`, `@aws-amplify/auth`
    - _Requirements: 2.1, 14.1_

  - [x] 1.2 Define shared TypeScript types in packages/types
    - Create `packages/types/src/index.ts` re-exporting all shared types
    - Define `LifecycleState`, `SellerRole`, `ChannelId`, `PlanId`, `TenantStatus`, `EventType` enumerations
    - Define product DTOs: `ProductSummary`, `Product`, `ProductListParams`, `PaginatedResponse<T>`, `ApproveAttributePayload`, `OverrideAttributePayload`, `TransitionPayload`
    - Define inventory DTOs: `InventorySummary`, `StockAdjustmentPayload`
    - Define billing DTOs: `BillingOverview`, `UsageMeters`, `InvoiceSummary`
    - Define export DTOs: `ExportSummary`, `TriggerExportPayload`
    - Define notification types: `Notification`, `WebSocketManagerConfig`
    - Define auth types: `AuthUser`, `AuthState`, `AuthContextValue`, `MfaChallengeResult`
    - _Requirements: 1.1, 4.1, 5.1, 7.1, 8.1, 9.1, 12.1_

- [x] 2. Implement authentication module (packages/auth)
  - [x] 2.1 Implement Cognito auth provider and hooks
    - Create `packages/auth/src/cognito.ts` with Amplify Auth configuration for tenant pool PKCE
    - Create `packages/auth/src/provider.tsx` implementing `AuthProvider` React context with `AuthContextValue`
    - Implement `login()` using SRP + PKCE flow via `@aws-amplify/auth` signIn
    - Implement `logout()` that revokes session, clears tokens, and redirects to login
    - Implement `refreshSession()` for silent token refresh within 3 seconds
    - Implement `completeMfa()` for MFA challenge response
    - Create `packages/auth/src/hooks.ts` with `useAuth()`, `useRole()`, `useSession()` hooks
    - Handle session expiry: if refresh token is invalid, clear session data and redirect to login
    - _Requirements: 1.1, 1.2, 1.7, 1.8, 1.9_

  - [x] 2.2 Implement route guard component
    - Create `packages/auth/src/route-guard.tsx` implementing `RouteGuardProps`
    - Redirect unauthenticated users to login page within 2 seconds
    - Evaluate user role against required route permission before rendering
    - Redirect unauthorized users to Dashboard with access denied notification (auto-dismiss 5 seconds)
    - Handle indeterminate role by redirecting to login
    - Re-evaluate permissions on navigation events when role changes during session
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

  - [ ]* 2.3 Write unit tests for auth module
    - Test login flow success and failure scenarios
    - Test token refresh and session expiry handling
    - Test route guard role evaluation and redirect behavior
    - Test MFA challenge flow
    - _Requirements: 1.2, 1.3, 1.7, 1.8, 3.1, 3.6_

- [x] 3. Implement API client (packages/api-client)
  - [x] 3.1 Create HTTP client with interceptors
    - Create `packages/api-client/src/client.ts` with Axios instance configured for base URL
    - Implement request interceptor to attach Bearer authorization header from `getAccessToken()`
    - Implement response interceptor for 401 handling: refresh token and retry request
    - Implement retry logic: 3 retries with exponential backoff (1s, 2s, 4s) for network errors
    - Implement HTTP 429 handling: wait for Retry-After header duration (capped at 60s), fallback 5s
    - Implement 15-second request timeout with abort and error notification
    - Create `packages/api-client/src/errors.ts` for error normalization (`ApiError` type)
    - _Requirements: 1.7, 2.5, 2.8, 13.1, 13.2, 13.3_

  - [x] 3.2 Create React Query hooks for products domain
    - Create `packages/api-client/src/hooks/useProducts.ts` with `useProducts(params)`, `useProduct(id)`, `useUpdateProduct()`, `useApproveAttribute()`, `useOverrideAttribute()`, `useTransitionLifecycle()`
    - Implement optimistic updates with rollback on mutation failure
    - Configure stale time, cache time, and refetch strategies
    - Create `useProductSearch()` hook with 500ms debounce for search-as-you-type
    - Create `useProductExport()` mutation hook
    - Create `useProductUpload()` mutation hook for CSV upload
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.8, 5.9, 5.11_

  - [x] 3.3 Create React Query hooks for inventory, billing, channels, and team domains
    - Create `packages/api-client/src/hooks/useInventory.ts` with `useInventory()`, `useStockAdjustment()`, `useTransactionHistory()`
    - Create `packages/api-client/src/hooks/useBilling.ts` with `useBilling()`, `useInvoices()`, `usePlanChange()`
    - Create `packages/api-client/src/hooks/useChannels.ts` with `useChannels()`, `useConnectChannel()`, `useDisconnectChannel()`
    - Create `packages/api-client/src/hooks/useTeam.ts` with `useTeamMembers()`, `useInviteMember()`, `useChangeRole()`, `useRemoveMember()`
    - Create `packages/api-client/src/hooks/useWebhooks.ts` with `useWebhooks()`, `useCreateWebhook()`, `useToggleWebhook()`, `useDeleteWebhook()`
    - _Requirements: 7.1, 7.3, 7.5, 8.1, 8.2, 8.3, 8.6, 9.1, 9.2, 9.4, 10.1, 10.2, 10.4, 10.5, 11.1, 11.3, 11.5, 11.6_

  - [ ]* 3.4 Write unit tests for API client
    - Test retry logic with exponential backoff
    - Test 401 token refresh interceptor
    - Test 429 Retry-After handling
    - Test request timeout behavior
    - Test error normalization
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 4. Implement UI component library (packages/ui)
  - [x] 4.1 Create accessible primitive components
    - Implement `Sidebar` using Radix NavigationMenu with keyboard navigation, active state indicator, and collapse toggle
    - Implement `Modal` using Radix Dialog with focus trap, Escape to close, and focus return on dismiss
    - Implement `Toast` using Radix Toast with ARIA live region, auto-dismiss (8 seconds), and max 3 visible
    - Implement `Select` using Radix Select with keyboard support
    - Implement `Tabs` using Radix Tabs for settings page
    - Implement `ProgressBar` using Radix Progress for usage meters
    - Implement `SkipNav` for skip-to-content accessibility
    - Ensure all components have visible focus indicators (3:1 contrast, 2px perimeter)
    - _Requirements: 2.1, 2.4, 2.7, 14.1, 14.2, 14.5, 14.6_

  - [x] 4.2 Create data display and feedback components
    - Implement `DataTable` with pagination controls (configurable page size), sort indicators, ARIA labels, and loading skeleton
    - Implement `Badge` for lifecycle states, compliance status, moderation status
    - Implement `Card` and `StatCard` for dashboard metrics
    - Implement `Skeleton` loading placeholders
    - Implement `ErrorBoundary` fallback UI with reload option
    - Implement `Alert` for inline error/warning messages
    - Implement `Toast` notification container (max 3 simultaneous, oldest dismissed first)
    - _Requirements: 2.5, 2.7, 4.1, 4.2, 5.1, 13.4, 14.4_

  - [x] 4.3 Create form components
    - Implement `Input` with label association (aria-label / aria-labelledby), validation error display
    - Implement `FileUpload` component with drag-and-drop, file type/size validation
    - Implement form validation integration with Zod + React Hook Form
    - Implement `ConfirmationModal` for destructive actions (disconnect channel, remove user, delete webhook)
    - _Requirements: 5.9, 5.10, 6.1, 6.2, 14.3_

  - [ ]* 4.4 Write unit tests for UI components
    - Test keyboard navigation for Sidebar, Modal, Select
    - Test Toast auto-dismiss and max-count behavior
    - Test DataTable pagination and sorting
    - Test ErrorBoundary rendering fallback
    - Test focus management on Modal open/close
    - _Requirements: 14.1, 14.2, 14.5, 14.6_

- [x] 5. Checkpoint - Ensure shared packages build and tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement App Shell and layout
  - [x] 6.1 Create the seller dashboard root layout and providers
    - Create `apps/seller-dashboard/app/layout.tsx` with React Query Provider, Auth Provider, and Zustand stores
    - Configure React Query client with default retry and stale time settings
    - Set up Tailwind CSS with custom theme tokens
    - Add `<SkipNav>` component at top of layout
    - Use semantic HTML landmarks: `<nav>`, `<main>`, `<aside>`, `<header>`
    - _Requirements: 2.1, 14.1, 14.3_

  - [x] 6.2 Implement the App Shell dashboard layout
    - Create `apps/seller-dashboard/app/(dashboard)/layout.tsx` with Sidebar, top bar, and content area
    - Display user's display name (truncated at 30 chars with ellipsis), role, and organisation name (truncated at 40 chars) in top bar
    - Implement sidebar navigation with items filtered by user role
    - Implement sidebar collapse toggle (icon-only mode)
    - Implement responsive behavior: hamburger menu below 768px viewport width
    - Apply distinct background colour and vertical accent to active navigation item
    - Display non-blocking loading indicator in content area within 200ms of API request start
    - Implement connection status indicator and offline indicator in top bar
    - Display unread notification count badge in top bar
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 12.5, 13.5_

  - [x] 6.3 Implement notification system with WebSocket
    - Create WebSocket manager class with connection, reconnection (exponential backoff), and fallback polling
    - Create Zustand notification store managing notifications array (max 50), unread count, and connection status
    - Implement notification toast display within 3 seconds of event, visible for 8 seconds or until dismissed
    - Implement notification history dropdown accessible from top bar, showing most recent 50 with read/unread status
    - Implement mark-as-read functionality updating unread count within 1 second
    - On reconnection, retrieve missed notifications
    - Implement ARIA live region announcements for new notifications (`aria-live="polite"`)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 14.4_

  - [x] 6.4 Implement global error handling
    - Wrap content area with React Error Boundary displaying fallback UI with reload option
    - Implement error notification display: dismissible, auto-dismiss after 8 seconds, max 3 simultaneous
    - Implement HTTP 403 handling: display access denied message, no retry
    - Implement offline detection with persistent indicator in top bar, removed within 5 seconds of reconnection
    - Preserve user's unsaved form input across error boundary reloads
    - Announce error messages via `aria-live="assertive"` region
    - _Requirements: 2.7, 2.8, 13.1, 13.2, 13.4, 13.5, 13.6, 14.4_

  - [ ]* 6.5 Write unit tests for App Shell
    - Test sidebar navigation rendering based on role
    - Test sidebar collapse/expand behavior
    - Test responsive breakpoint (hamburger menu at < 768px)
    - Test notification toast display and auto-dismiss
    - Test error boundary fallback rendering
    - _Requirements: 2.1, 2.6, 2.7, 12.1_

- [x] 7. Implement Authentication pages
  - [x] 7.1 Create login page
    - Create `apps/seller-dashboard/app/(auth)/login/page.tsx`
    - Implement login form with email and password fields
    - Display generic error message on invalid credentials (not revealing email existence)
    - Handle account lockout display after 5 failed attempts within 15 minutes
    - Redirect to dashboard on successful authentication within 5 seconds
    - Integrate with auth module's `login()` function
    - _Requirements: 1.2, 1.3, 1.4_

  - [x] 7.2 Create registration and email verification pages
    - Create `apps/seller-dashboard/app/(auth)/register/page.tsx`
    - Implement registration form with email, password (12+ chars, uppercase, lowercase, digit, symbol), organisation name (2-100 chars), and contact email
    - Implement client-side validation with Zod schema and real-time feedback
    - Create `apps/seller-dashboard/app/(auth)/verify/page.tsx` for email verification code entry
    - On successful verification, redirect to login page
    - _Requirements: 1.5, 1.10_

  - [x] 7.3 Create password reset page
    - Create `apps/seller-dashboard/app/(auth)/reset-password/page.tsx`
    - Implement request reset form (email input) and reset confirmation form (code + new password)
    - Display reset confirmation form within 5 seconds of request
    - _Requirements: 1.6_

  - [ ]* 7.4 Write unit tests for auth pages
    - Test login form validation and error display
    - Test registration form validation rules
    - Test password reset flow
    - Test redirect behavior on successful login
    - _Requirements: 1.2, 1.3, 1.5, 1.6_

- [x] 8. Implement Dashboard page
  - [x] 8.1 Create dashboard page with summary metrics
    - Create `apps/seller-dashboard/app/(dashboard)/dashboard/page.tsx`
    - Display stat cards: total product count, pending review count, active listings count, low-stock item count
    - Display lifecycle state distribution as counts per state (DRAFT, INGESTED, ENRICHED, REVIEW, VALIDATED, EXPORT_READY, PUBLISHED, ARCHIVED)
    - Display 5 most recent platform events with event type, locale-formatted timestamp, and associated product title or entity ID
    - Implement click-through on product-related events navigating to product detail page
    - Handle click on event for non-existent product: show "product unavailable" notification, stay on dashboard
    - Display error message with retry action if dashboard data request fails
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 8.2 Write unit tests for dashboard
    - Test metric card rendering with mock data
    - Test event click navigation
    - Test error state with retry
    - _Requirements: 4.1, 4.4, 4.5_

- [x] 9. Implement Product Catalog pages
  - [x] 9.1 Create product list page with search and filters
    - Create `apps/seller-dashboard/app/(dashboard)/products/page.tsx`
    - Render paginated DataTable showing SKU, title, brand, lifecycle state, last updated (default 25 rows)
    - Implement search field filtering by SKU, title, or brand (min 2 chars, results within 500ms)
    - Implement lifecycle state filter dropdown
    - Implement row click navigation to product detail page
    - Hide create/edit/delete controls for viewer role
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 3.2_

  - [x] 9.2 Create product detail page
    - Create `apps/seller-dashboard/app/(dashboard)/products/[productId]/page.tsx`
    - Display canonical fields (SKU, title, description, brand, attributes), variant details
    - Display image gallery with hero image visually distinguished
    - Display enrichment layer: AI-generated attributes with confidence scores and review flags
    - Display category mappings and compliance reports
    - Implement inline attribute editing for editor+ roles with optimistic update and rollback on error
    - Implement AI-enriched attribute approval with user identity as approver
    - Revert field to previous value on API error, retain unsaved changes in form
    - _Requirements: 5.5, 5.6, 5.7, 5.8_

  - [x] 9.3 Implement product image management
    - Implement image upload accepting JPEG, PNG, WebP up to 10 MB
    - Display moderation status badge (APPROVED, REJECTED, PENDING) on image thumbnails
    - Implement hero image designation (only APPROVED images allowed)
    - Display upscale indicator showing which channel triggered the upscale
    - Enforce max 15 images per product; prevent further uploads at limit
    - Display error messages for upload failures (format, size, network errors)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 9.4 Implement CSV upload and product export
    - Implement CSV upload UI: accept file up to 10 MB, validate required headers (SKU, title, brand), max 10,000 rows
    - Display validation errors with row numbers (up to first 50 errors)
    - Implement bulk product selection (up to 500) and export to selected channel/format (CSV or JSON)
    - Display error message on export failure, preserve product selection
    - _Requirements: 5.9, 5.10, 5.11, 5.12_

  - [ ]* 9.5 Write unit tests for product catalog
    - Test product list pagination and search debounce
    - Test lifecycle state filter
    - Test image upload validation (format, size, max count)
    - Test CSV validation error display
    - Test hero image designation rules
    - _Requirements: 5.1, 5.2, 5.9, 5.10, 6.1, 6.5_

- [x] 10. Implement Inventory Module
  - [x] 10.1 Create inventory page
    - Create `apps/seller-dashboard/app/(dashboard)/inventory/page.tsx`
    - Display inventory table: SKU, warehouse ID, on-hand, reserved, available — sorted by SKU ascending
    - Implement warehouse filter dropdown
    - Apply visual indicator (background/icon) for zero or negative available quantity
    - Apply separate visual indicator for available quantity at or below low-stock threshold
    - Implement row click to show transaction history (most recent 50 entries, reverse chronological)
    - Display delta quantity, previous quantity, new quantity, source, actor, and timestamp for each transaction
    - _Requirements: 7.1, 7.2, 7.5, 7.7_

  - [x] 10.2 Implement manual stock adjustment
    - Implement stock adjustment form: integer delta (-999,999 to 999,999), reason (1-200 chars), source="manual"
    - Validate that adjustment won't cause on-hand to go negative (display error, prevent submission)
    - Disable adjustment form for viewer role
    - On success, refresh displayed quantities
    - On failure, display error, preserve entered values, leave quantities unchanged
    - _Requirements: 7.3, 7.4, 7.6, 7.8_

  - [ ]* 10.3 Write unit tests for inventory module
    - Test inventory table rendering and sorting
    - Test warehouse filter
    - Test stock adjustment validation (negative on-hand prevention)
    - Test viewer role disabling adjustment controls
    - _Requirements: 7.1, 7.3, 7.6, 7.8_

- [x] 11. Checkpoint - Ensure all tests pass for core modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Billing Module
  - [x] 12.1 Create billing page
    - Create `apps/seller-dashboard/app/(dashboard)/billing/page.tsx`
    - Display current plan, billing cycle, subscription status, period dates (ISO 8601)
    - Display usage counters (enrichment calls, image calls, CSV exports) with consumed vs. max allowed
    - Display paginated invoice list (default 20 items): amount, currency, status, billing period, PDF link
    - Implement PDF download via presigned URL (5 min validity)
    - Handle unavailable PDF: display error, disable download link
    - Implement plan change flow: show available plans with limits/pricing, require confirmation
    - Deny access for non-owner roles with appropriate message
    - Display error with retry if billing data fails to load
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 12.2 Write unit tests for billing module
    - Test billing overview rendering
    - Test invoice list pagination
    - Test owner role access control
    - Test error state with retry
    - _Requirements: 8.1, 8.3, 8.7, 8.8_

- [x] 13. Implement Channel and Webhook Management
  - [x] 13.1 Create channels page
    - Create `apps/seller-dashboard/app/(dashboard)/settings/channels/page.tsx`
    - Display all supported channels (Takealot, Amazon, Makro, Shopify, WooCommerce, Custom) with connection status
    - Show connection date and channel-specific details (shop URL for Shopify)
    - Implement channel connection via OAuth redirect for admin+ roles
    - Handle OAuth failure/cancel: display error, leave status unchanged
    - Implement channel disconnection with confirmation prompt
    - Handle disconnection failure: display error, leave status unchanged
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 13.2 Create webhook settings page
    - Create `apps/seller-dashboard/app/(dashboard)/settings/webhooks/page.tsx`
    - Display configured webhooks: URL, subscribed events, active status (sorted by creation date descending, max 25)
    - Display empty state when no webhooks configured
    - Implement add webhook: validate URL (https://, max 2048 chars, URI format), require 1+ event subscription
    - Prevent adding if 25 webhook limit reached
    - Implement toggle active status with success confirmation within 3 seconds
    - Implement delete webhook with confirmation prompt
    - Display error messages for failed operations, preserve previous state, allow retry
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

  - [ ]* 13.3 Write unit tests for channels and webhooks
    - Test channel list rendering with connection status
    - Test webhook URL validation
    - Test webhook limit enforcement
    - Test confirmation prompts for destructive actions
    - _Requirements: 9.1, 11.3, 11.4_

- [x] 14. Implement Team Management
  - [x] 14.1 Create team management page
    - Create `apps/seller-dashboard/app/(dashboard)/settings/team/page.tsx`
    - Display team member list: name, email, assigned role
    - Implement invite form: valid email + role selection (viewer, editor, admin) for owner role
    - Handle invitation failure (including duplicate email): display error, preserve input
    - Implement role change submission for owner role, display updated role on success
    - Implement member removal with confirmation prompt for owner role
    - Disable role change and removal controls for current user's own row
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ]* 14.2 Write unit tests for team management
    - Test team member list rendering
    - Test invite form validation
    - Test self-modification prevention
    - Test confirmation prompt for removal
    - _Requirements: 10.1, 10.2, 10.6_

- [x] 15. Implement route configuration and access control wiring
  - [x] 15.1 Configure all routes with role-based access control
    - Define route permission map: viewer (Dashboard, Products read-only), editor (+ Inventory, Exports), admin (+ Channels, Webhooks), owner (+ Team, Billing)
    - Wrap all `(dashboard)` routes with `RouteGuard` component
    - Implement access denied redirect to Dashboard with notification (auto-dismiss 5 seconds)
    - Implement notification click navigation routing: product events → product detail, inventory events → inventory, billing events → billing, channel events → channels
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 12.3_

  - [ ]* 15.2 Write integration tests for route access control
    - Test viewer cannot access billing, team, channels
    - Test editor cannot access team, billing
    - Test admin cannot access team, billing
    - Test owner has access to all routes
    - Test redirect behavior for unauthorized access
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 16. Final checkpoint - Ensure all tests pass and app builds successfully
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design has no Correctness Properties section, so property-based tests are not included
- Unit and integration tests validate specific examples and edge cases
- All UI components must meet WCAG 2.1 Level AA conformance (Requirement 14)
- The existing backend services and infrastructure remain unchanged

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.2", "4.3"] },
    { "id": 4, "tasks": ["2.3", "3.3", "3.4", "4.4"] },
    { "id": 5, "tasks": ["6.1", "7.1", "7.2", "7.3"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4"] },
    { "id": 7, "tasks": ["6.5", "7.4", "8.1"] },
    { "id": 8, "tasks": ["8.2", "9.1", "10.1", "12.1"] },
    { "id": 9, "tasks": ["9.2", "9.3", "10.2", "13.1", "13.2", "14.1"] },
    { "id": 10, "tasks": ["9.4", "9.5", "10.3", "12.2", "13.3", "14.2"] },
    { "id": 11, "tasks": ["15.1"] },
    { "id": 12, "tasks": ["15.2"] }
  ]
}
```
