# Requirements Document

## Introduction

MerchOS Website is the seller-facing single-page application (SPA) for the MerchOS multi-tenant marketplace product management platform. It provides authenticated sellers with a dashboard to manage products through their full lifecycle, monitor inventory across warehouses, view billing and subscription details, configure channel integrations, and manage team members — all scoped to the seller's tenant. The frontend communicates with the existing MerchOS backend via REST APIs and authenticates through the AWS Cognito tenant user pool using PKCE-based OAuth 2.0.

## Glossary

- **Dashboard**: The primary landing page shown after login, displaying summary metrics and recent activity for the authenticated tenant.
- **Product_Catalog**: The module that displays, filters, and manages the tenant's product records and their lifecycle states.
- **Inventory_Module**: The module that displays current stock levels and transaction history across warehouses.
- **Billing_Module**: The module that displays subscription details, usage counters, invoices, and plan management.
- **Team_Module**: The module that allows owners to invite, remove, and modify roles for tenant users.
- **Channel_Module**: The module that manages marketplace channel integrations and their connection status.
- **Auth_Module**: The module responsible for login, registration, password recovery, and session management via Cognito.
- **App_Shell**: The persistent layout including navigation sidebar, top bar, notifications area, and content area.
- **Tenant_User**: A seller user authenticated against the Cognito tenant pool with a role (viewer, editor, admin, or owner).
- **API_Client**: The HTTP client layer that communicates with the MerchOS backend API, handles token refresh, and attaches authorization headers.
- **Router**: The client-side routing system that maps URL paths to page components and enforces route-level access control.

## Requirements

### Requirement 1: Authentication and Session Management

**User Story:** As a seller, I want to securely log in, register, and manage my session, so that I can access my tenant's data safely.

#### Acceptance Criteria

1. WHEN a Tenant_User navigates to the application without a valid access token or with an expired access token that cannot be refreshed, THE Auth_Module SHALL redirect the Tenant_User to the login page within 2 seconds.
2. WHEN a Tenant_User submits valid email and password credentials, THE Auth_Module SHALL authenticate against the Cognito tenant pool using SRP with PKCE, establish a session, and redirect the Tenant_User to the dashboard within 5 seconds of submission.
3. WHEN a Tenant_User submits invalid credentials, THE Auth_Module SHALL display an error message indicating authentication failure without revealing whether the email exists, and SHALL respond within 5 seconds of submission.
4. IF a Tenant_User submits 5 consecutive failed login attempts within a 15-minute window, THEN THE Auth_Module SHALL temporarily lock the account for 15 minutes and display a message indicating the account is locked.
5. WHEN a new seller submits the registration form with a valid email, a password meeting the policy of at least 12 characters including uppercase, lowercase, digit, and symbol, an organisation name between 2 and 100 characters, and a contact email address, THE Auth_Module SHALL create a Cognito account and prompt for email verification.
6. WHEN a Tenant_User requests a password reset, THE Auth_Module SHALL send a reset code valid for 60 minutes to the registered email and display the reset confirmation form within 5 seconds of the request.
7. WHEN the access token expires, THE API_Client SHALL silently refresh the token using the stored refresh token without interrupting the Tenant_User's workflow, completing the refresh within 3 seconds.
8. IF the refresh token is expired or invalid, THEN THE Auth_Module SHALL redirect the Tenant_User to the login page and clear all stored session data from the browser within 2 seconds.
9. WHEN a Tenant_User clicks the logout button, THE Auth_Module SHALL revoke the session, clear stored tokens from the browser, and redirect to the login page within 2 seconds.
10. WHEN a new seller completes email verification by entering the correct verification code, THE Auth_Module SHALL activate the account and redirect the Tenant_User to the login page.

### Requirement 2: Application Shell and Navigation

**User Story:** As a seller, I want a consistent navigation layout, so that I can move between sections of the application efficiently.

#### Acceptance Criteria

