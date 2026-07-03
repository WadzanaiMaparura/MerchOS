# Requirements Document

## Introduction

The MerchOS Admin Dashboard is an internal tool for MerchOS platform operators to monitor system health, manage tenants, configure compliance rules, administer billing, view audit logs, manage taxonomies, and respond to alerts. It is a Next.js 14 App Router application deployed on AWS Amplify Gen 2, authenticating operators via a dedicated Admin Cognito Pool with mandatory TOTP MFA. The Admin Dashboard communicates with the same MerchOS REST API at `/v1/*` and shares packages (`@merch-os/types`, `@merch-os/auth`, `@merch-os/api-client`, `@merch-os/ui`) with the existing Seller Dashboard.

## Glossary

- **Admin_Dashboard**: The Next.js 14 App Router application providing platform operators with monitoring and management capabilities.
- **Operator**: An authenticated user in the Admin Cognito Pool with the "operator" role and mandatory TOTP MFA enabled.
- **Admin_Auth_Module**: The authentication module that handles login, TOTP MFA verification, and session management against the Admin Cognito Pool.
- **Admin_App_Shell**: The persistent layout including navigation sidebar, top bar, and content area for the Admin Dashboard.
- **Health_Monitor**: The module that displays platform infrastructure metrics including Lambda error rates, Step Functions failures, SQS queue depths, and DynamoDB consumed capacity.
- **Tenant_Manager**: The module that allows operators to view, search, suspend, and activate tenant accounts and view tenant details.
- **Compliance_Editor**: The module that provides per-channel JSON schema-driven forms for editing compliance rules.
- **Taxonomy_Manager**: The module that displays channel taxonomy information and allows operators to trigger taxonomy refreshes.
- **Audit_Log_Viewer**: The module that provides a searchable, filterable view of the platform audit trail.
- **Alert_Dashboard**: The module that displays Lambda error rate alerts and tracks alert resolution.
- **Billing_Admin**: The module that allows operators to view tenant billing information and override subscription plans.
- **API_Client**: The HTTP client layer that communicates with the MerchOS backend API, handles token refresh, and attaches authorization headers.
- **Router**: The client-side routing system that maps URL paths to page components and enforces authentication.

## Requirements

### Requirement 1: Admin Authentication and Session Management

**User Story:** As a platform operator, I want to securely log in with mandatory TOTP multi-factor authentication, so that only authorized personnel can access platform administration tools.

#### Acceptance Criteria

1. WHEN an Operator navigates to the Admin_Dashboard without a valid access token or with an expired access token that cannot be refreshed, THE Admin_Auth_Module SHALL redirect the Operator to the admin login page within 2 seconds.
2. WHEN an Operator submits valid email and password credentials on the admin login page, THE Admin_Auth_Module SHALL authenticate against the Admin Cognito Pool using PKCE and present the TOTP MFA challenge screen.
3. WHEN an Operator submits a valid 6-digit TOTP code within 30 seconds of code generation, THE Admin_Auth_Module SHALL complete authentication, establish a session, and redirect the Operator to the health dashboard within 3 seconds of TOTP submission.
4. IF an Operator submits an invalid TOTP code, THEN THE Admin_Auth_Module SHALL display an error message indicating the code is invalid and allow the Operator to re-enter a TOTP code without restarting the login flow.
5. IF an Operator submits 5 consecutive failed login attempts (credential or TOTP failures combined) within a 15-minute window, THEN THE Admin_Auth_Module SHALL temporarily lock the account for 30 minutes and display a message indicating the account is locked.
6. WHEN the access token expires, THE API_Client SHALL silently refresh the token using the stored refresh token without interrupting the Operator's workflow, completing the refresh within 3 seconds.
7. IF the refresh token is expired or invalid, THEN THE Admin_Auth_Module SHALL redirect the Operator to the admin login page and clear all stored session data from the browser within 2 seconds.
8. WHEN an Operator clicks the logout button, THE Admin_Auth_Module SHALL revoke the session, clear stored tokens from the browser, and redirect to the admin login page within 2 seconds.
9. WHEN an Operator's session has been inactive for 30 minutes, THE Admin_Auth_Module SHALL expire the session, redirect to the login page, and display a message indicating the session timed out due to inactivity.

