# ADR-001: Centralized Middleware Authorization

## Status

**Accepted**

Date: 2025-01-15

## Context

The MerchOS platform requires a robust authorization system that enforces role-based access control (RBAC), tenant isolation, and resource ownership validation across all protected API endpoints. During the design phase, we evaluated several approaches to implementing authorization and identified critical security risks with endpoint-level authorization:

### Security Risks of Endpoint-Level Authorization

1. **Code duplication** — Each endpoint handler must independently implement authorization checks, leading to repeated boilerplate logic across dozens of route handlers. Duplicated logic is harder to maintain and more likely to diverge over time.

2. **Inconsistent enforcement** — Without a centralized enforcement point, different engineers may implement authorization checks differently. Subtle variations in check ordering, error handling, or permission resolution create inconsistent security behavior across the API surface.

3. **Missed checks** — The most dangerous risk. When authorization is the responsibility of individual endpoint handlers, it becomes possible for a new endpoint to ship without authorization checks entirely. A single missed check creates a security vulnerability that may go undetected until exploited.

4. **Audit difficulty** — When authorization logic is distributed across endpoint handlers, auditing the security posture of the system requires inspecting every handler individually. There is no single location to verify that all endpoints are protected.

5. **Role expansion complexity** — Adding a new role or permission requires modifying every endpoint handler that needs to recognize the new role, creating a high-risk, high-effort change that touches many files.

### Requirements That Motivated This Decision

- The platform must enforce tenant isolation on every protected request (Requirement 1)
- Ownership validation must execute before business logic (Requirement 2)
- The middleware pipeline must execute stages sequentially with immediate termination on failure (Requirement 5)
- A single shared library must be the source of truth for authorization logic (Requirement 6)
- The architecture must support adding new roles via configuration only (Requirement 9)

## Decision

**All authorization logic executes in shared middleware before business logic, with no authorization checks in endpoint handlers.**

Specifically:

1. A centralized middleware pipeline processes every protected request through sequential stages: Authentication → JWT Validation → Role Resolution → Tenant Resolution → Ownership Validation → Permission Validation.

2. Each stage has a single responsibility and produces a well-defined output that subsequent stages consume.

3. If any stage fails, processing terminates immediately and returns the appropriate HTTP error response (401 or 403) with a structured error code. Business logic is never invoked.

4. Business logic handlers receive a fully validated `AuthorizedRequestContext` containing the resolved role, userId, tenantId, ownership verification status, and granted permission. Handlers never perform authentication, authorization, tenant resolution, or ownership checks.

5. All permission definitions, role configurations, and authorization utilities are maintained in the shared `@merch-os/rbac` package — the single source of truth consumed by frontend, backend, and middleware layers.

6. Adding a new role or permission requires only updating the `@merch-os/rbac` package configuration. No changes to middleware, guards, navigation, or business logic handlers are necessary.

## Consequences

### Benefits

| Benefit | Description |
|---------|-------------|
| **Reduced code duplication** | Authorization logic is written once in the middleware pipeline and applied uniformly to all endpoints. Endpoint handlers contain only business logic. |
| **Consistent enforcement** | Every request passes through the same pipeline stages in the same order. There is no possibility of inconsistent authorization behavior between endpoints. |
| **Easier auditing** | Security reviewers inspect one middleware pipeline rather than hundreds of endpoint handlers. The pipeline is the single enforcement boundary. |
| **Improved security posture** | It is architecturally impossible for an endpoint to bypass authorization. The middleware pipeline executes before any endpoint handler is invoked. |
| **Single point of policy change** | Updating authorization rules (adding permissions, changing role mappings, modifying tenant isolation logic) requires changes only in the middleware layer and/or the `@merch-os/rbac` package. |
| **Easier role expansion** | New roles are added via configuration in `@merch-os/rbac`. The middleware automatically recognizes and enforces permissions for new roles without code changes to endpoint handlers. |

### Trade-offs

| Trade-off | Description | Mitigation |
|-----------|-------------|------------|
| **Middleware ordering dependencies** | The pipeline stages must execute in a strict sequence. Incorrect ordering (e.g., permission check before role resolution) causes authorization failures. | The pipeline order is explicitly documented and enforced by the middleware registration sequence. Integration tests validate stage ordering. |
| **Potential over-fetching of authorization context** | The middleware may look up ownership information for requests that ultimately don't require it (e.g., list endpoints without a specific resource). | Ownership validation is configured per-route. Routes that don't require ownership checks skip the lookup stage. |
| **Debugging complexity** | When middleware rejects a request, the error originates from the pipeline rather than the endpoint handler, which can make debugging less intuitive for engineers unfamiliar with the architecture. | Structured error responses include the failing stage name, the required permission, and the user's role. Observability tooling logs each pipeline stage's decision. |

## Alternatives Considered

### 1. Endpoint-Level Guards

**Description:** Each endpoint handler includes inline authorization checks (e.g., `if (!user.hasPermission('products.update.own')) return 403`). Guards are co-located with the business logic they protect.

**Rejection Reasons:**
- High risk of missed checks on new endpoints — no architectural guarantee that every endpoint is protected
- Authorization logic duplicated across all endpoint handlers, increasing maintenance burden
- Inconsistent implementation across engineers leads to security gaps
- Adding a new role requires modifying every handler that references role checks
- Auditing requires inspecting every endpoint handler individually

### 2. Decorator-Based Authorization

**Description:** Authorization requirements are declared via decorators (e.g., `@RequirePermission('products.update.own')`) on controller methods. A framework intercepts the decorator metadata and performs checks before the method executes.

**Rejection Reasons:**
- Relies on framework-specific decorator infrastructure that may not be available in all execution contexts (e.g., serverless functions, background jobs)
- Decorators declare *what* permission is needed but don't enforce *how* the check executes — the enforcement mechanism is still separate and can be misconfigured
- Does not naturally accommodate multi-stage validation (tenant isolation + ownership + permission) in a sequential pipeline
- Decorator metadata is evaluated at request time, adding indirection that complicates debugging
- Framework coupling makes the authorization strategy harder to migrate if the platform changes frameworks

### 3. API Gateway-Only Authorization

**Description:** All authorization checks are performed at the API Gateway layer (e.g., AWS API Gateway authorizers) before requests reach the application. The application trusts that any request it receives has already been authorized.

**Rejection Reasons:**
- API Gateways support coarse-grained checks (valid JWT, basic role membership) but cannot perform fine-grained resource-level ownership validation without custom authorizer logic that duplicates application concerns
- Tenant isolation requires access to the resource store to validate ownership — this is application-level logic that doesn't belong in the gateway layer
- Gateway authorizers have execution time limits and cold-start latency that impact user experience
- Separating authorization from the application creates a trust boundary: if the gateway is bypassed or misconfigured, the application has no defense
- Debugging authorization failures requires correlating gateway logs with application logs across different systems
- The platform's ownership validation pattern requires resource lookups that are impractical at the gateway layer

## References

- [MerchOS RBAC Blueprint](../rbac-blueprint.md)
- [MerchOS RBAC Specification](../rbac-specification.md)
- [RBAC Platform Access Control Baseline](../../../.kiro/specs/rbac-platform-access-control/)