1. THE App_Shell SHALL display a sidebar with navigation links to Dashboard, Products, Inventory, Billing, Channels, and Team sections, and a toggle control that collapses the sidebar to icon-only mode or expands it to show full labels.
2. THE App_Shell SHALL display the current Tenant_User's display name (truncated with ellipsis beyond 30 characters), role, and organisation name (truncated with ellipsis beyond 40 characters) in the top bar.
3. WHEN a Tenant_User clicks a navigation link, THE Router SHALL render the corresponding page without a full-page reload.
4. THE App_Shell SHALL visually distinguish the currently active navigation item from inactive items by applying a distinct background colour and a vertical accent indicator to the active item.
5. WHILE the application is loading data from the API, THE App_Shell SHALL display a non-blocking loading indicator in the content area within 200 milliseconds of the request starting.
6. THE App_Shell SHALL be responsive, collapsing the sidebar into a hamburger menu on viewports narrower than 768 pixels.
7. IF an API request returns an error, THEN THE App_Shell SHALL display a dismissible error notification showing a summary of the failure, auto-dismiss the notification after 8 seconds if the user does not dismiss it manually, and display no more than 3 notifications simultaneously (oldest dismissed first when exceeded).
8. IF an API request does not receive a response within 15 seconds, THEN THE App_Shell SHALL cancel the request, hide the loading indicator, and display an error notification indicating a timeout occurred.

### Requirement 3: Role-Based Route Access Control

**User Story:** As a tenant owner, I want the interface to enforce role-based access, so that team members only see features they are permitted to use.

#### Acceptance Criteria

1. WHEN a Tenant_User navigates to any route, THE Router SHALL evaluate the Tenant_User's role against the required permission for that route before rendering the page component.
2. WHEN a Tenant_User with the viewer role navigates to the application, THE Router SHALL grant access only to Product_Catalog pages and the Dashboard, and SHALL hide all create, edit, and delete controls on Product_Catalog pages so that only viewing of data is possible.
3. WHEN a Tenant_User with the editor role navigates to the application, THE Router SHALL grant access to Dashboard, Product_Catalog, Inventory_Module, and the export route.
4. WHEN a Tenant_User with the admin role navigates to the application, THE Router SHALL grant access to Dashboard, Product_Catalog, Inventory_Module, Channel_Module, and webhook settings.
5. WHEN a Tenant_User with the owner role navigates to the application, THE Router SHALL grant access to all modules including Team_Module and Billing_Module.
6. IF a Tenant_User attempts to navigate to a route for which their role is not permitted, THEN THE Router SHALL redirect to the Dashboard and display an access denied notification that auto-dismisses after 5 seconds or upon user dismissal, whichever occurs first.
7. WHEN a Tenant_User's role is updated during an active session, THE Router SHALL re-evaluate route permissions on the next navigation event and revoke or grant access according to the updated role without requiring a full page reload.
8. IF a Tenant_User's role cannot be determined from the session context, THEN THE Router SHALL redirect the Tenant_User to the login page and prevent access to any protected route.

### Requirement 4: Dashboard

**User Story:** As a seller, I want to see a summary of my store's status at a glance, so that I can prioritize my work.

#### Acceptance Criteria

1. WHEN the Dashboard loads, THE Dashboard SHALL display the total product count, products pending review (lifecycleState = REVIEW), active listings count (lifecycleState = PUBLISHED), and low-stock item count (variants where available quantity is below the tenant-configured low-stock threshold) for the authenticated tenant.
2. WHEN the Dashboard loads, THE Dashboard SHALL display the current lifecycle state distribution as a count per state (DRAFT, INGESTED, ENRICHED, REVIEW, VALIDATED, EXPORT_READY, PUBLISHED, ARCHIVED), with each state label and its numeric count visible simultaneously.
3. WHEN the Dashboard loads, THE Dashboard SHALL display the five most recent platform events for the tenant, filtered to event types defined in the platform EventType set, showing event type, timestamp in the tenant's locale format, and the associated product title or entity identifier.
4. WHEN a Tenant_User clicks on an event in the recent activity list that is associated with a product (event types prefixed with "product.", "compliance.", "listing.", "ingestion.", or "image."), THE Router SHALL navigate to the corresponding product detail page.
5. IF the Dashboard data request fails or returns an error, THEN THE Dashboard SHALL display an error message indicating that summary data could not be loaded and SHALL provide a retry action.
6. IF a Tenant_User clicks on a product-related event whose associated product no longer exists, THEN THE Dashboard SHALL display a notification indicating the product is unavailable and SHALL remain on the Dashboard page.