### Requirement 2: Admin Application Shell and Navigation

**User Story:** As a platform operator, I want a consistent navigation layout with access to all admin modules, so that I can efficiently switch between platform management tasks.

#### Acceptance Criteria

1. THE Admin_App_Shell SHALL display a sidebar with navigation links to Health, Tenants, Compliance, Taxonomy, Audit Log, Alerts, and Billing sections, and a toggle control that collapses the sidebar to icon-only mode or expands it to show full labels.
2. THE Admin_App_Shell SHALL display the current Operator's email address (truncated with ellipsis beyond 30 characters) and the role "operator" in the top bar.
3. WHEN an Operator clicks a navigation link, THE Router SHALL render the corresponding page without a full-page reload.
4. THE Admin_App_Shell SHALL visually distinguish the currently active navigation item from inactive items by applying a distinct background colour and a vertical accent indicator to the active item.
5. WHILE the application is loading data from the API, THE Admin_App_Shell SHALL display a non-blocking loading indicator in the content area within 200 milliseconds of the request starting.
6. THE Admin_App_Shell SHALL be responsive, collapsing the sidebar into a hamburger menu on viewports narrower than 768 pixels.
7. IF an API request returns an error, THEN THE Admin_App_Shell SHALL display a dismissible error notification showing the HTTP status code and a summary of the failure, auto-dismiss the notification after 8 seconds if the Operator does not dismiss it manually, and display no more than 3 notifications simultaneously (oldest dismissed first when exceeded).
8. WHEN the Admin_Dashboard root page loads, THE Router SHALL redirect the Operator to the /health route.

### Requirement 3: Platform Health Monitoring

**User Story:** As a platform operator, I want to view real-time infrastructure health metrics, so that I can identify and respond to platform issues proactively.

#### Acceptance Criteria

1. WHEN the Health_Monitor page loads, THE Health_Monitor SHALL display time-series charts for Lambda error rates, Step Functions failure counts, SQS queue depths, and DynamoDB consumed capacity units, using Recharts line or area charts with data points at 5-minute intervals for the selected time range.
2. WHEN the Health_Monitor page loads, THE Health_Monitor SHALL display summary cards showing the total active tenant count and total products processed in the current day as numeric values.
3. WHEN an Operator selects a time range filter (1 hour, 6 hours, 24 hours, 7 days), THE Health_Monitor SHALL refresh all metric charts to display data for the selected time range within 5 seconds.
4. WHEN an Operator hovers over a data point on a metric chart, THE Health_Monitor SHALL display a tooltip showing the exact timestamp (ISO 8601 format) and metric value with the appropriate unit label.
5. IF the Health_Monitor fails to retrieve metric data from the API, THEN THE Health_Monitor SHALL display an error message indicating that health data is temporarily unavailable and provide a retry action.
6. WHILE metric data is loading, THE Health_Monitor SHALL display skeleton placeholders matching the chart dimensions until data arrives.
7. WHEN an Operator clicks a refresh button, THE Health_Monitor SHALL fetch the latest metric data from the API and update all charts, displaying a loading indicator during the fetch.

### Requirement 4: Tenant Management

**User Story:** As a platform operator, I want to view and manage all tenants on the platform, so that I can support customers and enforce platform policies.

#### Acceptance Criteria

