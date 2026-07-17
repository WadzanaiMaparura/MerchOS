# Requirements Document

## Introduction

This specification defines the requirements for updating the MerchOS Blueprint to Version 0.2. The MerchOS Blueprint is the single source of truth for engineering — a standalone document separate from the RBAC-specific architecture documents (rbac-blueprint.md, rbac-specification.md, rbac-future-proofing-addendum.md). This update reflects the latest architectural decisions regarding authentication, role-based access control, security, and portal architecture.

This is a **documentation-only** update. No application code is modified. The deliverable is an updated Blueprint document that engineering teams reference for all architectural decisions. The RBAC subsystem architecture is already documented in dedicated RBAC documents; this Blueprint update integrates authentication architecture, API specifications, security architecture, portal architecture, and architecture diagrams into the main MerchOS Blueprint where they do not yet exist.

---

## Glossary

- **Blueprint**: The main MerchOS engineering architecture document — the single source of truth for platform architecture, separate from the RBAC-specific documents.
- **Cognito**: AWS Cognito — the managed identity service used as the sole Identity Provider for the MerchOS platform.
- **User_Pool**: A single AWS Cognito User Pool that contains all platform users (Sellers, Support, Admins) and manages authentication.
- **App_Client**: A single Cognito App Client configured for the User Pool, used by all frontend applications to authenticate against Cognito.
- **Cognito_Group**: An AWS Cognito User Pool Group used to assign Platform Roles to users (Admin, Support, Seller).
- **JWT**: JSON Web Token — the authentication credential issued by Cognito after successful login, containing user identity and group claims.
- **Platform_Role**: A named role assigned via Cognito Groups that determines a user's permissions on the platform (Admin, Support, Seller).
- **Permission_Matrix**: A comprehensive table mapping every API resource to Read/Create/Update/Delete/Administrative actions for each Platform Role.
- **API_Documentation_Standard**: The required metadata format every protected API endpoint must include for authentication and authorization documentation.
- **Admin_Portal**: The unified web application used by both Admin and Support roles, with UI adapting dynamically based on Cognito Group membership.
- **Seller_Portal**: The tenant-isolated web application used by Sellers, restricted to own-tenant resources only.
- **Tenant_Isolation**: The architectural guarantee that Sellers can only access resources belonging to their own tenant.
- **ADR**: Architecture Decision Record — a documented record of a significant architectural decision including context, alternatives, and consequences.
- **Blueprint_Section**: A named section within the MerchOS Blueprint document covering a specific architectural concern.
- **Authentication_Flow**: The end-to-end sequence: Frontend → Cognito → JWT → API Gateway → Lambda → Business Services.

---

## Requirements

---

### Requirement 1: Authentication Architecture Section

**User Story:** As an engineer, I want the Blueprint to document the complete authentication architecture using Amazon Cognito, so that all teams understand how authentication flows through the system.

#### Acceptance Criteria

1. THE Blueprint SHALL contain an Authentication Architecture section specifying Amazon Cognito as the sole Identity Provider for the MerchOS platform.
2. THE Blueprint SHALL document that the platform uses a single User_Pool containing all platform users regardless of their Platform_Role.
3. THE Blueprint SHALL document that the platform uses a single App_Client configured for the User_Pool.
4. THE Blueprint SHALL document that all API endpoints requiring authentication (endpoints that access user-specific or tenant-specific resources) require a valid JWT issued by Cognito, passed as a Bearer token in the Authorization header.
5. THE Blueprint SHALL document that API Gateway validates JWT signature, expiration, and issuer before forwarding requests to Lambda functions.
6. THE Blueprint SHALL document that Lambda functions trust the authenticated identity provided by API Gateway and do not re-validate JWTs.
7. THE Blueprint SHALL document the complete Authentication_Flow sequence: Frontend → Cognito → JWT → API Gateway → Lambda → Business Services.
8. THE Blueprint SHALL include a sequence diagram in Mermaid syntax illustrating the Authentication_Flow from user login through to a successful API response.
9. IF authentication fails at the API Gateway layer due to a missing, malformed, or expired JWT, THEN THE Blueprint SHALL document that the API Gateway rejects the request before it reaches Lambda, returning an HTTP 401 response with an error indicator distinguishing missing token, invalid token, and expired token conditions.

