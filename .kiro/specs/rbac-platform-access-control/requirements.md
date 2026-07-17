# Requirements Document

## Introduction

This feature introduces Role-Based Access Control (RBAC) to the MerchOS platform. The system uses a single Amazon Cognito User Pool with three Cognito Groups (Admin, Support, Seller) to govern authorization across both the seller-dashboard and admin-dashboard applications. A centralized permission model ensures each role can only access its designated resources, with the architecture designed to accommodate future roles without refactoring.

## Glossary

- **Authorization_Middleware**: A centralized backend layer that validates Cognito Group membership from the JWT before executing protected endpoint business logic.
- **Permission_Guard**: A reusable frontend React component that conditionally renders children based on the authenticated user's role and permissions.
- **Cognito_Group**: An Amazon Cognito User Pool Group (Admin, Support, or Seller) assigned to users to denote their platform role.
- **JWT**: A JSON Web Token issued by Amazon Cognito containing user claims including group membership in the `cognito:groups` claim.
- **Permission_Registry**: A centralized configuration mapping roles to their allowed actions and resources, serving as the single source of truth for authorization decisions.
- **Navigation_Renderer**: A frontend component that dynamically generates navigation menus based on the authenticated user's permissions.
- **Access_Denied_Page**: A dedicated page displayed to users who attempt to access a resource for which they lack authorization.
- **Platform_Role**: One of the three Cognito Group memberships (Admin, Support, Seller) that determines a user's access level across the platform.
- **Seller_Dashboard**: The Next.js application at apps/seller-dashboard serving seller-facing functionality.
- **Admin_Dashboard**: The Next.js application at apps/admin-dashboard serving both Admin and Support users.

## Requirements

### Requirement 1: JWT Token Parsing and Group Extraction

**User Story:** As a platform developer, I want the system to extract Cognito Group membership from JWT tokens, so that authorization decisions can be made based on the user's assigned role.

#### Acceptance Criteria

1. WHEN a valid JWT is received, THE Authorization_Middleware SHALL extract the `cognito:groups` claim and resolve it to a single Platform_Role within 200 milliseconds.
2. IF a JWT does not contain a `cognito:groups` claim, THEN THE Authorization_Middleware SHALL deny access and return HTTP 403 with a structured error response indicating the missing group claim.
3. IF a JWT has an expired `exp` claim, THEN THE Authorization_Middleware SHALL deny access and return HTTP 401 with a structured error response indicating token expiration.
4. IF a JWT contains multiple group memberships, THEN THE Authorization_Middleware SHALL resolve the effective role using the highest-privilege group (Admin > Support > Seller).
5. THE Authorization_Middleware SHALL validate the JWT signature against the Cognito User Pool's public keys and verify the token issuer (`iss`) matches the configured Cognito User Pool URL before extracting claims.
6. IF a JWT is malformed or cannot be parsed, THEN THE Authorization_Middleware SHALL deny access and return HTTP 401 with a structured error response indicating an invalid token.
7. IF the `cognito:groups` claim contains only group names not matching any defined Platform_Role (Admin, Support, Seller), THEN THE Authorization_Middleware SHALL deny access and return HTTP 403 with a structured error response indicating an unrecognized role.

### Requirement 2: Centralized Permission Registry

**User Story:** As a platform developer, I want a single centralized permission configuration, so that role-to-resource mappings are maintained in one place and new roles can be added without refactoring.

#### Acceptance Criteria

1. THE Permission_Registry SHALL define all role-to-permission mappings in a single configuration source shared between frontend and backend.
2. WHEN a new Platform_Role is added to the Permission_Registry, THE Authorization_Middleware SHALL enforce the new role's permissions without changes to middleware code.
3. THE Permission_Registry SHALL represent permissions as a combination of resource identifiers (dot-delimited strings with a maximum length of 128 characters, e.g., "products", "users.profile") and allowed actions limited to: create, read, update, and delete.
4. THE Permission_Registry SHALL return a deterministic set of permissions for any valid Platform_Role such that serializing and deserializing the registry produces an equivalent mapping.
5. IF a role-resource-action combination is not explicitly granted in the Permission_Registry, THEN THE Permission_Registry SHALL deny access by default (implicit deny).
6. IF the Permission_Registry receives a lookup for a Platform_Role value that is not defined in the registry, THEN THE Permission_Registry SHALL deny access and indicate that the role is unrecognized.

### Requirement 3: Backend Authorization Middleware

**User Story:** As a platform developer, I want every protected API endpoint to validate the user's Cognito Group before executing business logic, so that unauthorized access is blocked at the API layer.

#### Acceptance Criteria

