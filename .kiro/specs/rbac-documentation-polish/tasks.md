# Implementation Plan: RBAC Documentation Polish

## Overview

This plan delivers documentation-only improvements to the MerchOS RBAC architecture documentation suite. All tasks modify Markdown files in `docs/architecture/` — no implementation code is changed. The work adds diagrams, security principles, patterns, sequences, and cross-references across four existing documents.

## Tasks

- [x] 1. Add Canonical Authorization Flow Diagram to all three documents
  - [x] 1.1 Add diagram to RBAC Blueprint
    - Add the "Canonical Authorization Flow" heading and Mermaid flowchart LR diagram to the Middleware Pipeline Specification section (Section 3) of `docs/architecture/rbac-blueprint.md`
    - Diagram must show: Request → JWT Validation → Role Resolution → Tenant Resolution → Ownership Validation → Permission Validation → Business Logic → DynamoDB
    - Place heading "Canonical Authorization Flow" immediately above the Mermaid code block
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

  - [x] 1.2 Add diagram to RBAC Specification
    - Add the identical "Canonical Authorization Flow" heading and Mermaid flowchart to `docs/architecture/rbac-specification.md` before the first subsection as an overview visual
    - Use the exact same Mermaid code block as placed in the Blueprint
    - _Requirements: 1.1, 1.3, 1.5, 1.6_

  - [x] 1.3 Add diagram to ADR-001
    - Add the identical "Canonical Authorization Flow" heading and Mermaid flowchart to `docs/architecture/adr/ADR-001-centralized-middleware-authorization.md` in the Decision section
    - Use the exact same Mermaid code block as placed in the Blueprint
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

- [x] 2. Add Security Principle section to RBAC Blueprint
  - [x] 2.1 Create "Security Principle — Never Trust the Client" section
    - Add a new section titled "Security Principle — Never Trust the Client" to `docs/architecture/rbac-blueprint.md`, positioned after Tenant Isolation Principles and before Ownership Validation Architecture
    - Use blockquote markup for visual distinction
    - Include explanation of why the client is never authoritative (forgery, tampering, replay)
    - List values never trusted from the client: tenantId, role, permissions, ownership claims, resource identifiers
    - State that all authorization decisions derive from server-side validated identity through the Middleware Pipeline
    - State that the Authorization Context (constructed by middleware) is the trusted source
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. Add Authorization Context section to RBAC Blueprint
  - [x] 3.1 Create "Authorization Context" section with field reference table
    - Add a new section titled "Authorization Context" to `docs/architecture/rbac-blueprint.md`, positioned after the Security Principle section
    - Include prose explaining that middleware constructs this trusted object and passes it to Lambda handlers as input before business logic executes
    - Create a field reference table with columns: Field Name, Data Type, Presence, Description
    - Document all 7 fields: userId (string, always), tenantId (string, always), role (string, always), permissions (string[], always), ownershipContext (object|null, conditional), requestId (string, always), correlationId (string, conditional)
    - For ownershipContext: state present when ownership validation was performed on a specific resource, null for list/create operations
    - For correlationId: state present when client provides X-Correlation-Id header, absent otherwise
    - State that business logic must consume this context rather than parsing JWTs or querying Cognito
    - Define as the standard engineering pattern for all Lambda functions
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 4. Add Lambda Responsibilities section to RBAC Blueprint
  - [x] 4.1 Create "Lambda Responsibilities" section with responsibility boundary
    - Add a new section titled "Lambda Responsibilities" to `docs/architecture/rbac-blueprint.md`, positioned after the Authorization Context section
    - Include named principle: "Separation of Concerns: Middleware vs. Lambda"
    - Create a two-column comparison table:
      - Middleware responsibilities: JWT parsing, role resolution, permission resolution, tenant resolution, ownership validation
      - Lambda responsibilities: Data persistence (CRUD), business rule execution, external service integration, response construction, domain-specific transformations
    - State that Lambda functions receive a pre-validated Authorization Context and must consume it as the sole source of identity/authorization
    - Ensure complete enumeration so any operation classifies into exactly one category
    - Add a cross-reference from the existing Section 3.5 (Business Logic Separation Principle) to this new section
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 5. Checkpoint - Verify diagram and principle sections
  - Ensure all diagrams render correctly in Markdown preview, verify blockquote formatting is visually distinct, and confirm the Authorization Context table has all 7 fields. Ask the user if questions arise.