1. WHEN the Tenant_Manager page loads, THE Tenant_Manager SHALL display a paginated table of tenants showing tenant name, plan (starter, growth, professional, or enterprise), status (active or suspended), user count, product count, and registration date, with a default page size of 25 rows.
2. WHEN an Operator enters at least 2 characters into the search field, THE Tenant_Manager SHALL filter the tenant list by matching against tenant name or tenant ID and display results within 500 milliseconds of the last keystroke.
3. WHEN an Operator selects a status filter (all, active, or suspended), THE Tenant_Manager SHALL display only tenants matching the selected status.
4. WHEN an Operator selects a plan filter (all, starter, growth, professional, or enterprise), THE Tenant_Manager SHALL display only tenants on the selected plan.
5. WHEN an Operator clicks on a tenant row, THE Tenant_Manager SHALL display a tenant detail panel showing full tenant information including tenant ID, name, plan, status, user count, product count, registration date, and most recent activity timestamp.
6. WHEN an Operator clicks the suspend button on an active tenant, THE Tenant_Manager SHALL display a confirmation prompt requiring the Operator to enter a suspension reason (1 to 500 characters), and upon confirmation SHALL submit the suspension request to the API and update the tenant status to suspended.
7. WHEN an Operator clicks the activate button on a suspended tenant, THE Tenant_Manager SHALL display a confirmation prompt, and upon confirmation SHALL submit the activation request to the API and update the tenant status to active.
8. IF a tenant suspend or activate request fails, THEN THE Tenant_Manager SHALL display an error message indicating the operation that failed and leave the tenant status unchanged.
9. IF the Tenant_Manager fails to load tenant data from the API, THEN THE Tenant_Manager SHALL display an error message indicating that tenant data is temporarily unavailable and provide a retry action.

### Requirement 5: Compliance Rule Editor

**User Story:** As a platform operator, I want to edit per-channel compliance rules using structured forms, so that I can maintain and update validation rules without modifying code.

#### Acceptance Criteria

1. WHEN the Compliance_Editor page loads, THE Compliance_Editor SHALL display a list of all supported channels (Takealot, Amazon, Makro, Shopify, WooCommerce, Custom) with the current compliance rule version and last updated timestamp for each channel.
2. WHEN an Operator selects a channel from the list, THE Compliance_Editor SHALL fetch the channel's JSON schema and render a form dynamically generated from that schema, pre-populated with the current rule values.
3. WHEN an Operator modifies compliance rule fields and clicks save, THE Compliance_Editor SHALL validate the form values against the JSON schema, and if validation passes SHALL submit the updated rules to the API and display a success confirmation.
4. IF the form values fail JSON schema validation on save, THEN THE Compliance_Editor SHALL display validation error messages adjacent to the invalid fields indicating the constraint that was violated, and SHALL NOT submit the rules to the API.
5. WHEN an Operator saves compliance rules successfully, THE Compliance_Editor SHALL increment the rule version number displayed for that channel and update the last updated timestamp.
6. IF the compliance rule save request fails due to an API error, THEN THE Compliance_Editor SHALL display an error message indicating the save failed and preserve the Operator's unsaved changes in the form.
7. WHEN an Operator navigates away from the Compliance_Editor with unsaved changes, THE Compliance_Editor SHALL display a confirmation prompt warning that unsaved changes will be lost.

### Requirement 6: Taxonomy Management

**User Story:** As a platform operator, I want to view channel taxonomy status and trigger refreshes, so that I can ensure category mappings remain current.

#### Acceptance Criteria

1. WHEN the Taxonomy_Manager page loads, THE Taxonomy_Manager SHALL display a table of all channel taxonomies showing channel name, taxonomy version, last refresh date, node count, and status (CURRENT, STALE, or REFRESHING).
2. THE Taxonomy_Manager SHALL visually distinguish taxonomies with STALE status from those with CURRENT status using a distinct colour or icon indicator.
3. WHEN an Operator clicks the refresh button for a specific channel taxonomy, THE Taxonomy_Manager SHALL submit a taxonomy refresh request to the API, update the displayed status to REFRESHING, and disable the refresh button for that channel until the status changes.
4. IF a taxonomy refresh request fails, THEN THE Taxonomy_Manager SHALL display an error message indicating which channel's refresh failed and revert the displayed status to its previous value.
5. WHILE a taxonomy has REFRESHING status, THE Taxonomy_Manager SHALL display a progress indicator on that taxonomy row and poll the API every 10 seconds to check for status updates until the status transitions to CURRENT or STALE.
6. IF the Taxonomy_Manager fails to load taxonomy data from the API, THEN THE Taxonomy_Manager SHALL display an error message indicating taxonomy data is temporarily unavailable and provide a retry action.

