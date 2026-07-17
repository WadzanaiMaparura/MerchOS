# Implementation Plan: MerchOS Blueprint v2

## Overview

This plan creates the MerchOS Blueprint v0.2 document and ADR-002 as documentation-only deliverables. Each task writes or modifies Markdown files — no application code is changed. The Blueprint is authored incrementally, section by section, building on the existing RBAC documents for reference material. The ADR is authored separately following the established ADR-001 format.

## Tasks

- [x] 1. Create Blueprint document scaffold and Authentication Architecture section
  - [x] 1.1 Create `docs/architecture/merchos-blueprint.md` with document title, version header, table of contents, and the Authentication Architecture section
    - Document Amazon Cognito as sole Identity Provider
    - Document single User Pool containing all users regardless of Platform Role
    - Document single App Client configured for the User Pool
    - Document JWT Bearer token requirement for all protected endpoints
    - Document API Gateway JWT validation (signature, expiration, issuer)
    - Document Lambda trust model (pre-validated identity, no re-validation)
    - Write complete authentication flow narrative
    - Include Mermaid sequence diagram: Frontend → Cognito → JWT → API Gateway → Lambda → Business Services
    - Document 401 authentication failure responses (MISSING_TOKEN, INVALID_TOKEN, TOKEN_EXPIRED)
    - Add cross-reference link to rbac-blueprint.md for middleware pipeline details
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

- [x] 2. Write RBAC and Permission Matrix sections
  - [x] 2.1 Add the RBAC Model section to the Blueprint
    - Document three Cognito Groups: Admin, Support, Seller
    - Document Admin role boundaries (unrestricted, cross-tenant, system config, user management, monitoring)
    - Document Support role boundaries (read cross-tenant, subscriptions/invoices, product read; restrictions on modification, billing, system config)
    - Document Seller role boundaries (full CRUD own-tenant, AI content, marketplace, self-service subscriptions; restrictions on cross-tenant, system ops)
    - Document that Platform Role is resolved exclusively from JWT cognito:groups claim (client-supplied claims never trusted)
    - Add relative-path hyperlinks to rbac-blueprint.md and rbac-specification.md
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.2 Add the Permission Matrix section to the Blueprint
    - Create tables with rows for API resources and columns for Seller, Support, Admin
    - Include action categories: Read, Create, Update, Delete, Administrative
    - Cover all resource domains: Products, System, AI, Marketplace, Subscription, Users, Tenants, Audit Log
    - Use three-state notation: ✅ (full access), 🔒 (own-tenant only), ❌ (denied)
    - Document consistency requirement with @merch-os/rbac PermissionRegistry
    - Document maintenance requirement: update before deploying new endpoints
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Write API Specification and API Design Standards sections
  - [x] 3.1 Add the API Specification Updates section to the Blueprint
    - Define "protected endpoint" and required metadata fields
    - Document Bearer JWT authentication method
    - Document Cognito Group specification per endpoint
    - Document expected JWT claims: sub, custom:tenantId, cognito:groups
    - Document standard error codes: 401 (MISSING_TOKEN, INVALID_TOKEN, TOKEN_EXPIRED) and 403 (INSUFFICIENT_PERMISSIONS, TENANT_ISOLATION_VIOLATION, OWNERSHIP_VALIDATION_FAILURE)
    - Reference RBAC Specification §5 as authoritative format
    - Include three YAML endpoint examples: Admin (tenant_isolation: global), Support (tenant_isolation: bypassed), Seller (tenant_isolation: scoped, ownership_required: true)
    - Document public endpoint format (authentication: None)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 3.2 Add the API Design Standards section to the Blueprint
    - Document Bearer JWT in Authorization header for all protected endpoints
    - Document tenant identity from JWT custom:tenantId only (never client-supplied)
    - Document Platform Role from JWT cognito:groups only (never client-supplied)
    - Document API Gateway JWT validation before Lambda
    - Document Lambda Authorization Context (role, userId, tenantId, permissions)
    - Document standard error responses (401/403)
    - Document conformance requirement for new endpoints
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 4. Write Security Architecture section
  - [x] 4.1 Add the Security Architecture section to the Blueprint
    - Document defense-in-depth layers in order: Rate limiting, API Gateway authorization, JWT validation, Cognito authentication, Zero Trust posture, RBAC enforcement, Least Privilege, Tenant Isolation, Input validation, Audit logging
    - Document Cognito responsibilities (credentials, passwords, token issuance)
    - Document JWT validation at API Gateway layer
    - Document API Gateway as authorization boundary
    - Document Least Privilege principle per Permission Matrix
    - Document Tenant Isolation (middleware enforcement for Seller role)
    - Document Zero Trust posture (authenticate/authorize every request regardless of origin)
    - Document input validation (type, format, length, required fields)
    - Document audit logging (actor, tenant, timestamp, action, resource)
    - Document rate limiting at API Gateway
    - Document MFA planned for Admin (future enhancement)
    - Add cross-references to Authentication Architecture and RBAC sections using relative-path hyperlinks
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12_

