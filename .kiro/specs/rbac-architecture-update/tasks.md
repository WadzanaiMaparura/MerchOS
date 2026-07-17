# Implementation Plan: RBAC Architecture Update

## Overview

This implementation plan produces four documentation artifacts that extend the existing RBAC baseline. All tasks involve creating or modifying Markdown documentation files with embedded Mermaid diagrams and TypeScript code examples. No application code is generated — the deliverables are architecture documentation only.

## Tasks

- [x] 1. Create Blueprint document with tenant isolation and ownership validation
  - [x] 1.1 Create the Blueprint document with tenant isolation principles section
    - Create the Blueprint Markdown file at `docs/architecture/rbac-blueprint.md`
    - Document that the Middleware_Pipeline extracts tenantId exclusively from the authenticated JWT `custom:tenantId` claim
    - Document automatic tenant context injection into the request before business logic executes
    - Document that every protected request validates tenant ownership before executing business logic
    - Include a Mermaid sequence diagram illustrating tenant isolation flow from JWT extraction through ownership validation to business logic execution
    - Document HTTP 403 structured error response for tenant isolation violations
    - Document that Admin and Support roles bypass tenant scoping while Seller roles are always tenant-scoped
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 1.2 Add ownership validation architecture section to the Blueprint
    - Document that RBAC validates role-level access while Ownership_Validation validates resource-level access
    - Document that Ownership_Validation executes after Permission Validation and before business logic
    - Document the architectural pattern: resource identifier extraction, resource ownership lookup, comparison against authenticated user identity
    - Include TypeScript code examples demonstrating the Ownership_Validation middleware pattern for products
    - Document that business logic handlers never perform ownership checks
    - Document HTTP 403 structured error for ownership validation failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 1.3 Add middleware pipeline specification section to the Blueprint
    - Document complete pipeline stages in order: Request → Authentication → JWT Validation → Role Resolution → Tenant Resolution → Ownership Validation → Permission Validation → Business Logic
    - Document each stage's responsibility including inputs, outputs, failure modes, and HTTP error codes
    - Document that business logic handlers never perform authentication, authorization, tenant resolution, or ownership checks
    - Include a Mermaid flowchart showing the complete pipeline with decision points and error exits
    - Document sequential stage execution and immediate termination on failure
    - Document the request context object shape (AuthorizedRequestContext) passed to business logic
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 2. Add shared library and future-proofing sections to Blueprint
  - [x] 2.1 Add shared authorization library documentation section to the Blueprint
    - Document that `@merch-os/rbac` is the single source of truth for permission definitions, role configurations, and authorization utilities
    - Document the package's public API surface (PermissionRegistry, resolveRoleFromClaims, createAuthorizationCheck, filterNavigationItems, RequireAdmin, RequireSupport, RequireSeller, RequirePermission)
    - Include a Mermaid dependency diagram showing apps and services importing from `@merch-os/rbac`
    - Document the versioning and release strategy (workspace protocol, same version within a release)
    - Document that adding a new role or permission requires only updating `@merch-os/rbac` configuration
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 2.2 Add future-proofing guide section to the Blueprint
    - Document step-by-step procedure for adding a new Platform_Role: create Cognito Group, add role entry to `@merch-os/rbac` config, assign users
    - Document that no source code modifications to middleware, guards, navigation, or business logic are required
    - Document example configurations for at least three future roles (Finance, Developer, Enterprise Customer) with projected permission sets
    - Document governance process for proposing and approving new roles (review, security assessment, permission scope validation)
    - Document that the platform supports a minimum of 20 distinct Platform_Roles without performance degradation
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 3. Checkpoint - Review Blueprint completeness
  - Ensure all Blueprint sections are complete, all Mermaid diagrams render correctly, and cross-references are consistent. Ask the user if questions arise.