1. WHEN an authenticated request reaches a protected endpoint, THE Authorization_Middleware SHALL validate the user's Platform_Role against the endpoint's declared required action in the Permission_Registry before executing business logic.
2. WHEN a user's Platform_Role lacks the required permission for an endpoint, THE Authorization_Middleware SHALL return HTTP 403 with a JSON response body containing a machine-readable error code and a human-readable message indicating the denied action.
3. WHEN a request lacks a JWT or contains a JWT that cannot be validated (malformed, expired signature, or missing required claims), THE Authorization_Middleware SHALL return HTTP 401 with a JSON response body containing a machine-readable error code and a human-readable message indicating the authentication failure reason.
4. THE Authorization_Middleware SHALL apply to all protected endpoints through a declarative per-endpoint action annotation consumed by shared middleware logic, without requiring per-endpoint authorization code duplication.
5. WHEN the Authorization_Middleware grants access, THE Authorization_Middleware SHALL attach the resolved Platform_Role, user identifier (sub claim), and tenant identifier to the request context for downstream use.
6. IF the Authorization_Middleware denies access (HTTP 401 or HTTP 403), THEN THE Authorization_Middleware SHALL terminate request processing without invoking the endpoint's business logic handler.

### Requirement 4: Seller Role Permissions

**User Story:** As a seller, I want to manage my own products, suppliers, AI listings, exports, subscription, and analytics, so that I can operate my business within the platform.

#### Acceptance Criteria

1. WHILE a user has the Seller Platform_Role, THE Authorization_Middleware SHALL permit full create, read, update, and delete access to product management, supplier management, and AI listing generation endpoints scoped to the seller's own tenant.
2. WHILE a user has the Seller Platform_Role, THE Authorization_Middleware SHALL permit read access to analytics endpoints and permit create access to CSV export endpoints, scoped to the seller's own tenant.
3. WHILE a user has the Seller Platform_Role, THE Authorization_Middleware SHALL permit read and update access to subscription management endpoints scoped to the seller's own tenant.
4. WHILE a user has the Seller Platform_Role, THE Authorization_Middleware SHALL deny access to other seller accounts, system settings, platform administration, billing administration, user management, and infrastructure endpoints.
5. WHEN a Seller attempts to access a resource belonging to a different tenant, THE Authorization_Middleware SHALL return HTTP 403 with a structured error response indicating insufficient tenant permissions.
6. WHEN a Seller attempts an action not included in the Seller role's Permission_Registry entry, THE Authorization_Middleware SHALL return HTTP 403 with a structured error response indicating insufficient permissions.

### Requirement 5: Admin Role Permissions

**User Story:** As an admin, I want full CRUD access to user management, subscriptions, AI monitoring, processing jobs, pricing, platform settings, analytics, and support management, so that I can operate and administer the platform.

#### Acceptance Criteria

1. WHILE a user has the Admin Platform_Role, THE Authorization_Middleware SHALL permit full create, read, update, and delete access to all platform resources across all tenants.
2. WHILE a user has the Admin Platform_Role, THE Admin_Dashboard SHALL display all navigation items and administrative features.
3. THE Permission_Registry SHALL grant Admin the superset of all permissions defined for Support and Seller roles.

### Requirement 6: Support Role Permissions

**User Story:** As a support agent, I want to search users, view customer information, view processing jobs, view logs, resend verification emails, and assist customers, so that I can help resolve customer issues.

#### Acceptance Criteria

1. WHILE a user has the Support Platform_Role, THE Authorization_Middleware SHALL permit read access to user search, customer information, processing jobs, and logs across all tenants.
2. WHILE a user has the Support Platform_Role, THE Authorization_Middleware SHALL permit the resend verification email action as the only non-read action available to the Support role.
3. WHILE a user has the Support Platform_Role, THE Authorization_Middleware SHALL deny any action not explicitly permitted in criteria 1 and 2, including but not limited to delete user, create user, change pricing, modify subscription, change platform settings, access infrastructure, and change user role actions.
4. WHEN a Support user attempts a denied action, THE Authorization_Middleware SHALL return HTTP 403 with a message indicating insufficient permissions.
5. WHILE a user has the Support Platform_Role, THE Admin_Dashboard SHALL display only navigation items corresponding to user search, customer information, processing jobs, logs, and resend verification email.

### Requirement 7: Frontend Permission Guard Components

**User Story:** As a frontend developer, I want reusable permission guard components (RequireAdmin, RequireSupport, RequireSeller, RequirePermission), so that I can declaratively protect UI sections based on role.

#### Acceptance Criteria

