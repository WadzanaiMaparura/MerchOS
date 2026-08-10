# MerchOS Canonical Product Model Specification

> **Version:** 1.0  
> **Status:** Living Document  
> **Last Updated:** 2026-08  
> **Related ADR:** [ADR-004: Canonical Product Domain Model](./adr/ADR-004-canonical-product-domain-model.md)  
> **Type Definition:** `packages/types/src/marketplace.ts` → `CanonicalProduct`

This document is the authoritative specification for the MerchOS canonical product model — the single source of truth for product data across the platform.

---

## Table of Contents

1. [Source of Truth Declaration](#1-source-of-truth-declaration)
2. [Data Domain Separation](#2-data-domain-separation)
3. [Identifier Semantics](#3-identifier-semantics)
4. [Variant Model](#4-variant-model)
5. [Asset References](#5-asset-references)
6. [Tenant Ownership](#6-tenant-ownership)
7. [API DTO Boundaries](#7-api-dto-boundaries)
8. [Persistence Boundaries](#8-persistence-boundaries)
9. [Lifecycle States](#9-lifecycle-states)
10. [Marketplace Export Pipeline Relationship](#10-marketplace-export-pipeline-relationship)

---

## 1. Source of Truth Declaration

**`CanonicalProduct` is the single authoritative domain model for product data in MerchOS.**

```
Rule: Marketplace schemas describe destination requirements;
      they do not define the MerchOS canonical product.
```

This means:
- No marketplace's field naming, data types, or structural organization influences the canonical model
- The canonical model represents what a product IS, not how any platform expects to receive it
- Platform adapters are responsible for transforming canonical data into marketplace-specific formats
- Adding a new marketplace never requires modifying the canonical model's structure

The `CanonicalProduct` interface in `packages/types/src/marketplace.ts` is the TypeScript contract for this model.

---

## 2. Data Domain Separation

The canonical model separates product data into three distinct domains with clear boundaries:

### 2.1 Content Domain (`CanonicalContentData`)

**What the product IS** — platform-neutral identity and descriptive data.

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Primary product title |
| `shortDescription` | string \| null | Brief summary |
| `longDescription` | string \| null | Full description |
| `bulletPoints` | string[] | Key features/selling points |
| `brand` | string | Brand name |
| `manufacturer` | string \| null | Manufacturer (if different from brand) |
| `sku` | string | Seller-defined product reference |
| `barcode` | string \| null | GTIN/EAN/UPC |
| `mpn` | string \| null | Manufacturer part number |
| `weight` / `weightUnit` | number \| null | Physical weight |
| `length` / `width` / `height` / `dimensionUnit` | number \| null | Physical dimensions |
| `materials` | string[] | Material composition |
| `attributes` | Record<string, string \| number \| boolean> | Flexible key-value attributes |
| `imageRefs` | CanonicalImageRef[] | S3 image references |
| `variants` | CanonicalVariant[] | Product variants |

### 2.2 Commercial Domain (`CanonicalCommercialData`)

**How the product is SOLD** — pricing, stock, and listing configuration.

| Field | Type | Description |
|-------|------|-------------|
| `sellingPrice` | number \| null | Current selling price |
| `rrp` | number \| null | Recommended retail price |
| `salePrice` | number \| null | Promotional price |
| `currency` | string | Currency code (ISO 4217) |
| `stockQuantity` | number | Available stock |
| `lowStockThreshold` | number \| null | Alert threshold |
| `fulfilmentMethod` | string \| null | Shipping/fulfilment type |
| `leadtimeDays` | number \| null | Delivery lead time |
| `handlingTimeDays` | number \| null | Processing time |
| `listingStatus` | 'active' \| 'draft' \| 'archived' | Listing visibility |
| `saleStartDate` / `saleEndDate` | string \| null | Promotional window |

### 2.3 Platform-Specific Domain (`PlatformSpecificData`)

**Per-marketplace state** — identifiers, category mappings, and export history.

| Field | Type | Description |
|-------|------|-------------|
| `platformIdentifiers` | Partial<Record<ChannelId, string>> | ASIN, TSIN, Handle, etc. |
| `categoryMappings` | Partial<Record<ChannelId, string>> | Target category per platform |
| `metadata` | Partial<Record<ChannelId, Record<string, unknown>>> | Platform-specific metadata |
| `exportHistory` | Partial<Record<ChannelId, ExportHistoryEntry>> | Last export state per platform |

---

## 3. Identifier Semantics

MerchOS uses a clear hierarchy of identifiers with distinct scopes and purposes:

| Identifier | Scope | Uniqueness | Purpose |
|------------|-------|------------|---------|
| `productId` | MerchOS internal | Globally unique (UUID v4) | Primary key; immutable after creation |
| `tenantId` | MerchOS internal | Globally unique (UUID v4) | Ownership and isolation boundary |
| `sku` | Seller-defined | Unique within tenant | Seller's own reference code |
| `barcode` (GTIN/EAN/UPC) | Global standard | Globally unique (in theory) | Physical product identification |
| `mpn` | Manufacturer-assigned | Unique per manufacturer | Manufacturer's part reference |
| Platform identifiers | Per-platform | Unique within platform | ASIN, TSIN, Shopify Handle, etc. |

**Key rules:**
- `productId` is assigned by MerchOS at creation and never changes
- `tenantId` is assigned at creation and never changes (products cannot be moved between tenants)
- `sku` is seller-defined and mutable (sellers may redefine their SKU scheme)
- Platform identifiers are stored in `platformSpecific.platformIdentifiers` and assigned by the platform after first export

---

## 4. Variant Model

### 4.1 Platform-Independent Design

The canonical variant model imposes **no platform-specific constraints**:

- A product may have unlimited option axes (Colour, Size, Material, Finish, etc.)
- Each `CanonicalVariant` represents one combination of option values
- Variants inherit content from the parent product and override specific fields

### 4.2 Variant Structure

Each variant contains:
- `variantId` — Unique identifier (UUID)
- `sku` — Variant-specific SKU (seller-defined)
- `barcode` — Variant-specific GTIN (optional)
- `optionValues` — The specific option combination (e.g., `{ "Colour": "Blue", "Size": "Large" }`)
- `priceOverride` — Override parent selling price (null = inherit)
- `stockOverride` — Override parent stock quantity (null = inherit)
- `imageRefs` — Variant-specific images

### 4.3 Platform Adaptation

Platform adapters handle variant transformation:
- **Shopify:** Maximum 3 options; adapter maps or consolidates axes
- **Amazon:** Variation themes; adapter maps option axes to Amazon's variation structure
- **Takealot:** Variant representation in Bulk Offers CSV format
- **Makro:** Vertical-dependent variant handling
- **WooCommerce:** Variable product attributes

---

## 5. Asset References

### 5.1 S3 Storage Model

All product images are stored in S3. The canonical model references images by S3 key, never by platform-specific URLs.

```
CanonicalImageRef {
  imageId: string       // Unique identifier
  s3Key: string         // S3 object key (bucket implied by environment)
  position: number      // Display ordering
  altText: string       // Accessibility text
  mimeType: string      // image/jpeg, image/png, image/webp
  width: number         // Pixel width
  height: number        // Pixel height
  fileSize: number      // Bytes
  variantId: string     // Associated variant (null = parent product)
}
```

### 5.2 Platform URL Resolution

Platform adapters resolve S3 keys to publicly accessible URLs:
- CloudFront CDN distribution for standard delivery
- Platform-specific format/resolution requirements handled at export time
- Image processing (resize, format conversion) is decoupled from product data

---

## 6. Tenant Ownership

### 6.1 Ownership Rule

Every product belongs to **exactly one tenant**. This relationship is:
- Established at product creation (immutable)
- Enforced at persistence layer via partition key design
- Validated at API layer via JWT `custom:tenantId` claim

### 6.2 Isolation Guarantees

- No API operation can access products across tenant boundaries (Seller role)
- Admin role has cross-tenant read/write access for platform management
- DynamoDB partition key `TENANT#{tenantId}` physically groups tenant data
- No GSI or query pattern enables accidental cross-tenant data leakage

---

## 7. API DTO Boundaries

### 7.1 Conversion Layer

The service layer converts between domain model and API DTOs:

```
┌──────────────────┐    Service Layer    ┌─────────────────┐    HTTP    ┌──────────┐
│ CanonicalProduct │ ──────────────────► │   Product DTO   │ ────────► │ Frontend │
│   (DynamoDB)     │                     │   (API Response)│           │          │
└──────────────────┘                     └─────────────────┘           └──────────┘

┌──────────┐    HTTP     ┌──────────────────┐    Service Layer    ┌──────────────────┐
│ Frontend │ ──────────► │ Request DTOs     │ ──────────────────► │ CanonicalProduct │
│          │             │ (API Payloads)   │                     │   (DynamoDB)     │
└──────────┘             └──────────────────┘                     └──────────────────┘
```

### 7.2 DTO Enrichments

The `Product` API DTO includes fields NOT present in `CanonicalProduct`:

| DTO Field | Source | Why not in canonical model |
|-----------|--------|---------------------------|
| `enrichmentLayer` | AI services (Bedrock, Rekognition) | Computed; derived from content analysis |
| `lifecycleHistory` | Audit trail / event log | Historical; not current state |
| `complianceReports` | Validation Engine results | Per-platform; computed on demand |
| `categoryMappings` (enriched) | Taxonomy service + AI confidence | Includes recommendation scores |

### 7.3 Lifecycle State Translation

| Canonical State | API DTO States (LifecycleState) |
|-----------------|-------------------------------|
| `draft` | `DRAFT` |
| `ready` | `INGESTED`, `ENRICHED`, `REVIEW` |
| `validated` | `VALIDATED`, `EXPORT_READY` |
| `exported` | `PUBLISHED` |
| `archived` | `ARCHIVED` |

---

## 8. Persistence Boundaries

### 8.1 DynamoDB Table Design — PROPOSED, NOT IMPLEMENTED

> ⚠️ **STATUS: PROPOSED — NOT IMPLEMENTED**
>
> The DynamoDB table, repository layer, and persistence logic described below have NOT been deployed. This section documents the **proposed** design based on identified access patterns. It will be implemented during the Product Service phase.

The canonical product is designed to be persisted through a Product Repository backed by a single-table DynamoDB design:

**Primary Table (PROPOSED):**

| Access Pattern | PK | SK | Notes |
|---------------|----|----|-------|
| Create product | `TENANT#{tenantId}` | `PRODUCT#{productId}` | ConditionExpression: attribute_not_exists(PK) |
| Get product by ID | `TENANT#{tenantId}` | `PRODUCT#{productId}` | GetItem — single item read |
| List products for tenant | `TENANT#{tenantId}` | `begins_with(PRODUCT#)` | Query — paginated with ExclusiveStartKey |
| Update product | `TENANT#{tenantId}` | `PRODUCT#{productId}` | ConditionExpression: attribute_exists(PK) |
| Delete product | `TENANT#{tenantId}` | `PRODUCT#{productId}` | Soft-delete: set lifecycleState = 'archived' |

**GSI1 — SKU Lookup (PROPOSED):**

| Access Pattern | GSI1-PK | GSI1-SK | Notes |
|---------------|---------|---------|-------|
| Get product by SKU | `TENANT#{tenantId}#SKU` | `SKU#{sku}` | Unique within tenant |

**Variant Storage (PROPOSED):**
- Variants will be stored as a nested attribute within the product item (sub-document pattern)
- For products with large variant counts, sub-items may be used: PK=`TENANT#{tenantId}`, SK=`PRODUCT#{productId}#VARIANT#{variantId}`

**Export State (PROPOSED):**
- Marketplace export state will be stored within the `platformSpecific.exportHistory` attribute of the product item
- No separate table or item for export tracking

### 8.2 Cost Model (PROPOSED)

| Resource | Configuration | Rationale |
|----------|---------------|-----------|
| DynamoDB | On-demand capacity | Unpredictable traffic; no pre-provisioning |
| S3 | Standard storage class | Write-once, read-many image pattern |
| Lambda | Serverless (no provisioned concurrency) | Zero cost at idle |
| Networking | No NAT Gateway, no VPC | Reduces cold starts; eliminates fixed costs |

---

## 9. Lifecycle States

### 9.1 Canonical Lifecycle (Domain Model)

The canonical model tracks high-level export-readiness:

```
draft ──► ready ──► validated ──► exported ──► archived
  ▲                                               │
  └───────────────── (unarchive) ─────────────────┘
```

| State | Meaning | Export Eligible |
|-------|---------|:--------------:|
| `draft` | Content being populated | ❌ |
| `ready` | Core content complete; eligible for validation | ❌ |
| `validated` | Passed validation for ≥1 target platform | ✅ |
| `exported` | Successfully exported to ≥1 platform | ✅ |
| `archived` | Inactive; retained for history | ❌ |

### 9.2 Full Pipeline State Machine (API DTO)

The `LifecycleState` type in `common.ts` represents the complete pipeline with intermediate processing steps:

```
DRAFT → INGESTED → ENRICHED → REVIEW → VALIDATED → EXPORT_READY → PUBLISHED → ARCHIVED
```

This extended state machine provides UI visibility into:
- Whether a product has been ingested from import
- Whether AI enrichment has completed
- Whether human review is pending
- Whether the product is queued for export vs. already published

---

## 10. Marketplace Export Pipeline Relationship

### 10.1 Pipeline Input

The `CanonicalProduct` is the **sole input** to the marketplace export pipeline. The pipeline never reads from API DTOs, import staging tables, or platform-specific representations.

```
CanonicalProduct
       │
       ▼
┌─────────────────┐
│ Schema Registry │ ← MarketplaceSchema (external requirements)
│ Lookup          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Validation      │ → ValidationResult (pass/fail report)
│ Engine          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Platform        │ → Platform-specific output (CSV/TSV/XLSX/API)
│ Adapter         │
└─────────────────┘
```

### 10.2 Rule

> **Marketplace schemas describe destination requirements; they do not define the MerchOS canonical product.**

The `MarketplaceSchema` type defines what a platform needs (required fields, formats, validation rules). It is **reference data** — configuration that informs the validation and transformation engines. It never flows back to alter the canonical model's structure.

### 10.3 Compatibility Matrix

| Platform | Export Format | Category-Aware | Adapter |
|----------|-------------|:--------------:|---------|
| Takealot | CSV | ❌ (flat) | TakealotAdapter |
| Makro | XLSX | ✅ (vertical-specific) | MakroAdapter |
| Amazon | TSV / API | ✅ (product-type) | AmazonAdapter |
| Shopify | JSON (API) | ❌ | ShopifyAdapter |
| WooCommerce | JSON (API) | ❌ | WooCommerceAdapter |

---

## 11. Deprecated/Superseded Types

The following types are **deprecated** and must not be used for new development:

| File | Type | Status | Replacement |
|------|------|--------|-------------|
| `services/shared/types/product.types.ts` | `Product` | **DEPRECATED** — zero consumers | `CanonicalProduct` (domain) + `Product` DTO (API) in `packages/types/` |
| `services/shared/types/product.types.ts` | `Listing` | **DEPRECATED** — zero consumers | Schema Registry + Platform Adapter pattern (see §10) |

### Why `Listing extends Product` was rejected

The `Listing` interface extended `Product` with channel-specific fields, creating a single monolithic type that embedded marketplace-specific data into the product model. This violates the core architectural principle:

> **Marketplace schemas describe destination requirements; they do not define the MerchOS canonical product.**

The correct approach (per ADR-003 and ADR-004) is:
1. `CanonicalProduct` stores marketplace-independent product data
2. `PlatformSpecificData` stores per-marketplace identifiers and export history as a separate domain within the canonical model
3. Platform adapters transform canonical data into marketplace-specific export formats at export time
4. No "listing" type extends or inherits from the product model

### Cleanup timeline

The deprecated file is retained to avoid breaking hidden references. It will be removed in a future cleanup pass after a full dependency audit confirms no transitive imports.

---

## References

- [ADR-003: Canonical Product Model with Marketplace Adapters](./adr/ADR-003-canonical-product-model-marketplace-adapters.md)
- [ADR-004: Canonical Product Domain Model — Role Clarity](./adr/ADR-004-canonical-product-domain-model.md)
- [Schema & Validation Architecture](./schema-validation-architecture.md)
- [MerchOS Blueprint — Section 11](./merchos-blueprint.md#11-canonical-product-model)
- Type definitions: `packages/types/src/marketplace.ts` (CanonicalProduct), `packages/types/src/product.ts` (Product DTO)