### Requirement 5: Product Catalog Management

**User Story:** As a seller, I want to browse, search, and manage my products, so that I can prepare them for marketplace publishing.

#### Acceptance Criteria

1. WHEN the Product_Catalog page loads, THE Product_Catalog SHALL display a paginated table of products showing SKU, title, brand, lifecycle state, and last updated timestamp, with a default page size of 25 rows and navigation controls to move between pages.
2. WHEN a Tenant_User enters at least 2 characters into the search field, THE Product_Catalog SHALL filter the product list by matching against SKU, title, or brand fields and display results within 500 milliseconds of the last keystroke.
3. WHEN a Tenant_User selects a lifecycle state filter, THE Product_Catalog SHALL display only products in the selected state.
4. WHEN a Tenant_User clicks on a product row, THE Router SHALL navigate to the product detail page for that product.
5. WHEN the product detail page loads, THE Product_Catalog SHALL display all canonical fields (SKU, title, description, brand, attributes), variant details, images (with the hero image visually distinguished), enrichment layer data (AI-generated attributes with confidence scores and review flags), category mappings, and compliance reports.
6. WHEN a Tenant_User with editor or higher role edits a product attribute on the detail page, THE Product_Catalog SHALL submit the update to the API and display the updated value upon success.
7. IF the API returns an error when a product attribute update is submitted, THEN THE Product_Catalog SHALL display an error message indicating the failure reason, revert the field to its previous value, and retain the user's unsaved changes in the form.
8. WHEN a Tenant_User with editor or higher role approves an AI-enriched attribute flagged for review, THE Product_Catalog SHALL submit the approval to the API with the Tenant_User's identity as the approver.
9. WHEN a Tenant_User with editor or higher role initiates a CSV product upload, THE Product_Catalog SHALL accept a CSV file of no more than 10 MB, validate that the file contains the required header columns (SKU, title, brand) and no more than 10,000 rows, and upload it to the raw uploads endpoint.
10. IF a CSV file fails client-side validation, THEN THE Product_Catalog SHALL display the validation errors listing each issue with its row number (up to the first 50 errors) and prevent submission.
11. WHEN a Tenant_User with editor or higher role selects one or more products (up to 500) and clicks export, THE Product_Catalog SHALL submit an export request to the API for the selected channel and format (CSV or JSON).
12. IF the export request fails, THEN THE Product_Catalog SHALL display an error message indicating the failure reason and preserve the product selection.

### Requirement 6: Product Image Management

**User Story:** As a seller, I want to upload and manage product images, so that my listings have appropriate visual assets.

#### Acceptance Criteria

1. WHEN a Tenant_User with editor or higher role uploads an image on the product detail page, THE Product_Catalog SHALL accept files in JPEG, PNG, or WebP format up to 10 MB in size, upload the file to the assets endpoint, and display the image in the product's image gallery upon success.
2. IF the image upload fails due to an unsupported file format, file size exceeding 10 MB, or a network/server error, THEN THE Product_Catalog SHALL display an error message indicating the reason for failure and retain the product detail page in its current state without adding the image to the gallery.
3. THE Product_Catalog SHALL display each image's moderation status (APPROVED, REJECTED, PENDING) as a visual badge overlaid on the image thumbnail in the gallery.
4. WHEN a Tenant_User designates an image with APPROVED moderation status as the hero image, THE Product_Catalog SHALL submit the update to the API and reorder the image gallery to show the hero image in the first position.
5. IF a Tenant_User attempts to designate an image with REJECTED or PENDING moderation status as the hero image, THEN THE Product_Catalog SHALL prevent the designation and display an error message indicating that only APPROVED images can be set as the hero image.
6. THE Product_Catalog SHALL display an indicator on images that were upscaled to meet channel resolution requirements, showing which channel triggered the upscale.
7. THE Product_Catalog SHALL enforce a maximum of 15 images per product and prevent further uploads once the limit is reached.

### Requirement 7: Inventory Management

