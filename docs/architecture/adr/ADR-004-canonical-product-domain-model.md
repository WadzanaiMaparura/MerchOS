# ADR-004: Canonical Product Domain Model — Role Clarity and Type Hierarchy

## Status

**Accepted**

Date: 2026-08

## Context

MerchOS maintains multiple product-related type definitions that serve different architectural layers. Without explicit role documentation, these types risk being confused, duplicated, or inadvertently promoted to competing "canonical" models. This ADR establishes unambiguous role assignments for every product-related type in the system.

### The Problem

Two primary product interfaces exist in `@merch-os/types`:

1. **`CanonicalProduct`** (in `marketplace.ts`) — A cleanly-separated domain model with `content`, `commercial`, and `platformSpecific` data domains.
2. **`Product`** (in `product.ts`) — An API response DTO that includes computed/enriched fields like `enrichmentLayer`, `lifecycleHistory`, and `complianceReports`.

Additionally, the system has:
- **`MarketplaceSchema`** (in `marketplace.ts`) — External platform requirements stored in the Schema Registry.
- **`LifecycleState`** (in `common.ts`) — The full product pipeline state machine.
- Various request/response DTOs for frontend operations.

Their roles must be unambiguous to prevent architectural drift.

## Decision

**MerchOS maintains ONE marketplace-independent `CanonicalProduct` domain model as the authoritative source of truth. All other product-related types are derived, projected, or external — none may silently become a second canonical model.**

### Model Hierarchy

| Type | File | Role | Authority Level |
|------|------|------|-----------------|
| `CanonicalProduct` | `marketplace.ts` | **Authoritative domain model** — persisted, exported, marketplace-independent | Source of truth |
| `Product` | `product.ts` | **API response DTO** — derived from CanonicalProduct + enrichments at service boundary | Projection (read) |
| `ProductSummary` | `product.ts` | **List-view DTO** — lightweight projection for paginated listing endpoints | Projection (read) |
| `MarketplaceSchema` | `marketplace.ts` | **External requirements** — describes what a platform needs, never dictates canonical model | External reference |
| Request DTOs | `product.ts` | **Mutation payloads** — wire format for create/update operations | Input (write) |

### Data Domains

The canonical model cleanly separates product data into three domains:

| Domain | Interface | Contents |
|--------|-----------|----------|
| **Content** | `CanonicalContentData` | Title, descriptions, brand, identifiers, physical attributes, images, variants |
| **Commercial** | `CanonicalCommercialData` | Pricing, stock, fulfilment, listing status, sale windows |
| **Platform-Specific** | `PlatformSpecificData` | Per-marketplace identifiers, category mappings, export history |

### Identifier Semantics

| Identifier | Scope | Purpose | Example |
|------------|-------|---------|---------|
| `productId` | Internal (UUID) | Globally unique product identity within MerchOS | `550e8400-e29b-41d4-a716-446655440000` |
| `tenantId` | Internal (UUID) | Ownership — every product belongs to exactly one tenant | `tenant_abc123` |
| `sku` | Seller-defined | Seller's own product reference; unique within tenant | `WIDGET-BLU-LG` |
| `barcode` / GTIN / EAN | External | Global trade item number for physical identification | `5012345678900` |
| `mpn` | External | Manufacturer part number | `MFG-12345` |
| Platform identifiers | External per-platform | ASIN (Amazon), TSIN (Takealot), Handle (Shopify) | Stored in `platformSpecific.platformIdentifiers` |

### Tenant Isolation

Every product belongs to **exactly one tenant**. This is enforced at the persistence layer:

- **Partition key:** `TENANT#{tenantId}` — physically isolates tenant data in DynamoDB
- **No cross-tenant queries:** The system never executes queries that span tenants
- **JWT enforcement:** The `custom:tenantId` claim in authenticated JWTs constrains all data access

### Variant Model

Variants are **platform-independent** in the canonical model:

- A product defines option axes (Colour, Size, Material, etc.) without platform limits
- Each variant is a unique combination of option values with its own SKU, barcode, price override, stock override, and images
- Platform adapters transform canonical variants to destination format (e.g., Shopify's 3-option limit, Amazon's variation themes)

### Image Architecture