- [x] 6. Add Authorization Lifecycle Sequence to RBAC Blueprint
  - [x] 6.1 Create "Authorization Lifecycle Sequence" section
    - Add a new section titled "Authorization Lifecycle Sequence" to `docs/architecture/rbac-blueprint.md`, positioned after Lambda Responsibilities
    - Label the sequence as "Standard Authorization Lifecycle"
    - Create a numbered list of exactly 10 steps: (1) Receive Request, (2) Validate JWT, (3) Resolve Cognito Groups, (4) Resolve Platform Role, (5) Resolve Tenant, (6) Resolve Permissions, (7) Validate Ownership, (8) Execute Business Logic, (9) Write Audit Log, (10) Return Response
    - For each step, include: input the step receives, output the step produces, responsibility the step fulfills
    - For steps 2–7 that can terminate the pipeline early: document failure condition and resulting system behavior (e.g., 401, 403 responses)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 7. Add Cross-Reference Index and inter-document references
  - [x] 7.1 Create "Related Architecture Documents" section in RBAC Blueprint
    - Add a new section titled "Related Architecture Documents" at the end of `docs/architecture/rbac-blueprint.md`
    - Create a table with columns: Document Name (hyperlinked), Relationship Description
    - Include entries for: API Blueprint, Security Architecture, Authentication Architecture, ADR-001, Shared RBAC Package documentation
    - Use relative paths for all hyperlinks
    - For documents that do not exist at the specified path, include a `[pending]` indicator with expected location
    - _Requirements: 6.1, 6.2, 6.5, 6.6_

  - [x] 7.2 Add cross-references to RBAC Specification
    - Add a cross-reference from `docs/architecture/rbac-specification.md` to the Blueprint's Authorization Context section (instead of restating)
    - Use relative-path hyperlinks
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 7.3 Add cross-references to ADR-001
    - Add a cross-reference from `docs/architecture/adr/ADR-001-centralized-middleware-authorization.md` to the Blueprint's pipeline specification section
    - Use relative-path hyperlinks
    - _Requirements: 6.2, 6.3, 6.4_

  - [x] 7.4 Verify Future-Proofing Addendum cross-references
    - Review `docs/architecture/rbac-future-proofing-addendum.md` for existing cross-references
    - Ensure all references remain accurate after the new sections added to the Blueprint
    - Update any stale references if needed
    - _Requirements: 6.3, 6.4_

- [x] 8. Final checkpoint - Full documentation review
  - Ensure all cross-references use valid relative paths, verify the Mermaid code block is identical across all three placements, confirm all 6 requirements are fully covered, and run a Markdown link check. Ask the user if questions arise.

## Notes

- This is a documentation-only feature — no runtime code is modified
- All changes target Markdown files in `docs/architecture/`
- The Canonical Authorization Flow diagram must be byte-for-byte identical in all three placements
- The Security Principle section uses blockquote markup specifically
- The Authorization Context section documents the expanded 7-field Lambda-facing contract (distinct from the existing 5-field middleware-internal interface in Section 3.6)
- The 10-step authorization lifecycle is more granular than the existing 7-stage pipeline in Section 3.1
- Cross-references use relative paths; non-existent targets get `[pending]` markers
- No property-based tests are applicable — verification is via manual review and Markdown linting

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["6.1"] },
    { "id": 5, "tasks": ["7.1", "7.2", "7.3", "7.4"] }
  ]
}
```