---

### Requirement 2: RBAC Section in Blueprint

**User Story:** As an engineer, I want the Blueprint to document the approved RBAC model with concrete role definitions, so that all teams understand the three Platform Roles and their boundaries.

#### Acceptance Criteria

1. THE Blueprint SHALL contain an RBAC section documenting three Cognito_Groups: Admin, Support, and Seller.
2. THE Blueprint SHALL document the Admin role as having unrestricted platform access, cross-tenant visibility, system configuration management, user management, and platform monitoring responsibilities.
3. THE Blueprint SHALL document the Support role as having read-access to cross-tenant data for troubleshooting, subscription and invoice visibility, and product read access, with restrictions against modifying tenant data, billing changes, and system configuration.
4. THE Blueprint SHALL document the Seller role as having full CRUD on own-tenant products, AI content generation, marketplace exports, and self-service subscription management, with restrictions against cross-tenant access and system-level operations.
5. THE Blueprint SHALL reference the existing RBAC Blueprint (rbac-blueprint.md) and RBAC Specification (rbac-specification.md) for detailed middleware pipeline and permission naming standards.
6. THE Blueprint SHALL document that Platform_Role is resolved exclusively from the Cognito_Group claim in the JWT, and that client-supplied role claims are never trusted.

---

### Requirement 3: Permission Matrix Section

**User Story:** As an engineer, I want the Blueprint to include a comprehensive Permission Matrix, so that I can quickly determine which roles have access to which API operations.

#### Acceptance Criteria