### Requirement 7: Audit Log Viewer

**User Story:** As a platform operator, I want to search and browse the platform audit trail, so that I can investigate actions taken on the platform for security and compliance purposes.

#### Acceptance Criteria

1. WHEN the Audit_Log_Viewer page loads, THE Audit_Log_Viewer SHALL display a paginated table of audit events showing timestamp (ISO 8601), actor (email or system identifier), action type, resource identifier, tenant ID, and a details summary, with a default page size of 50 rows, sorted by timestamp in descending order.
2. WHEN an Operator enters a search term of at least 3 characters, THE Audit_Log_Viewer SHALL filter audit events by matching against actor, action type, resource identifier, or tenant ID and display results within 1 second of the last keystroke.
3. WHEN an Operator selects a date range filter with a start date and end date, THE Audit_Log_Viewer SHALL display only audit events with timestamps within the selected range (inclusive of both dates).
4. WHEN an Operator selects an action type filter from the available action types, THE Audit_Log_Viewer SHALL display only audit events matching the selected action type.
5. WHEN an Operator clicks on an audit event row, THE Audit_Log_Viewer SHALL expand the row or display a detail panel showing the full event details as formatted JSON.
6. IF the Audit_Log_Viewer fails to load audit data from the API, THEN THE Audit_Log_Viewer SHALL display an error message indicating that audit data is temporarily unavailable and provide a retry action.
7. WHEN an Operator applies multiple filters simultaneously (search term, date range, action type), THE Audit_Log_Viewer SHALL apply all filters as a logical AND and display only events matching all active criteria.

### Requirement 8: Alert Dashboard

**User Story:** As a platform operator, I want to view and resolve Lambda error rate alerts, so that I can track platform issues and document their resolution.

#### Acceptance Criteria

1. WHEN the Alert_Dashboard page loads, THE Alert_Dashboard SHALL display a list of alerts showing function name, current error rate percentage, error count, triggered-at timestamp, and resolution status (resolved or unresolved), sorted with unresolved alerts appearing before resolved alerts.
2. THE Alert_Dashboard SHALL visually distinguish unresolved alerts from resolved alerts using distinct background colours or icon indicators.
3. WHEN an Operator clicks the resolve button on an unresolved alert, THE Alert_Dashboard SHALL display a form requiring a resolution note (1 to 1000 characters), and upon submission SHALL mark the alert as resolved via the API with the resolution timestamp and note.
4. IF an alert resolution request fails, THEN THE Alert_Dashboard SHALL display an error message indicating the resolution was not saved and leave the alert in unresolved status.
5. WHEN an Operator selects a status filter (all, unresolved, or resolved), THE Alert_Dashboard SHALL display only alerts matching the selected status.
6. WHEN the Alert_Dashboard page loads, THE Alert_Dashboard SHALL display a count badge in the navigation sidebar showing the number of unresolved alerts.
7. IF the Alert_Dashboard fails to load alert data from the API, THEN THE Alert_Dashboard SHALL display an error message indicating that alert data is temporarily unavailable and provide a retry action.

### Requirement 9: Billing Administration

**User Story:** As a platform operator, I want to view tenant billing details and override subscription plans, so that I can resolve billing issues and apply custom pricing.

#### Acceptance Criteria