**User Story:** As a seller, I want to view and adjust stock levels, so that I can prevent stockouts and overselling.

#### Acceptance Criteria

1. WHEN the Inventory_Module loads, THE Inventory_Module SHALL display a table of inventory records showing SKU, warehouse ID, on-hand quantity, reserved quantity, and available quantity, sorted by SKU in ascending alphabetical order.
2. WHEN a Tenant_User selects a warehouse filter, THE Inventory_Module SHALL display only inventory records for the selected warehouse.
3. WHEN a Tenant_User with editor or higher role submits a manual stock adjustment with a non-zero integer delta quantity between -999,999 and 999,999 inclusive and a reason containing 1 to 200 characters, THE Inventory_Module SHALL send the adjustment to the API with source set to "manual" and refresh the displayed quantities upon success.
4. IF a manual stock adjustment submission fails due to a network error or API error response, THEN THE Inventory_Module SHALL display an error message indicating the adjustment was not saved, preserve the entered adjustment values in the form, and leave the displayed inventory quantities unchanged.
5. WHEN a Tenant_User clicks on an inventory record, THE Inventory_Module SHALL display the most recent 50 transaction history entries for that SKU and warehouse, showing delta quantity, previous quantity, new quantity, source, actor, and timestamp in reverse chronological order.
6. IF a Tenant_User with viewer role attempts to submit a manual stock adjustment, THEN THE Inventory_Module SHALL keep the adjustment form controls disabled and not send any request to the API.
7. WHILE inventory records are displayed, THE Inventory_Module SHALL apply a distinct visual indicator (background color or icon) to any inventory record where available quantity is at or below zero, and a separate visual indicator to any record where available quantity is at or below the tenant-configured low-stock threshold.
8. IF a Tenant_User submits a manual stock adjustment that would cause the on-hand quantity to become negative, THEN THE Inventory_Module SHALL display a validation error message indicating that on-hand quantity cannot go below zero and SHALL NOT send the adjustment to the API.

### Requirement 8: Billing and Subscription Management

**User Story:** As a tenant owner, I want to view my subscription, usage, and invoices, so that I can manage my spending.

#### Acceptance Criteria

1. WHEN the Billing_Module loads, THE Billing_Module SHALL display the tenant's current plan (one of: starter, growth, professional, enterprise), billing cycle (monthly or annual), subscription status (one of: active, past_due, canceled, trialing, incomplete, incomplete_expired, unpaid), and current period start and end dates in ISO 8601 format.
2. WHEN the Billing_Module loads, THE Billing_Module SHALL display the current billing month's usage counters (enrichment calls, image calls, CSV exports) as numeric values alongside the corresponding plan limits, showing consumed count and maximum allowed count for each counter.
3. WHEN a Tenant_User with owner role views invoices, THE Billing_Module SHALL display a paginated list of invoices with a default page size of 20 items, showing amount, currency, status (paid, open, void, or uncollectible), billing period start and end dates, and a link to download the PDF.
4. WHEN a Tenant_User with owner role clicks a PDF invoice link, THE Billing_Module SHALL generate a presigned download URL valid for 5 minutes and initiate the file download.
5. IF a Tenant_User with owner role clicks a PDF invoice link and the PDF file is not available, THEN THE Billing_Module SHALL display an error message indicating the invoice PDF is unavailable and disable the download link for that invoice.
6. WHEN a Tenant_User with owner role initiates a plan change, THE Billing_Module SHALL display the available plans with their usage limits and pricing, require the user to explicitly confirm the selection, and submit the upgrade or downgrade request to the billing API upon confirmation.
7. IF a Tenant_User without owner role attempts to access billing management, THEN THE Billing_Module SHALL deny access and display a message indicating that billing management requires the owner role.
8. IF the Billing_Module fails to load subscription or usage data from the API, THEN THE Billing_Module SHALL display an error message indicating that billing information is temporarily unavailable and provide a retry option.

### Requirement 9: Channel Integration Management

**User Story:** As a seller, I want to connect and manage marketplace channels, so that I can publish products to multiple sales platforms.

#### Acceptance Criteria