1. THE Blueprint SHALL contain a Permission Matrix section presented as one or more tables, where each table row represents an API resource from the documented resource domains and each table has columns for the three Platform_Roles (Seller, Support, Admin) indicating the permitted actions per role.
2. THE Permission_Matrix SHALL document the following action categories for each resource and role combination: Read, Create, Update, Delete, and Administrative (where Administrative is defined as actions that modify system-wide configuration, manage user accounts, or alter platform behavior beyond standard CRUD on business entities).
3. THE Permission_Matrix SHALL cover at minimum the following resource domains: Products, System, AI, Marketplace, Subscription, Users, Tenants, and Audit Log.
4. WHEN a new API resource is added to the platform, THE Blueprint SHALL be updated to include the new resource in the Permission_Matrix before the endpoint is deployed to production.
5. THE Permission_Matrix SHALL use a distinct notation for each cell value to indicate one of the following access states: full access (granted unconditionally), own-tenant only (granted but scoped to the user's tenant), or denied (not permitted), such that each role-resource-action combination resolves to exactly one of these three states.
6. THE Permission_Matrix SHALL be consistent with the Permission_Registry defined in the shared @merch-os/rbac package, such that every permission granted or denied in the matrix corresponds to the equivalent role-resource-action mapping in the Permission_Registry.

---

### Requirement 4: API Specification Updates

**User Story:** As an engineer, I want every API endpoint in the Blueprint to include standardized authentication and authorization metadata, so that security requirements are discoverable and auditable.

#### Acceptance Criteria

1. THE Blueprint SHALL define a "protected endpoint" as any API endpoint that requires a valid Bearer JWT in the Authorization header, and SHALL document that every protected endpoint must include the following metadata fields: Required Authentication method, Required Cognito_Group, Expected JWT claims, Authorization requirements (required_permission, ownership_required, ownership_field, tenant_isolation), and 401/403 error responses.
2. THE Blueprint SHALL document that the Required Authentication method for all protected endpoints is Bearer JWT issued by Cognito.
3. THE Blueprint SHALL document that every endpoint must specify which Cognito_Groups are permitted to access the endpoint.
4. THE Blueprint SHALL document the expected JWT claims that each endpoint depends on: sub, custom:tenantId, and cognito:groups at minimum.
5. THE Blueprint SHALL document standard 401 response codes (MISSING_TOKEN, INVALID_TOKEN, TOKEN_EXPIRED) and 403 response codes (INSUFFICIENT_PERMISSIONS, TENANT_ISOLATION_VIOLATION, OWNERSHIP_VALIDATION_FAILURE) applicable to protected endpoints.
6. THE Blueprint SHALL reference the API Documentation Standard defined in the RBAC Specification (rbac-specification.md, Section 5) as the authoritative format for endpoint documentation.
7. THE Blueprint SHALL include at least three representative endpoint examples using the YAML template defined in the RBAC Specification Section 5.2, with all required fields from Section 5.1 populated: one Admin endpoint with tenant_isolation set to global, one Support endpoint with tenant_isolation set to bypassed, and one Seller endpoint with tenant_isolation set to scoped and ownership_required set to true.
8. IF an API endpoint does not require authentication, THEN THE Blueprint SHALL document that endpoint with authentication set to "None (Public)" and SHALL omit role, permission, and ownership fields.

---

### Requirement 5: API Design Standards Section

**User Story:** As an engineer, I want the Blueprint to document API design standards for authentication, tenant isolation, and role resolution, so that all new endpoints follow consistent patterns.

#### Acceptance Criteria

1. THE Blueprint SHALL contain an API Design Standards section documenting that all protected endpoints authenticate using Bearer JWT in the Authorization header.
2. THE Blueprint SHALL document that tenant identity is resolved exclusively from the authenticated JWT custom:tenantId claim — never from client-supplied request parameters, headers, or body fields — and that tenant-scoped enforcement applies to Seller role requests while Admin and Support roles may access cross-tenant resources.
3. THE Blueprint SHALL document that Platform_Role is resolved exclusively from Cognito_Groups in the JWT — client-supplied role claims are never trusted.
4. THE Blueprint SHALL document that API Gateway performs JWT validation (signature, expiration, issuer) before routing requests to Lambda.
5. THE Blueprint SHALL document that Lambda functions receive a pre-validated Authorization Context containing at minimum the resolved Platform_Role, userId (sub claim), tenantId, and permissions — and must not perform JWT parsing, role resolution, or tenant resolution.
6. THE Blueprint SHALL document the standard error responses produced by API Gateway when authentication or authorization fails: HTTP 401 for missing, malformed, or expired tokens, and HTTP 403 for insufficient permissions or tenant isolation violations.
7. THE Blueprint SHALL document that every new protected endpoint must conform to the API Design Standards before deployment to production.

---

### Requirement 6: Security Architecture Section

**User Story:** As an engineer, I want the Blueprint to document the complete security architecture, so that all teams understand the platform's defense-in-depth strategy.

#### Acceptance Criteria

1. THE Blueprint SHALL contain a Security Architecture section documenting the following security layers in defense-in-depth order from outermost to innermost: Rate limiting, API Gateway authorization, JWT validation, Cognito authentication, Zero Trust posture, RBAC enforcement, Least Privilege principle, Tenant Isolation, Input validation, and Audit logging.
2. THE Blueprint SHALL document that Cognito handles all user authentication including credential storage, password policies, and token issuance.
3. THE Blueprint SHALL document that JWT validation occurs at the API Gateway layer before any request reaches Lambda business logic.
4. THE Blueprint SHALL document that API Gateway acts as the authorization boundary, rejecting requests with invalid or expired tokens.
5. THE Blueprint SHALL document the Least Privilege principle: each Platform_Role receives only the minimum permissions required for its stated responsibilities as defined in the Permission Matrix.
6. THE Blueprint SHALL document that Tenant Isolation is enforced at the middleware layer for Seller role requests, ensuring no cross-tenant data access by validating that the JWT custom:tenantId matches the target resource's tenantId.
7. THE Blueprint SHALL document a Zero Trust posture: every request is authenticated and authorized regardless of network origin, and no implicit trust is granted based on network location.
8. THE Blueprint SHALL document that input validation is applied to all API request bodies before business logic executes, covering data type validation, format validation, length constraints, and required field presence.
9. THE Blueprint SHALL document that audit logging captures every state-changing operation (create, update, and delete) including the following fields: actor identity (userId), tenant context (tenantId), timestamp, action performed, and affected resource identifier.
10. THE Blueprint SHALL document that rate limiting is applied at the API Gateway layer to protect against abuse and denial-of-service.
11. THE Blueprint SHALL document that MFA is planned for Admin role users as a future security enhancement.
12. THE Blueprint Security Architecture section SHALL cross-reference the Authentication Architecture section for Cognito configuration details and the RBAC section for role and permission definitions, using relative-path hyperlinks rather than restating content documented in those sections.

---

### Requirement 7: Admin Portal Architecture Section

**User Story:** As an engineer, I want the Blueprint to document that Admin and Support share a single portal with dynamic UI adaptation, so that teams understand there is no separate Support application.

#### Acceptance Criteria

1. THE Blueprint SHALL contain an Admin Portal Architecture section documenting that Support and Admin roles share the same web application (Admin_Portal).
2. THE Blueprint SHALL document that the Admin_Portal resolves the authenticated user's Platform_Role from their Cognito_Group membership and uses that resolved role to determine which UI elements are visible and which actions are available.
3. THE Blueprint SHALL document that navigation menu items are filtered by checking each item's required resource against the permission set granted to the user's Platform_Role, and that page visibility and action availability are enforced by route guards and component guards that perform the same permission check.
4. THE Blueprint SHALL document that there is no separate Support application — all support workflows are accessed through the shared Admin_Portal.
5. THE Blueprint SHALL document that frontend route guards and component guards consume permissions from the @merch-os/rbac package to determine UI visibility.
6. IF a Support user attempts to navigate to an Admin-only page, THEN THE Admin_Portal SHALL redirect the user to an access-denied page and SHALL render no Admin-only content at any point during the redirect (no flash of protected content).
7. IF an unauthenticated user attempts to access any protected Admin_Portal route, THEN THE Admin_Portal SHALL redirect the user to the login page without rendering protected content.

---

### Requirement 8: Seller Portal Isolation Section

**User Story:** As an engineer, I want the Blueprint to document Seller Portal isolation guarantees, so that teams understand the tenant boundary enforcement on the frontend.

#### Acceptance Criteria

1. THE Blueprint SHALL contain a Seller Portal section documenting that Sellers access only resources belonging to their own tenant.
2. THE Blueprint SHALL document that every backend request from the Seller_Portal includes the authenticated JWT, and that the middleware validates tenant ownership before executing business logic.
3. THE Blueprint SHALL document that the Seller_Portal does not expose any cross-tenant navigation, search, or data retrieval capabilities, and that Seller_Portal URLs do not contain tenant identifiers that could be manipulated to access another tenant's resources.
4. THE Blueprint SHALL document that tenant identity for Seller requests is resolved from the JWT custom:tenantId claim — the Seller_Portal never supplies a tenantId in request query parameters, path parameters, request body fields, or headers.
5. IF a Seller's JWT custom:tenantId does not match the resource's tenantId, THEN THE backend SHALL reject the request with a TENANT_ISOLATION_VIOLATION error before business logic executes.
6. THE Blueprint SHALL document that the Seller_Portal enforces tenant-scoped route guards and component guards using the @merch-os/rbac package, ensuring that frontend navigation and UI components only render resources associated with the authenticated Seller's tenant.

---

### Requirement 9: Architecture Diagrams Section

**User Story:** As an engineer, I want the Blueprint to include updated architecture diagrams showing the authentication and authorization flow, so that the system architecture is visually documented.

#### Acceptance Criteria

1. THE Blueprint SHALL contain an Architecture Diagrams section with at least one diagram illustrating the end-to-end authentication flow: Frontend → Cognito → JWT → API Gateway → Lambda → DynamoDB.
2. THE Blueprint SHALL include a diagram showing where Cognito_Groups are resolved in the authorization pipeline.
3. THE Blueprint SHALL include a diagram showing the relationship between the Admin_Portal, Seller_Portal, Cognito, API Gateway, and backend Lambda services.
4. THE Blueprint SHALL use Mermaid diagram syntax for all architecture diagrams to ensure they render in standard markdown viewers.
5. WHEN a new architectural component is added to the authentication or authorization flow, THE Blueprint diagrams SHALL be updated to reflect the change.

---

### Requirement 10: Architecture Decision Record

**User Story:** As an engineer, I want an ADR documenting the decision to adopt a single Cognito User Pool with Role-Based Access Control, so that the rationale and trade-offs are preserved for future teams.

#### Acceptance Criteria

1. THE Blueprint update SHALL include a new ADR titled "Adoption of Single Cognito User Pool with Role-Based Access Control."
2. THE ADR SHALL contain a Status section indicating the decision status and the date of acceptance, following the format established by ADR-001.
3. THE ADR SHALL contain a Context section explaining the authentication requirements that motivated the decision, including at least three specific requirements or constraints that drove the evaluation.
4. THE ADR SHALL contain a Decision section stating that a single Cognito User Pool with Cognito Groups for role assignment is the adopted approach.
5. THE ADR SHALL contain an Alternatives Considered section documenting at least two alternatives: multiple User Pools (one per role) and a third-party identity provider.
6. THE ADR SHALL document rejection reasons for the multiple User Pools approach, including operational complexity, user management overhead, and inability to share authentication infrastructure.
7. THE ADR SHALL document rejection reasons for the third-party identity provider alternative, including at least two specific drawbacks that motivated its rejection.
8. THE ADR SHALL document the benefits of Cognito Groups including configuration-only role expansion, single authentication endpoint, simplified user management, and JWT-based role delivery.
9. THE ADR SHALL contain a Consequences section documenting at least three benefits and at least two trade-offs of the adopted approach, with each trade-off including a mitigation strategy.
10. THE ADR SHALL document scalability considerations: support for adding future roles without architectural redesign, Cognito's 300-group limit, and a defined role precedence resolution strategy for users assigned to multiple Cognito Groups simultaneously.
11. THE ADR SHALL be numbered ADR-002 and follow the filename convention established by ADR-001, placed in the same directory as ADR-001.

---

### Requirement 11: Future Roles Section

**User Story:** As an engineer, I want the Blueprint to document that the architecture supports future role expansion without redesign, so that teams are confident the RBAC system scales to new business needs.

#### Acceptance Criteria

1. THE Blueprint SHALL contain a Future Roles section documenting that additional Cognito_Groups (Finance, Sales, Developer, QA, Enterprise Customer) can be added without architectural changes.
2. THE Blueprint SHALL document that adding a new role requires only: creating a Cognito Group, updating the @merch-os/rbac package configuration, and assigning users to the group.
3. THE Blueprint SHALL document that no middleware, guard, navigation, or business logic code changes are required when adding a new role.
4. THE Blueprint SHALL document that the architecture supports a minimum of 20 distinct Platform_Roles while maintaining O(1) authorization latency per request, where only the requesting user's role is evaluated and the PermissionRegistry uses pre-built hash maps for constant-time permission lookups regardless of total role count.
5. THE Blueprint SHALL reference the RBAC Future-Proofing Addendum (rbac-future-proofing-addendum.md) using a relative-path hyperlink for the detailed governance process and step-by-step role expansion procedure.
6. THE Blueprint SHALL document the architectural guarantees that enable configuration-only role expansion, stating that role resolution reads from the @merch-os/rbac configuration at runtime, permission guards evaluate the resolved role's permission set dynamically, and navigation filtering derives visible items from the current user's permissions without role-specific conditional logic.