- [x] 4. Create RBAC Specification document
  - [x] 4.1 Create the RBAC Specification document with permission naming standard
    - Create the RBAC Specification Markdown file at `docs/architecture/rbac-specification.md`
    - Define the Permission_Naming_Standard format: `resource.action.scope`
    - Document examples of each format component (resource, action, scope)
    - Document naming rules: lowercase only, dot-delimited, max 128 chars, no special chars except dots and hyphens
    - Document that every new permission must conform to the standard and be added to the central registry before use
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 4.2 Add expanded permission domains and role-permission matrix to the RBAC Specification
    - Document System domain permissions: `system.logs`, `system.metrics`, `system.health`, `system.configuration`, `system.jobs`
    - Document AI domain permissions: `ai.generate`, `ai.images`, `ai.catalogue`, `ai.jobs`, `ai.training`
    - Document Marketplace domain permissions: `marketplace.takealot.export`, `marketplace.amazon.export`, `marketplace.makro.export`, `marketplace.shopify.export`
    - Document Subscription domain permissions: `subscription.view`, `subscription.change`, `subscription.cancel`, `subscription.invoice`, `subscription.manage`
    - Create a role-permission matrix table mapping all Platform_Roles to all permissions
    - Document the process for adding new permission domains including required fields, review criteria, and configuration-only workflow
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.3 Add API documentation standard section to the RBAC Specification
    - Define the API_Documentation_Standard requiring every protected endpoint to document: authentication method, required role, required permission, ownership requirement, tenant isolation scope, and error responses
    - Include a template showing all required fields and example values (YAML format)
    - Document that endpoints without authorization metadata are non-compliant
    - Include three representative endpoint examples (Admin, Support, Seller) demonstrating the complete standard
    - Document the relationship between endpoint permission annotations in code and API_Documentation_Standard entries
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 5. Checkpoint - Review RBAC Specification completeness
  - Ensure all RBAC Specification sections are complete, permission naming is consistent throughout, and role-permission matrix is comprehensive. Ask the user if questions arise.

- [x] 6. Create ADR and finalize documentation
  - [x] 6.1 Create the Architecture Decision Record (ADR-001)
    - Create the ADR Markdown file at `docs/architecture/adr/ADR-001-centralized-middleware-authorization.md`
    - Document the decision title as "Centralized Middleware Authorization"
    - Follow ADR format: Status (Accepted), Context, Decision, Consequences, Alternatives Considered
    - Document context: security risks of endpoint-level authorization (duplication, inconsistency, missed checks)
    - Document the decision: all authorization logic executes in shared middleware before business logic
    - Document benefits: reduced duplication, consistent enforcement, easier auditing, improved security, single policy change point, easier role expansion
    - Document alternatives considered with rejection reasons: endpoint-level guards, decorator-based authorization, API Gateway-only authorization
    - Document consequences and trade-offs: middleware ordering dependencies, potential over-fetching, debugging complexity
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 6.2 Create the Future-Proofing Addendum document
    - Create the addendum at `docs/architecture/rbac-future-proofing-addendum.md`
    - Document configuration-only role expansion procedures with detailed steps
    - Include example future role configurations (Finance, Developer, Enterprise Customer) with full permission sets
    - Document governance process for new roles including proposal template, review workflow, and approval criteria
    - Cross-reference the Blueprint and RBAC Specification for detailed implementation context
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

- [x] 7. Final checkpoint - Review all documentation artifacts
  - Ensure all four documentation artifacts (Blueprint, RBAC Specification, ADR, Future-Proofing Addendum) are complete, internally consistent, and backward-compatible with the existing RBAC baseline. Verify all Mermaid diagrams render correctly. Ask the user if questions arise.

## Notes

- All deliverables are Markdown documentation files — no application code is produced
- Mermaid diagrams are used throughout for visual architecture documentation
- TypeScript interfaces are included as code examples within documentation (architecture reference patterns)
- All documentation extends but does not invalidate the existing RBAC baseline at `.kiro/specs/rbac-platform-access-control/`
- The permission naming standard (`resource.action.scope`) is a documentation convention; the runtime registry data structure remains unchanged
- No property-based tests are applicable since the deliverables are prose documentation, not executable code

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "4.2"] },
    { "id": 2, "tasks": ["1.3", "4.3"] },
    { "id": 3, "tasks": ["2.1", "6.1"] },
    { "id": 4, "tasks": ["2.2", "6.2"] }
  ]
}
```