1. WHEN the Billing_Admin page loads, THE Billing_Admin SHALL display a paginated table of tenants showing tenant name, current plan, billing cycle (monthly or annual), subscription status (active, past_due, canceled, trialing, incomplete, incomplete_expired, or unpaid), and current period end date, with a default page size of 25 rows.
2. WHEN an Operator enters at least 2 characters into the search field, THE Billing_Admin SHALL filter the billing list by matching against tenant name or tenant ID and display results within 500 milliseconds of the last keystroke.
3. WHEN an Operator clicks on a tenant row in the billing table, THE Billing_Admin SHALL display a detail panel showing the tenant's full billing information including plan name, billing cycle, status, usage counters (enrichment calls, image calls, CSV exports) with plan limits, and a list of recent invoices.
4. WHEN an Operator initiates a plan override for a tenant, THE Billing_Admin SHALL display a form showing the available plans (starter, growth, professional, enterprise) and require the Operator to select a target plan and enter an override reason (1 to 500 characters), and upon confirmation SHALL submit the plan override request to the API.
5. IF a plan override request fails, THEN THE Billing_Admin SHALL display an error message indicating the override was not applied and preserve the tenant's current plan.
6. WHEN a plan override is successfully applied, THE Billing_Admin SHALL update the displayed plan for the affected tenant and display a success confirmation showing the previous plan and new plan.
7. WHEN an Operator selects a subscription status filter, THE Billing_Admin SHALL display only tenants matching the selected subscription status.
8. IF the Billing_Admin fails to load billing data from the API, THEN THE Billing_Admin SHALL display an error message indicating that billing data is temporarily unavailable and provide a retry action.

### Requirement 10: Error Handling and Resilience

**User Story:** As a platform operator, I want the Admin Dashboard to handle errors gracefully, so that I can continue working without losing context during transient failures.

#### Acceptance Criteria

1. IF an API request fails due to a network error, THEN THE API_Client SHALL retry the request up to 3 times with exponential backoff starting at 1 second and doubling each subsequent attempt (1s, 2s, 4s), and IF all 3 retries are exhausted, THEN THE API_Client SHALL display an error notification indicating that the operation failed and the Operator may try again.
2. IF an API request returns HTTP 401 and the token refresh also fails, THEN THE Admin_Auth_Module SHALL redirect the Operator to the login page and clear all stored session data.
3. IF an API request returns HTTP 403, THEN THE Admin_App_Shell SHALL display an access denied message and not retry the request.
4. IF an API request returns HTTP 429 and the response includes a Retry-After header, THEN THE API_Client SHALL wait for the duration specified in the Retry-After header (capped at a maximum of 60 seconds) before retrying, up to a maximum of 3 retry attempts.
5. IF an unhandled exception occurs in a page component, THEN THE Admin_App_Shell SHALL display a fallback error boundary with an option to reload the page, without crashing the entire application.
6. WHILE the application detects no network connectivity, THE Admin_App_Shell SHALL display a persistent offline indicator in the top bar. WHEN network connectivity is restored, THE Admin_App_Shell SHALL remove the offline indicator within 5 seconds of detecting reconnection.

### Requirement 11: Accessibility

**User Story:** As a platform operator using assistive technologies, I want the Admin Dashboard to be fully accessible, so that I can perform all administrative tasks independently.

#### Acceptance Criteria

1. THE Admin_App_Shell SHALL achieve WCAG 2.1 Level AA conformance for all interactive elements, including keyboard navigation, focus management, and screen reader compatibility, such that no interactive element requires a pointer-only interaction without a keyboard-equivalent action.
2. WHEN an Operator navigates via keyboard, THE Admin_App_Shell SHALL display a visible focus indicator on the focused element with a minimum contrast ratio of 3:1 against adjacent colors and a minimum area of 2px on the perimeter of the element.
3. THE Admin_App_Shell SHALL use semantic HTML landmarks (nav, main, aside, header) to structure page regions for screen reader navigation, and SHALL programmatically associate every form input with a text label using either a `<label>` element, `aria-label`, or `aria-labelledby` attribute.
4. WHEN dynamic content updates occur (metric chart refreshes, table data loading, form validation errors, alert status changes), THE Admin_App_Shell SHALL announce the change to assistive technologies using ARIA live regions with `aria-live="assertive"` for error messages and form validation failures, and `aria-live="polite"` for informational updates and data refreshes.
5. WHILE an Operator is navigating via keyboard, THE Admin_App_Shell SHALL ensure that focus follows a logical reading order matching the visual layout, and SHALL NOT trap focus within any component unless the component provides a documented mechanism to exit (such as the Escape key for modal dialogs).
6. WHEN a modal dialog, dropdown menu, or popover is opened, THE Admin_App_Shell SHALL move focus to the first focusable element within that component, and WHEN the component is dismissed, THE Admin_App_Shell SHALL return focus to the element that triggered the component.