1. WHEN the Channel_Module loads, THE Channel_Module SHALL display all supported channels (Takealot, Amazon, Makro, Shopify, WooCommerce, Custom) with their connection status.
2. WHEN a Tenant_User with admin or higher role initiates a channel connection, THE Channel_Module SHALL redirect to the channel's OAuth flow and display the connection status upon return.
3. IF the OAuth flow fails or the user cancels the OAuth consent, THEN THE Channel_Module SHALL display an error message indicating the connection was not established and leave the channel status unchanged.
4. WHEN a Tenant_User with admin or higher role disconnects a channel, THE Channel_Module SHALL display a confirmation prompt before submitting the disconnection request to the API, and upon confirmation SHALL update the displayed status to disconnected.
5. IF the disconnection request fails, THEN THE Channel_Module SHALL display an error message indicating the channel could not be disconnected and leave the channel status unchanged.
6. WHEN the Channel_Module displays a connected channel, THE Channel_Module SHALL show the connection date and channel-specific details (shop URL for Shopify integrations).

### Requirement 10: Team Management

**User Story:** As a tenant owner, I want to manage team members and their roles, so that I can control access to my organisation's data.

#### Acceptance Criteria

1. WHEN the Team_Module loads, THE Team_Module SHALL display a list of all users in the tenant showing name, email, and assigned role.
2. WHEN a Tenant_User with owner role invites a new team member by providing a valid email address and selecting a role from the available roles (viewer, editor, admin), THE Team_Module SHALL submit the invitation request to the API specifying the assigned role.
3. IF the invitation request fails or the email is already associated with a user in the tenant, THEN THE Team_Module SHALL display an error message indicating the reason for failure and preserve the entered email and selected role.
4. WHEN a Tenant_User with owner role changes another user's role, THE Team_Module SHALL submit the role change to the API and display the updated role upon success.
5. WHEN a Tenant_User with owner role removes a team member, THE Team_Module SHALL display a confirmation prompt before submitting the removal request to the API, and upon confirmation SHALL remove the user from the displayed list.
6. THE Team_Module SHALL prevent a Tenant_User from modifying their own role or removing themselves from the tenant by disabling the role change and removal controls for the current user's row.

### Requirement 11: Webhook Configuration

**User Story:** As a seller, I want to configure webhooks, so that external systems receive notifications about platform events.

#### Acceptance Criteria

1. WHEN the webhook settings page loads, THE Channel_Module SHALL display all configured webhooks showing URL, subscribed events, and active status, sorted by creation date descending, supporting up to 25 webhooks per tenant.
2. IF no webhooks are configured, THEN THE Channel_Module SHALL display an empty state message indicating no webhooks exist and providing an option to add one.
3. WHEN a Tenant_User with admin or higher role adds a new webhook, THE Channel_Module SHALL accept a URL that begins with "https://", is no longer than 2048 characters, and passes URI format validation, along with at least one event subscription selected from the available event types, and submit the configuration to the API.
4. IF the webhook URL fails validation or the tenant has reached the maximum of 25 configured webhooks, THEN THE Channel_Module SHALL display an error message indicating the specific validation failure and SHALL NOT submit the request to the API.
5. WHEN a Tenant_User with admin or higher role toggles a webhook's active status, THE Channel_Module SHALL submit the status change to the API and display the updated state with a success confirmation within 3 seconds.
6. WHEN a Tenant_User with admin or higher role deletes a webhook, THE Channel_Module SHALL display a confirmation prompt before submitting the deletion request, and upon confirmation SHALL remove the webhook from the displayed list.
7. IF the API returns an error during a webhook add, toggle, or delete operation, THEN THE Channel_Module SHALL display an error message indicating the operation that failed, preserve the previous state of the webhook list, and allow the user to retry the operation.

### Requirement 12: Notifications and Real-Time Updates

**User Story:** As a seller, I want to receive in-app notifications about important events, so that I can respond to issues promptly.

#### Acceptance Criteria

