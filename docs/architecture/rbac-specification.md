# RBAC Specification

## Overview

This document defines the formal specification for the MerchOS platform Role-Based Access Control (RBAC) system. It covers permission naming conventions, expanded permission domains, role-permission mappings, and API documentation standards.

This specification extends the approved RBAC baseline (`.kiro/specs/rbac-platform-access-control/`) and should be read alongside the [RBAC Blueprint](./rbac-blueprint.md) for architectural context.

---

## 1. Permission Naming Standard

All permission identifiers on the MerchOS platform follow the **Permission Naming Standard**. This ensures consistency across engineering teams, audit logs, API annotations, and the central permission registry.

### 1.1 Format Definition

Every permission identifier follows the canonical format:

```
<resource>.<action>[.<scope>]
```

| Component | Required | Description |
|-----------|----------|-------------|
| `resource` | Yes | A lowercase, dot-delimited domain noun identifying the target resource or resource group |
| `action` | Yes | The operation type being performed on the resource |
| `scope` | No | An optional access boundary qualifier that restricts the breadth of access |

When the scope is omitted, the permission applies implicitly (typically meaning the action is unscoped or globally applicable to the role's context).

### 1.2 Format Components

#### Resource

The resource component identifies what is being accessed. It uses dot-delimited hierarchy for nested domains.

| Example | Description |
|---------|-------------|
| `products` | Product catalog resources |
| `system` | Platform system resources |
| `system.logs` | System logging subsystem |
| `ai` | AI/ML services |
| `ai.training` | AI model training subsystem |
| `marketplace.takealot` | Takealot marketplace integration |
| `marketplace.amazon` | Amazon marketplace integration |
| `subscription` | Subscription and billing resources |
| `analytics` | Analytics and reporting resources |
| `infrastructure` | Platform infrastructure resources |

#### Action

The action component identifies the operation being performed.

| Example | Description |
|---------|-------------|
| `read` | View or retrieve data |
| `create` | Create new resources |
| `update` | Modify existing resources |
| `delete` | Remove resources |
| `manage` | Full administrative control (implies all CRUD operations) |
| `generate` | Trigger AI/automated content generation |
| `export` | Export data to external systems |
| `view` | Read-only access (alias for read in specific domains) |
| `change` | Modify configuration or state |
| `cancel` | Terminate or deactivate |

#### Scope

The scope component qualifies the access boundary. When omitted, the scope is implicit based on the role's tenant context.

| Example | Description |
|---------|-------------|
| `own` | Limited to resources owned by the authenticated user's tenant |
| `all` | Access to all resources regardless of ownership (cross-tenant) |
| *(omitted)* | Scope is implicit — determined by role's tenant isolation rules |

### 1.3 Complete Examples

| Permission Identifier | Resource | Action | Scope | Description |
|----------------------|----------|--------|-------|-------------|
| `products.read.own` | products | read | own | Read products belonging to own tenant |
| `products.update.own` | products | update | own | Update products belonging to own tenant |
| `products.manage.all` | products | manage | all | Full admin control over all products |
| `system.logs` | system | logs | *(implicit)* | Access system logs |
| `system.metrics` | system | metrics | *(implicit)* | View system metrics |
| `ai.generate` | ai | generate | *(implicit)* | Generate AI content |
| `ai.images` | ai | images | *(implicit)* | Generate AI images |
| `marketplace.takealot.export` | marketplace.takealot | export | *(implicit)* | Export listings to Takealot |
| `marketplace.amazon.export` | marketplace.amazon | export | *(implicit)* | Export listings to Amazon |
| `subscription.view` | subscription | view | *(implicit)* | View subscription details |
| `subscription.manage` | subscription | manage | *(implicit)* | Full subscription administration |
| `subscription.cancel` | subscription | cancel | *(implicit)* | Cancel a subscription |

### 1.4 Naming Rules

All permission identifiers **must** conform to the following rules:

| Rule | Constraint |
|------|-----------|
| Case | **Lowercase only** — no uppercase characters permitted |
| Delimiter | **Dot-delimited** (`.`) — dots separate hierarchical components |
| Maximum length | **128 characters** total |
| Allowed characters | Lowercase letters (`a-z`), digits (`0-9`), dots (`.`), and hyphens (`-`) |
| Disallowed characters | Spaces, underscores, uppercase letters, and any special characters not listed above |
| Segment start | Each segment must begin with a lowercase letter (`a-z`) |
| Structure | Must contain at minimum a `resource` and `action` component (at least one dot) |

**Validation pattern (regex):**

```
^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*){1,}$
```

**Invalid examples:**

| Identifier | Violation |
|-----------|-----------|
| `Products.Read.Own` | Uppercase characters |
| `products_read_own` | Underscores instead of dots |
| `products.read.own.extra.segments.that.exceed.the.maximum.length...` (>128 chars) | Exceeds 128-character limit |
| `products` | Missing action component (no dot delimiter) |
| `.products.read` | Segment starts with a dot |
| `products..read` | Empty segment (consecutive dots) |
| `123.read.own` | Segment starts with a digit |

### 1.5 Central Registry Requirement

Every new permission introduced to the MerchOS platform **must**:

1. **Conform to the Permission Naming Standard** — The identifier must pass validation against the naming rules defined in section 1.4.
2. **Be added to the central permission registry** — Permissions are defined in the `@merch-os/rbac` package's `defaultPermissionConfig` before they can be referenced by middleware, guards, or API annotations.
3. **Include required metadata** — Each registry entry must specify:
   - The canonical permission identifier
   - A human-readable description
   - The list of roles granted the permission
   - The domain grouping for organizational purposes
4. **Undergo review** — New permissions must be reviewed for naming compliance, scope appropriateness, and least-privilege alignment before merging.

**Workflow for adding a new permission:**

```
1. Propose permission identifier following resource.action.scope format
2. Validate against naming rules (regex, length, character set)
3. Add entry to @merch-os/rbac defaultPermissionConfig
4. Assign to appropriate roles in the role-permission matrix
5. Submit for security and architecture review
6. Merge — middleware and guards automatically pick up the new permission
```

No source code changes to middleware, guards, or business logic are required when adding a new permission. The central registry is the single source of truth, and all consumers resolve permissions from it at runtime.

---

## 2. Expanded Permission Domains

This section documents the additional permission domains that extend the MerchOS RBAC model beyond the core product and user domains. Each domain groups logically related permissions and specifies which Platform_Roles are granted access.

### 2.1 System Domain

System domain permissions govern access to platform infrastructure, monitoring, and operational tooling. These permissions are restricted to administrative and support roles.

| Permission | Description | Admin | Support | Seller |
|-----------|-------------|:-----:|:-------:|:------:|
| `system.logs` | View system and application logs | ✅ | ✅ | ❌ |
| `system.metrics` | View system performance metrics and dashboards | ✅ | ❌ | ❌ |
| `system.health` | View system health status and service availability | ✅ | ✅ | ❌ |
| `system.configuration` | View and modify system configuration parameters | ✅ | ❌ | ❌ |
| `system.jobs` | View and manage background jobs (queues, retries, scheduling) | ✅ | ❌ | ❌ |

**Design rationale:**

- Support can view logs and health to assist with troubleshooting seller issues without requiring full system access.
- Metrics, configuration, and jobs are Admin-only because they expose infrastructure internals and permit state changes that affect all tenants.

### 2.2 AI Domain

AI domain permissions govern access to the platform's AI/ML content generation, image processing, and training capabilities.

| Permission | Description | Admin | Support | Seller |
|-----------|-------------|:-----:|:-------:|:------:|
| `ai.generate` | Generate AI-powered text content (descriptions, titles, SEO) | ✅ | ❌ | ✅ |
| `ai.images` | Generate or enhance product images using AI models | ✅ | ❌ | ✅ |
| `ai.catalogue` | Perform AI-assisted catalogue operations (categorization, enrichment) | ✅ | ❌ | ✅ |
| `ai.jobs` | View and manage AI processing jobs (status, retry, cancel) | ✅ | ❌ | ✅ |
| `ai.training` | Manage AI model training, fine-tuning, and model configuration | ✅ | ❌ | ❌ |

**Design rationale:**

- Sellers need AI generation capabilities for their product content workflow.
- Training is Admin-only because it affects model behavior for all tenants and has cost implications.
- Support does not have AI permissions because AI operations are tenant-specific and not part of the support workflow.

### 2.3 Marketplace Domain

Marketplace domain permissions govern the ability to export product listings to external sales channels. Each marketplace integration has its own permission to allow granular control over which channels a seller can publish to.

| Permission | Description | Admin | Support | Seller |
|-----------|-------------|:-----:|:-------:|:------:|
| `marketplace.takealot.export` | Export product listings to Takealot marketplace | ✅ | ❌ | ✅ |
| `marketplace.amazon.export` | Export product listings to Amazon marketplace | ✅ | ❌ | ✅ |
| `marketplace.makro.export` | Export product listings to Makro marketplace | ✅ | ❌ | ✅ |
| `marketplace.shopify.export` | Export product listings to Shopify storefront | ✅ | ❌ | ✅ |

**Design rationale:**

- Marketplace exports are core seller operations — sellers must be able to publish their products to channels.
- Each channel is a separate permission to support subscription-tier gating (e.g., a basic plan might only include Takealot and Shopify).
- Admin has all marketplace permissions for oversight and manual intervention.
- Support does not need export capabilities because exports are always initiated by sellers or automated jobs.

### 2.4 Subscription Domain

Subscription domain permissions govern access to billing, plan management, and invoice operations.

| Permission | Description | Admin | Support | Seller |
|-----------|-------------|:-----:|:-------:|:------:|
| `subscription.view` | View subscription plan details and current status | ✅ | ✅ | ✅ |
| `subscription.change` | Change subscription plan (upgrade, downgrade) | ✅ | ❌ | ✅ |
| `subscription.cancel` | Cancel an active subscription | ✅ | ❌ | ✅ |
| `subscription.invoice` | View and download subscription invoices | ✅ | ✅ | ✅ |
| `subscription.manage` | Full subscription administration (override plans, extend trials, apply credits) | ✅ | ❌ | ❌ |

**Design rationale:**

- All roles can view subscription status and invoices — this information is needed across all workflows.
- Sellers can change and cancel their own subscriptions (self-service billing).
- `subscription.manage` is Admin-only because it permits actions that bypass normal billing flows (plan overrides, manual credits).
- Support can view subscriptions and invoices to assist sellers but cannot make billing changes to prevent unauthorized modifications.

---

## 3. Role-Permission Matrix

The following table provides a comprehensive mapping of all Platform_Roles to all permissions defined under the new Permission Naming Standard. This matrix is the authoritative reference for role-based access decisions on newly standardized domains. For legacy permissions predating this standard (e.g., `users.search`, `processing-jobs`, `logs`), refer to the approved RBAC baseline at `.kiro/specs/rbac-platform-access-control/`.

### 3.1 Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Permission is granted to this role |
| ❌ | Permission is not granted to this role |

### 3.2 Complete Matrix

| Domain | Permission | Admin | Support | Seller |
|--------|-----------|:-----:|:-------:|:------:|
| **Products** | `products.read.own` | ✅ | ✅ | ✅ |
| **Products** | `products.create.own` | ✅ | ❌ | ✅ |
| **Products** | `products.update.own` | ✅ | ❌ | ✅ |
| **Products** | `products.delete.own` | ✅ | ❌ | ✅ |
| **Products** | `products.manage.all` | ✅ | ❌ | ❌ |
| **System** | `system.logs` | ✅ | ✅ | ❌ |
| **System** | `system.metrics` | ✅ | ❌ | ❌ |
| **System** | `system.health` | ✅ | ✅ | ❌ |
| **System** | `system.configuration` | ✅ | ❌ | ❌ |
| **System** | `system.jobs` | ✅ | ❌ | ❌ |
| **AI** | `ai.generate` | ✅ | ❌ | ✅ |
| **AI** | `ai.images` | ✅ | ❌ | ✅ |
| **AI** | `ai.catalogue` | ✅ | ❌ | ✅ |
| **AI** | `ai.jobs` | ✅ | ❌ | ✅ |
| **AI** | `ai.training` | ✅ | ❌ | ❌ |
| **Marketplace** | `marketplace.takealot.export` | ✅ | ❌ | ✅ |
| **Marketplace** | `marketplace.amazon.export` | ✅ | ❌ | ✅ |
| **Marketplace** | `marketplace.makro.export` | ✅ | ❌ | ✅ |
| **Marketplace** | `marketplace.shopify.export` | ✅ | ❌ | ✅ |
| **Subscription** | `subscription.view` | ✅ | ✅ | ✅ |
| **Subscription** | `subscription.change` | ✅ | ❌ | ✅ |
| **Subscription** | `subscription.cancel` | ✅ | ❌ | ✅ |
| **Subscription** | `subscription.invoice` | ✅ | ✅ | ✅ |
| **Subscription** | `subscription.manage` | ✅ | ❌ | ❌ |

### 3.3 Role Summary

| Role | Total Permissions | Tenant Scoped | Bypasses Ownership |
|------|:-----------------:|:-------------:|:------------------:|
| **Admin** | 24 | No | Yes |
| **Support** | 5 | No | Yes |
| **Seller** | 16 | Yes | No |

**Admin** has unrestricted access to all permissions across all domains. Admin is not tenant-scoped and bypasses ownership validation, enabling cross-tenant administration.

**Support** has targeted read-access permissions (logs, health, subscription details, invoices) and product read access to assist sellers. Support is not tenant-scoped (can view cross-tenant data for troubleshooting) and bypasses ownership validation.

**Seller** has operational permissions for products, AI generation, marketplace exports, and self-service subscription management. Seller is always tenant-scoped and subject to ownership validation — a Seller can only access resources belonging to their own tenant.

---

## 4. Permission Domain Addition Process

This section documents the standardized workflow for introducing new permission domains to the MerchOS platform. Adding a new domain is a configuration-only operation — no middleware, guard, or business logic code changes are required.

### 4.1 Required Fields

Every new permission domain entry in the `@merch-os/rbac` central registry must include the following fields:

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `domain` | string | Logical grouping name for the permission set | `"analytics"` |
| `permissions` | array | List of permission identifiers conforming to the naming standard | `["analytics.read", "analytics.export"]` |
| `description` | string | Human-readable description of the domain's purpose | `"Analytics and reporting capabilities"` |
| `roles` | object | Mapping of each permission to its allowed Platform_Roles | `{ "analytics.read": ["Admin", "Seller"] }` |
| `tenantScoped` | boolean (per permission) | Whether the permission enforces tenant isolation | `true` |
| `addedDate` | string (ISO 8601) | Date the domain was added to the registry | `"2025-01-15"` |
| `owner` | string | Team or individual responsible for the domain | `"Platform Team"` |

### 4.2 Review Criteria

Before a new permission domain is merged into the `@merch-os/rbac` registry, it must pass the following review gates:

| Criterion | Reviewer | Pass Condition |
|-----------|----------|----------------|
| **Naming compliance** | Any engineer | All permission identifiers pass the regex validation in section 1.4 |
| **Least-privilege alignment** | Security team | Each role receives only the minimum permissions necessary for its workflow |
| **Scope correctness** | Architecture team | Tenant isolation and ownership requirements are correctly specified |
| **No duplication** | Any engineer | The domain does not duplicate or overlap with existing permission identifiers |
| **Documentation complete** | Any engineer | Domain description, permission descriptions, and role assignments are all documented |
| **Backward compatibility** | Architecture team | Existing role-permission mappings are not modified or removed without a migration plan |

### 4.3 Configuration-Only Workflow

Adding a new permission domain follows this workflow:

```
Step 1: Propose
  └── Author drafts domain definition with all required fields
  └── Permission identifiers validated against naming standard (section 1.4)
  └── Open pull request targeting @merch-os/rbac package

Step 2: Review
  └── Automated: naming validation (regex check, length check, character set)
  └── Manual: security review for least-privilege alignment
  └── Manual: architecture review for scope and tenant isolation correctness
  └── Manual: no-duplication check against existing registry

Step 3: Approve & Merge
  └── Minimum two approvals required (one security, one architecture)
  └── Merge into @merch-os/rbac defaultPermissionConfig
  └── Package version bumped automatically

Step 4: Propagation
  └── All consumers (frontend, backend, middleware) pick up new permissions
      via workspace protocol dependency resolution
  └── No code changes required in consuming applications
  └── Middleware automatically enforces new permissions on annotated endpoints

Step 5: Verification
  └── Verify permissions appear in the PermissionRegistry at runtime
  └── Verify role-permission matrix reflects the new domain in admin tooling
  └── Update this RBAC Specification document with the new domain table
```

**Key principle:** At no point in this workflow are changes required to middleware source code, authorization guards, navigation filters, or business logic handlers. The `@merch-os/rbac` registry is the single source of truth, and all consumers resolve permissions from it dynamically.

### 4.4 Example: Adding an "Analytics" Domain

```typescript
// Addition to @merch-os/rbac defaultPermissionConfig
{
  domain: "analytics",
  description: "Analytics and reporting capabilities",
  addedDate: "2025-01-15",
  owner: "Platform Team",
  permissions: [
    {
      identifier: "analytics.read",
      description: "View analytics dashboards and reports",
      roles: ["Admin", "Support", "Seller"],
      tenantScoped: true,
    },
    {
      identifier: "analytics.export",
      description: "Export analytics data to CSV/PDF",
      roles: ["Admin", "Seller"],
      tenantScoped: true,
    },
    {
      identifier: "analytics.manage",
      description: "Configure analytics settings and custom reports",
      roles: ["Admin"],
      tenantScoped: false,
    },
  ],
}
```

After merging this configuration, all platform consumers immediately recognize the new permissions without any code changes.

---

## 5. API Documentation Standard

Every protected API endpoint on the MerchOS platform **must** include standardized authorization metadata. This metadata makes each endpoint's security requirements discoverable, auditable, and verifiable against the actual code annotations.

### 5.1 Required Fields

The API_Documentation_Standard requires every protected endpoint to document the following fields:

| Field | Required | Description |
|-------|:--------:|-------------|
| `endpoint` | Yes | HTTP method and path (e.g., `POST /api/products`) |
| `method` | Yes | HTTP verb (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) |
| `authentication` | Yes | Authentication mechanism (always `Bearer JWT (Cognito)` for protected endpoints) |
| `required_role` | Yes | Platform_Role(s) permitted to access this endpoint |
| `required_permission` | Yes | Canonical permission identifier following the Permission_Naming_Standard (section 1) |
| `ownership_required` | Yes | Whether the middleware performs ownership validation on the target resource |
| `ownership_field` | Conditional | The field used for ownership comparison (required when `ownership_required: true`) |
| `tenant_isolation` | Yes | Tenant scoping behavior: `scoped`, `global`, or `bypassed` |
| `error_responses` | Yes | Structured map of HTTP 401 and 403 error codes with descriptions |

### 5.2 Standard Template (YAML)

The following YAML template shows all required fields with placeholder values:

```yaml
# API Endpoint Documentation Standard — Template
# Every protected endpoint MUST have an entry following this format.

endpoint: <METHOD> /api/<resource-path>
method: <GET | POST | PUT | PATCH | DELETE>
authentication: Bearer JWT (Cognito)
required_role:
  - <Role1>
  - <Role2>
required_permission: <resource.action.scope>
ownership_required: <true | false>
ownership_field: <field name used for ownership check, or null>
tenant_isolation: <scoped | global | bypassed>
error_responses:
  401:
    - code: MISSING_TOKEN
      description: No Bearer JWT provided in the Authorization header
    - code: INVALID_TOKEN
      description: JWT signature is invalid or malformed
    - code: TOKEN_EXPIRED
      description: JWT exp claim is in the past
  403:
    - code: INSUFFICIENT_PERMISSIONS
      description: Authenticated role lacks the required permission
    - code: TENANT_ISOLATION_VIOLATION
      description: Resource belongs to a different tenant than the authenticated user
    - code: OWNERSHIP_VALIDATION_FAILURE
      description: Authenticated user does not own the target resource
```

### 5.3 Compliance Requirement

**Endpoints without the required authorization metadata are non-compliant.**

Non-compliant endpoints:

1. **Must not be deployed to production** — CI/CD pipelines should flag endpoints missing API documentation metadata during pull request review.
2. **Must be updated before their next release** — Existing endpoints lacking documentation must be backfilled before their next deployment.
3. **Are subject to audit findings** — Security audits will flag undocumented endpoints as gaps in the authorization surface.

A compliant endpoint has:
- All required fields populated with valid values
- The `required_permission` field conforming to the Permission_Naming_Standard (section 1)
- Error responses covering all applicable failure codes for the endpoint's authorization profile

### 5.4 Representative Endpoint Examples

The following three examples demonstrate the complete API_Documentation_Standard for each Platform_Role archetype.

#### Example 1: Admin Endpoint — Manage System Configuration

```yaml
endpoint: PUT /api/admin/system/configuration
method: PUT
authentication: Bearer JWT (Cognito)
required_role:
  - Admin
required_permission: system.configuration
ownership_required: false
ownership_field: null
tenant_isolation: global
error_responses:
  401:
    - code: MISSING_TOKEN
      description: No Bearer JWT provided in the Authorization header
    - code: INVALID_TOKEN
      description: JWT signature is invalid or malformed
    - code: TOKEN_EXPIRED
      description: JWT exp claim is in the past
  403:
    - code: INSUFFICIENT_PERMISSIONS
      description: Authenticated role lacks system.configuration permission
    - code: UNRECOGNIZED_ROLE
      description: JWT cognito:groups does not map to a known Platform_Role
```

**Notes:**
- Admin endpoints typically have `ownership_required: false` because Admin bypasses ownership validation.
- `tenant_isolation: global` indicates the Admin operates across all tenants.
- No `TENANT_ISOLATION_VIOLATION` or `OWNERSHIP_VALIDATION_FAILURE` errors are listed because Admin bypasses both checks.

#### Example 2: Support Endpoint — View Subscription Invoice

```yaml
endpoint: GET /api/support/subscriptions/:tenantId/invoices
method: GET
authentication: Bearer JWT (Cognito)
required_role:
  - Admin
  - Support
required_permission: subscription.invoice
ownership_required: false
ownership_field: null
tenant_isolation: bypassed
error_responses:
  401:
    - code: MISSING_TOKEN
      description: No Bearer JWT provided in the Authorization header
    - code: INVALID_TOKEN
      description: JWT signature is invalid or malformed
    - code: TOKEN_EXPIRED
      description: JWT exp claim is in the past
  403:
    - code: INSUFFICIENT_PERMISSIONS
      description: Authenticated role lacks subscription.invoice permission
    - code: UNRECOGNIZED_ROLE
      description: JWT cognito:groups does not map to a known Platform_Role
```

**Notes:**
- Support can view invoices for any tenant to assist with troubleshooting — `tenant_isolation: bypassed`.
- Ownership is not required because Support accesses resources on behalf of sellers.
- Seller is intentionally excluded from `required_role` for this endpoint because sellers access their own invoices via a different tenant-scoped route.

#### Example 3: Seller Endpoint — Create Product

```yaml
endpoint: POST /api/products
method: POST
authentication: Bearer JWT (Cognito)
required_role:
  - Admin
  - Seller
required_permission: products.create.own
ownership_required: true
ownership_field: tenantId
tenant_isolation: scoped
error_responses:
  401:
    - code: MISSING_TOKEN
      description: No Bearer JWT provided in the Authorization header
    - code: INVALID_TOKEN
      description: JWT signature is invalid or malformed
    - code: TOKEN_EXPIRED
      description: JWT exp claim is in the past
  403:
    - code: INSUFFICIENT_PERMISSIONS
      description: Authenticated role lacks products.create.own permission
    - code: TENANT_ISOLATION_VIOLATION
      description: Request tenantId does not match the authenticated user's JWT custom:tenantId
    - code: OWNERSHIP_VALIDATION_FAILURE
      description: Authenticated seller does not own the target resource context
```

**Notes:**
- Seller endpoints have `tenant_isolation: scoped` — the middleware enforces that the Seller can only create resources within their own tenant.
- `ownership_required: true` with `ownership_field: tenantId` means the middleware validates that the request's tenant context matches the JWT `custom:tenantId` claim.
- Admin is included in `required_role` because Admin can perform any operation across all tenants.

### 5.5 Relationship Between Code Annotations and Documentation Entries

The API_Documentation_Standard entries are the **human-readable counterpart** to the permission annotations applied in code. The two must remain in sync.

#### Code Annotations (Source of Truth at Runtime)

In the MerchOS codebase, every protected endpoint declares its authorization requirements via decorators or middleware configuration that reference the `@merch-os/rbac` package:

```typescript
// Example: NestJS-style decorator annotation on a controller method
@RequirePermission('products.create.own')
@Post('/api/products')
async createProduct(@Body() dto: CreateProductDto, @Ctx() ctx: AuthorizedRequestContext) {
  // Business logic only — no auth checks here
}
```

The `@RequirePermission` decorator (or equivalent middleware registration) reads the canonical permission identifier and delegates enforcement to the Middleware_Pipeline.

#### Documentation Entries (Source of Truth for Auditing)

The API_Documentation_Standard entry for the same endpoint captures the full authorization profile — not just the permission, but the complete security context including roles, ownership, tenant isolation, and error responses.

#### Synchronization Rules

| Aspect | Code Annotation | API Documentation Entry |
|--------|----------------|------------------------|
| Permission identifier | Declared via decorator/middleware config | `required_permission` field |
| Role restriction | Resolved from `@merch-os/rbac` role-permission matrix | `required_role` field (explicit list) |
| Ownership requirement | Configured in middleware pipeline for the route | `ownership_required` and `ownership_field` fields |
| Tenant isolation | Determined by role type (Seller = scoped, Admin/Support = global/bypassed) | `tenant_isolation` field |
| Error responses | Produced by middleware stages | `error_responses` map |

**Key principles:**

1. **Code annotations are the runtime enforcement mechanism.** The `@merch-os/rbac` package and middleware pipeline enforce permissions at request time.
2. **API documentation entries are the audit and review mechanism.** They provide a complete picture of an endpoint's security posture for security reviews, onboarding, and compliance audits.
3. **Both must reference the same canonical permission identifier.** If a code annotation uses `products.create.own`, the documentation entry's `required_permission` must be `products.create.own` — never a paraphrase or abbreviation.
4. **Drift between code and documentation is a compliance violation.** When a code annotation changes (e.g., permission renamed or role added), the corresponding API documentation entry must be updated in the same pull request.
5. **Automated validation is encouraged.** Teams should implement CI checks that compare code-level permission annotations against API documentation entries to detect drift automatically.