Images are stored as **S3 references** in the canonical model:

- `CanonicalImageRef` contains `s3Key`, dimensions, MIME type, and file size
- No platform-specific URLs in the canonical model
- Platform adapters resolve S3 keys to publicly accessible URLs meeting each marketplace's requirements
- Image processing (resize, format conversion, background removal) is separate from product data

### Lifecycle State Alignment

The canonical model uses a **simplified lifecycle subset**:

```
draft → ready → validated → exported → archived
```

The full `LifecycleState` in `common.ts` represents the complete product pipeline:

```
DRAFT → INGESTED → ENRICHED → REVIEW → VALIDATED → EXPORT_READY → PUBLISHED → ARCHIVED
```

The canonical model tracks high-level export-readiness. The full state machine (used in the API DTO) provides visibility into intermediate processing steps for the UI.

### DynamoDB Access Patterns (Documented — Not Implemented)

| Operation | Partition Key | Sort Key / Condition | Notes |
|-----------|--------------|---------------------|-------|
| Create product | `TENANT#{tenantId}` | `PRODUCT#{productId}` | Condition: attribute_not_exists |
| Get product by ID | `TENANT#{tenantId}` | `PRODUCT#{productId}` | Single-item read |
| List products for tenant | `TENANT#{tenantId}` | `begins_with(PRODUCT#)` | Paginated query |
| Get product by SKU | GSI1: `TENANT#{tenantId}#SKU` | `SKU#{sku}` | Lookup by seller-defined identifier |
| Update product | `TENANT#{tenantId}` | `PRODUCT#{productId}` | Condition: attribute_exists |
| Delete product | `TENANT#{tenantId}` | `PRODUCT#{productId}` | Soft-delete via lifecycle → archived |
| Retrieve variants | Within product item | — | Stored as nested attribute or sub-items |
| Marketplace export state | Within product item | — | In `platformSpecific.exportHistory` |

### Cost Control Principles

| Concern | Decision | Rationale |
|---------|----------|-----------|
| DynamoDB capacity | On-demand (pay-per-request) | Unpredictable traffic from multi-marketplace export bursts |
| Image storage | S3 Standard | Cost-effective for write-once, read-many image assets |
| Compute | Lambda serverless | Zero cost when idle; scales to export traffic |
| Networking | No NAT Gateway | Lambda accesses DynamoDB and S3 via VPC endpoints or public endpoints |
| No VPC | Lambda runs outside VPC | Reduces cold starts and eliminates NAT cost |
| No provisioned capacity | Neither DynamoDB nor Lambda | Avoids paying for unused capacity |

### Marketplace Compatibility

The canonical model feeds into the established export pipeline for all 5 supported platforms:

```
CanonicalProduct → Schema Registry → Validation Engine → Platform Adapter → Export Output
```

Confirmed compatibility:
- **Takealot** — Bulk Offers CSV, barcode-centric identification
- **Makro** — Vertical-specific loadsheets, category-dependent fields
- **Amazon** — Product-type templates, hierarchical classification
- **Shopify** — Handle/variant/metafield model via API
- **WooCommerce** — Product-type + custom metadata via REST API

## Consequences

### Benefits

- **No ambiguity** — Every type has a declared role; engineers know which type to use where
- **No silent drift** — Supporting types cannot accidentally become competing canonical models
- **Clean service boundary** — Domain ↔ DTO conversion is explicit and intentional
- **Testable contracts** — Each layer (domain, DTO, persistence) has a clear interface

### Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| DTO diverges from domain model without mapping logic | Service layer conversion functions enforce contract |
| New types introduced without role assignment | Code review checklist: "Does this type compete with CanonicalProduct?" |
| Persistence schema drifts from domain model | DynamoDB access patterns documented here; implementation must conform |

## References

- [ADR-003: Canonical Product Model with Marketplace Adapters](./ADR-003-canonical-product-model-marketplace-adapters.md)
- [Canonical Product Model Specification](../canonical-product-model.md)
- [Schema & Validation Architecture](../schema-validation-architecture.md)
- [MerchOS Blueprint — Section 11](../merchos-blueprint.md#11-canonical-product-model)
- Type definitions: `packages/types/src/marketplace.ts`, `packages/types/src/product.ts`