1. WHEN a platform event belonging to the tenant's scope occurs, THE App_Shell SHALL display an in-app notification within 3 seconds of event emission, showing the event type and a summary of up to 200 characters, and the notification toast SHALL remain visible for 8 seconds or until dismissed by the user.
2. THE App_Shell SHALL maintain a notification history list accessible from the top bar, showing the most recent 50 notifications with read/unread status, ordered from newest to oldest.
3. WHEN a Tenant_User clicks a notification, THE Router SHALL navigate to the corresponding detail page based on the event type: product detail for product lifecycle events, inventory record for inventory change events, billing page for billing events, or channel status page for channel sync events.
4. WHEN a Tenant_User marks a notification as read, THE App_Shell SHALL update the unread notification count displayed in the top bar within 1 second.
5. IF the real-time connection is lost, THEN THE App_Shell SHALL display a connection status indicator in the top bar and SHALL attempt to reconnect automatically, and upon successful reconnection SHALL retrieve any notifications missed during the disconnection period.
6. WHEN a Tenant_User opens the notification history list, THE App_Shell SHALL display a loading state until notifications are retrieved, and SHALL display a message indicating no notifications are available if the history is empty.

### Requirement 13: Error Handling and Offline Resilience

**User Story:** As a seller, I want the application to handle errors gracefully, so that I do not lose work or encounter confusing states.

#### Acceptance Criteria

1. IF an API request fails due to a network error, THEN THE API_Client SHALL retry the request up to 3 times with exponential backoff starting at 1 second and doubling each subsequent attempt (1s, 2s, 4s), and IF all 3 retries are exhausted, THEN THE API_Client SHALL display an error notification indicating that the operation failed and the user may try again.
2. IF an API request returns HTTP 403, THEN THE App_Shell SHALL display an access denied message and not retry the request.
3. IF an API request returns HTTP 429 and the response includes a Retry-After header, THEN THE API_Client SHALL wait for the duration specified in the Retry-After header (capped at a maximum of 60 seconds) before retrying, up to a maximum of 3 retry attempts. IF the Retry-After header is missing or contains an invalid value, THEN THE API_Client SHALL wait 5 seconds before retrying.
4. IF an unhandled exception occurs in a page component, THEN THE App_Shell SHALL display a fallback error boundary with an option to reload the page, without crashing the entire application.
5. WHILE the application detects no network connectivity, THE App_Shell SHALL display a persistent offline indicator in the top bar. WHEN network connectivity is restored, THE App_Shell SHALL remove the offline indicator within 5 seconds of detecting reconnection.
6. IF an error occurs while the user has unsaved form input, THEN THE App_Shell SHALL preserve the user's in-progress input so that it remains available after the error is resolved or the page is reloaded via the error boundary.

### Requirement 14: Accessibility

**User Story:** As a seller with accessibility needs, I want the application to be usable with assistive technologies, so that I can manage my products independently.

#### Acceptance Criteria

1. THE App_Shell SHALL achieve WCAG 2.1 Level AA conformance for all interactive elements, including keyboard navigation, focus management, and screen reader compatibility, such that no interactive element requires a pointer-only interaction without a keyboard-equivalent action.
2. WHEN a user navigates via keyboard, THE App_Shell SHALL display a visible focus indicator on the focused element with a minimum contrast ratio of 3:1 against adjacent colors and a minimum area of 2px on the perimeter of the element.
3. THE App_Shell SHALL use semantic HTML landmarks (nav, main, aside, header) to structure page regions for screen reader navigation, and SHALL programmatically associate every form input with a text label using either a `<label>` element, `aria-label`, or `aria-labelledby` attribute.
4. WHEN dynamic content updates occur (notifications, table refreshes, form validation errors), THE App_Shell SHALL announce the change to assistive technologies using ARIA live regions with `aria-live="assertive"` for error messages and form validation failures, and `aria-live="polite"` for informational notifications and data refreshes.
5. WHILE a user is navigating via keyboard, THE App_Shell SHALL ensure that focus follows a logical reading order matching the visual layout, and SHALL NOT trap focus within any component unless the component provides a documented mechanism to exit (such as the Escape key for modal dialogs).
6. WHEN a modal dialog, dropdown menu, or popover is opened, THE App_Shell SHALL move focus to the first focusable element within that component, and WHEN the component is dismissed, THE App_Shell SHALL return focus to the element that triggered the component.