1. WHEN a user's Platform_Role does not satisfy the Permission_Guard's required role, THE Permission_Guard SHALL render none of its children and SHALL produce no visible output in the DOM for the guarded section.
2. WHEN a user's Platform_Role satisfies the Permission_Guard's required role, THE Permission_Guard SHALL render all of its children unchanged.
3. IF the current user's Platform_Role includes the specified permission identifier in the Permission_Registry, THEN THE RequirePermission component SHALL render its children; otherwise it SHALL render nothing.
4. IF the current user's Platform_Role is Admin, THEN THE RequireAdmin component SHALL render its children; otherwise it SHALL render nothing.
5. IF the current user's Platform_Role is Admin or Support, THEN THE RequireSupport component SHALL render its children; otherwise it SHALL render nothing.
6. IF the current user's Platform_Role is Seller, THEN THE RequireSeller component SHALL render its children; otherwise it SHALL render nothing.
7. WHILE the user's authentication state is not yet resolved, THE Permission_Guard SHALL render nothing until the Platform_Role is determined.
8. IF an invalid or unrecognized permission identifier is passed to THE RequirePermission component, THEN THE RequirePermission component SHALL render nothing and SHALL not throw a runtime error.
9. THE Permission_Guard components SHALL derive authorization decisions solely from the Permission_Registry and the current user's Platform_Role, without hardcoded role checks within the component logic.

### Requirement 8: Dynamic Navigation Rendering

**User Story:** As a platform user, I want the navigation menu to display only the items I have permission to access, so that I am not confused by inaccessible features.

#### Acceptance Criteria

1. WHEN the Navigation_Renderer builds the menu, THE Navigation_Renderer SHALL include only items whose required permission is satisfied by the current user's Platform_Role, and SHALL exclude non-permitted items from the rendered DOM.
2. IF a navigation item's required permission is not satisfied by the current user's Platform_Role, THEN THE Navigation_Renderer SHALL remove that item from the rendered DOM so that it is not visible and not accessible to assistive technologies.
3. THE Navigation_Renderer SHALL derive menu visibility from the Permission_Registry without hardcoded role checks.
4. WHEN permissions change due to a session refresh, THE Navigation_Renderer SHALL update the displayed menu items within 2 seconds of receiving the updated permissions, without requiring a full page reload.
5. WHILE the Navigation_Renderer is resolving the current user's permissions, THE Navigation_Renderer SHALL render a loading indicator in place of the menu and SHALL NOT display any navigation items until permissions are resolved.
6. IF the current user's Platform_Role has no permitted navigation items, THEN THE Navigation_Renderer SHALL render an empty menu container with no navigation links.

### Requirement 9: Unauthorized Access Redirection

**User Story:** As a platform user, I want to be redirected to an Access Denied page when I attempt to access a resource I am not authorized for, so that I receive clear feedback instead of broken UI.

#### Acceptance Criteria

1. WHEN an authenticated user navigates to a route their Platform_Role does not permit, THE Permission_Guard SHALL redirect the user to the Access_Denied_Page without rendering the protected content.
2. THE Access_Denied_Page SHALL display the requested resource path and a statement indicating the user lacks permission to access it.
3. THE Access_Denied_Page SHALL provide a navigation link to the user's permitted dashboard area (Seller_Dashboard home for Sellers, Admin_Dashboard home for Admin/Support).
4. WHEN an unauthenticated user navigates to a protected route, THE Permission_Guard SHALL redirect the user to the login page.

### Requirement 10: Extensible Role Architecture

**User Story:** As a platform architect, I want the permission model to support additional roles (Finance, Sales, QA, Developer) without requiring code refactoring, so that the platform can scale its access control as the organization grows.

#### Acceptance Criteria

1. THE Permission_Registry SHALL represent Platform_Role as a configurable enumeration that supports a minimum of 20 distinct roles, where each role entry consists of a role identifier, a set of resource identifiers, and their associated allowed actions (create, read, update, delete), and accepts new values without modifying guard, middleware, or navigation logic.
2. WHEN a new Platform_Role is added to the Permission_Registry with its associated permissions, THE Permission_Guard components SHALL enforce the new role's access by adding only a new role entry to the Permission_Registry configuration and, if applicable, its corresponding Cognito_Group, with no modifications to existing source code files in guard, middleware, or navigation components.
3. WHEN a new Platform_Role is added to the Permission_Registry, THE Navigation_Renderer SHALL reflect the new role's permitted navigation items by reading the new role's permissions from the Permission_Registry at render time, with no modifications to existing source code files in navigation components.
4. THE Permission_Registry SHALL use a data-driven structure (configuration object or file) for role-to-permission mapping, containing no if/else, switch/case, or ternary expressions that branch on role name values to determine permissions.
5. IF a new Platform_Role entry is added to the Permission_Registry with missing or malformed fields (missing role identifier, empty permission set, or invalid action values), THEN THE Permission_Registry SHALL reject the entry and return an error indication specifying which field failed validation.