- [x] 5. Checkpoint - Review core sections
  - Ensure all sections written so far are consistent and cross-references are valid, ask the user if questions arise.

- [x] 6. Write Portal Architecture sections
  - [x] 6.1 Add the Admin Portal Architecture section to the Blueprint
    - Document shared application for Admin and Support roles
    - Document role resolution from Cognito Group membership
    - Document navigation filtering by permission check against @merch-os/rbac
    - Document route guards and component guards for visibility enforcement
    - Document that there is no separate Support application
    - Document frontend guards consuming @merch-os/rbac permissions
    - Document Support → Admin-only page redirect (access-denied, no flash of protected content)
    - Document unauthenticated → protected route redirect (login page, no protected content rendered)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 6.2 Add the Seller Portal Isolation section to the Blueprint
    - Document own-tenant resource access only
    - Document JWT inclusion and middleware tenant ownership validation
    - Document no cross-tenant navigation, search, or data retrieval
    - Document URLs do not contain manipulable tenant identifiers
    - Document tenant identity from JWT custom:tenantId (never in request params/body/headers)
    - Document TENANT_ISOLATION_VIOLATION on tenantId mismatch
    - Document frontend route guards and component guards via @merch-os/rbac
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 7. Write Architecture Diagrams and Future Roles sections
  - [x] 7.1 Add the Architecture Diagrams section to the Blueprint
    - Create Mermaid sequence diagram for end-to-end authentication flow (Frontend → Cognito → JWT → API Gateway → Lambda → DynamoDB)
    - Create Mermaid diagram showing Cognito Group resolution in the authorization pipeline
    - Create Mermaid diagram showing system topology (Admin Portal, Seller Portal, Cognito, API Gateway, Lambda services)
    - Add maintenance note: update diagrams when architectural components change
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 7.2 Add the Future Roles section to the Blueprint
    - Document named future roles: Finance, Sales, Developer, QA, Enterprise Customer
    - Document role addition steps: create Cognito Group, update @merch-os/rbac config, assign users
    - Document no code changes required (middleware, guards, navigation, business logic)
    - Document support for 20+ roles with O(1) authorization latency via pre-built hash maps
    - Add relative-path hyperlink to rbac-future-proofing-addendum.md
    - Document architectural guarantees: runtime config reads, dynamic permission evaluation, permission-derived navigation
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 8. Create ADR-002
  - [x] 8.1 Create `docs/architecture/adr/ADR-002-single-cognito-user-pool-rbac.md`
    - Follow ADR-001 format and naming convention
    - Title: "Adoption of Single Cognito User Pool with Role-Based Access Control"
    - Status: Accepted with date
    - Context: Authentication requirements with at least 3 constraints that drove evaluation
    - Decision: Single Cognito User Pool with Cognito Groups for role assignment
    - Alternatives Considered: Multiple User Pools (rejected — operational complexity, user management overhead, inability to share auth infrastructure) and Third-party IdP (rejected — at least 2 specific drawbacks)
    - Document benefits of Cognito Groups: config-only expansion, single auth endpoint, simplified user management, JWT-based role delivery
    - Consequences: 3+ benefits, 2+ trade-offs with mitigation strategies
    - Scalability: future roles without redesign, 300-group limit, role precedence resolution strategy
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11_

- [x] 9. Final checkpoint - Verify completeness and cross-references
  - Ensure all Blueprint sections are present and address every acceptance criterion
  - Verify all relative-path hyperlinks resolve to existing files
  - Verify Permission Matrix uses exactly three distinct cell values with no ambiguous entries
  - Verify ADR-002 follows ADR-001 structure
  - Verify all Mermaid diagrams use valid syntax
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This is a documentation-only feature — no application code is modified
- All diagrams use Mermaid syntax for standard Markdown viewer rendering
- The Blueprint references RBAC documents rather than duplicating their content
- Property-based testing does not apply since deliverables are Markdown files, not executable code
- The Permission Matrix must stay consistent with the @merch-os/rbac PermissionRegistry
- ADR-002 follows the format established by ADR-001

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "3.2"] },
    { "id": 2, "tasks": ["2.2", "4.1"] },
    { "id": 3, "tasks": ["6.1", "6.2", "7.1", "7.2"] },
    { "id": 4, "tasks": ["8.1"] }
  ]
}
```
