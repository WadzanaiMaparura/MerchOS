# MerchOS Schema Registry & Validation Architecture

> **Version:** 1.1  
> **Status:** Living Document  
> **Last Updated:** 2026-08  
> **Related ADR:** [ADR-003: Canonical Product Model with Marketplace Adapters](./adr/ADR-003-canonical-product-model-marketplace-adapters.md)

This document specifies the architecture for the MerchOS Schema Registry, Validation Engine, Platform Adapters, and Export Pipeline. It defines how canonical product data is validated against marketplace-specific requirements and transformed into platform-compliant export formats.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Canonical Product Model](#2-canonical-product-model)
3. [Schema Registry](#3-schema-registry)
4. [Validation Engine](#4-validation-engine)
5. [Platform Adapters](#5-platform-adapters)
6. [Export Pipeline](#6-export-pipeline)
7. [Image Architecture](#7-image-architecture)
8. [Commercial Data Architecture](#8-commercial-data-architecture)
9. [Error & Rejection Handling](#9-error--rejection-handling)
10. [Extensibility](#10-extensibility)

---

## 1. Architecture Overview

### 1.1 End-to-End Flow

```
┌─────────────────────────┐
│  Canonical MerchOS      │
│  Product                │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Target Selection       │
│  • Marketplace          │
│  • Category/Vertical    │
│  • Export Mode          │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Schema Registry        │
│  Lookup                 │
│  (platform + category   │
│   + version)            │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Mapping &              │
│  Transformation Engine  │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Deterministic          │
│  Validation Engine      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Validation Report      │
│  (ERROR/WARNING/INFO)   │
└───────────┬─────────────┘
            │
      ┌─────┴──────┐
      │            │
   ERRORS?      No ERRORS
      │            │
      ▼            ▼
┌──────────┐  ┌─────────────────┐
│  BLOCKED │  │  Platform-       │
│  (Return │  │  Specific Export │
│  Report) │  │  Generation      │
└──────────┘  └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Output:         │
              │  CSV / Template  │
              │  / API Payload   │
              └─────────────────┘
```

### 1.2 Component Overview

| Component | Responsibility | Service |
|-----------|---------------|---------|
| Schema Registry | Stores marketplace/category/version-specific field definitions, rules, and transformations | SchemaRegistryService (Lambda) |
| Validation Engine | Evaluates product data against schema rules; produces deterministic validation reports | ValidationEngine (Lambda) |
| Export Engine | Generates platform-specific output files (CSV, templates, API payloads) | ExportEngine (Lambda) |
| Platform Adapters | Marketplace-specific logic: schema selection, field mapping, transformation, formatting | Embedded in Validation + Export Engines |
| Asset Store | Canonical storage for product images and files | S3 |

### 1.3 Design Principles

1. **No single marketplace dictates the canonical model** — The internal product model is platform-independent.
2. **Category/vertical awareness is mandatory** — Schema lookup accounts for marketplace AND category.
3. **Validation is a hard gate** — No export occurs without passing validation (no ERROR-level findings).
4. **Never silently alter data** — The pipeline does not truncate, invent, or modify data to pass export.
5. **Deterministic output** — Same input + same schema version = same output, always.
6. **All platforms are first-class** — No platform is treated as primary or future/secondary.
7. **Configuration-driven** — Adding marketplace requirements is a data change, not a code change.

---

## 2. Canonical Product Model

### 2.1 Model Structure

The MerchOS canonical product model separates data into three distinct domains:

```
┌─────────────────────────────────────────────────────┐
│                 CANONICAL PRODUCT                     │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │         CORE CONTENT DATA               │        │
│  │  • Title, descriptions, bullet points   │        │
│  │  • Brand, manufacturer                  │        │
│  │  • Identifiers (SKU, barcode/GTIN)      │        │
│  │  • Dimensions, weight, materials        │        │
│  │  • Attributes (category-specific)       │        │
│  │  • Image references (S3 keys)           │        │
│  │  • Variant structure                    │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │         COMMERCIAL / LISTING DATA       │        │
│  │  • Price (selling price)                │        │
│  │  • RRP / compare-at price              │        │
│  │  • Stock quantity                       │        │
│  │  • Leadtime / handling time             │        │
│  │  • Fulfilment method                    │        │
│  │  • Listing status                       │        │
│  │  • Sale price / promotional pricing     │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  ┌─────────────────────────────────────────┐        │
│  │         PLATFORM-SPECIFIC DATA          │        │
│  │  • Platform identifiers (ASIN, TSIN)    │        │
│  │  • Category mappings per platform       │        │
│  │  • Platform-specific metadata           │        │
│  │  • Listing/offer references             │        │
│  │  • Export history                        │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 2.2 Core Content Data

Content data represents the product's identity and physical characteristics — information that is true regardless of where the product is sold.

| Field Group | Fields | Notes |
|-------------|--------|-------|
| Identity | title, shortDescription, longDescription, bulletPoints | Platform-neutral content |
| Brand | brand, manufacturer | May map to different fields per platform |
| Identifiers | sku, barcode (EAN/UPC/GTIN/ISBN), mpn | Universal identifiers |
| Physical | weight, weightUnit, length, width, height, dimensionUnit | Standard units; adapters convert |
| Materials | materials[], composition | Category-dependent relevance |
| Attributes | Dynamic key-value pairs | Category-specific (colour, size, etc.) |
| Images | imageRefs[] (S3 keys + metadata) | Canonical storage; adapters resolve URLs |
| Variants | variants[] with option axes + per-variant overrides | Platform-independent variant model |

### 2.3 Commercial / Listing Data

Commercial data represents pricing, availability, and fulfilment information that may vary per marketplace.

| Field Group | Fields | Notes |
|-------------|--------|-------|
| Pricing | sellingPrice, rrp, salePrice, currency | Per-marketplace pricing supported |
| Inventory | stockQuantity, lowStockThreshold, backorderPolicy | Stock management |
| Fulfilment | fulfilmentMethod, leadtimeDays, handlingTimeDays | Platform-specific meaning |
| Status | listingStatus (active/draft/archived) | Per-marketplace status |
| Promotions | saleStartDate, saleEndDate | Promotional windows |

### 2.4 Platform-Specific Data

Platform-specific data is managed per-marketplace and stores identifiers and references assigned by or relevant to specific platforms.

| Field Group | Fields | Notes |
|-------------|--------|-------|
| Platform IDs | takealot.tsin, amazon.asin, shopify.productId, etc. | Platform-assigned identifiers |
| Category Maps | platformCategoryMappings[] | Maps canonical product to each platform's category system |
| Metadata | Platform-specific key-value store | Custom fields per platform |
| Export History | lastExportDate, lastExportVersion, exportStatus | Per-platform export tracking |

### 2.5 Product Lifecycle States

| State | Description | Export Allowed |
|-------|-------------|:-------------:|
| Draft | Product being created/enriched | ❌ |
| Ready | All required content data populated | ✅ (after validation) |
| Validated | Passed validation for at least one platform | ✅ |
| Exported | Successfully exported to one or more platforms | ✅ |
| Archived | No longer active | ❌ |

---

## 3. Schema Registry

### 3.1 Purpose

The Schema Registry is the single source of truth for marketplace-specific field requirements. It stores what each platform requires, allows, and rejects — organized by platform, category/vertical, and schema version.

### 3.2 Registry Hierarchy

```
Schema Registry
├── Platform: takealot
│   ├── Schema: bulk-offers (v1.0) [VERIFIED_FROM_TEMPLATE]
│   │   └── Fields: barcode, sku, soh, sellingPrice, rrp, leadtime
│   └── Schema: product-creation (v1.0) [REQUIRES_SELLER_ACCOUNT_VERIFICATION]
│       ├── Category: electronics
│       │   └── Fields: common + warranty, model_number, ...
│       └── Category: general
│           └── Fields: common fields
├── Platform: makro
│   ├── Vertical: duvet-covers (v1.0) [VERIFIED_FROM_TEMPLATE]
│   │   └── Fields: common + size, material, thread_count, ...
│   ├── Vertical: electronics (v1.0) [INFERENCE]
│   │   └── Fields: common + wattage, voltage, ...
│   └── Vertical: furniture (v1.0) [INFERENCE]
│       └── Fields: common + material, assembly, ...
├── Platform: amazon
│   ├── Product Type: (dynamic — via Product Type Definitions API)
│   │   └── Fields: retrieved per product type and marketplace
│   ├── Example: clothing (EXAMPLE_ONLY)
│   │   └── Fields: common + department, colour, size, ...
│   └── Example: electronics (EXAMPLE_ONLY)
│       └── Fields: common + screen_size, ram, storage, ...
├── Platform: shopify [VERIFIED_FROM_PUBLIC_DOCUMENTATION]
│   └── Schema: product-csv (current)
│       └── Fields: handle, title, body_html, vendor, ...
└── Platform: woocommerce [VERIFIED_FROM_PUBLIC_DOCUMENTATION]
    ├── Product Type: simple (v1.0)
    │   └── Fields: name, sku, regular_price, ...
    ├── Product Type: variable (v1.0)
    │   └── Fields: name, sku, attributes, ...
    └── Product Type: grouped (v1.0)
        └── Fields: name, sku, grouped_products, ...
```

### 3.3 Schema Entry Structure

Each schema entry in the registry contains:

```
SchemaEntry {
  // Identity
  platform: string              // takealot | makro | amazon | shopify | woocommerce
  marketplace: string           // Country/region (za, us, uk, global)
  categoryOrVertical: string    // Category identifier (or "default" if non-category-specific)
  schemaId: string              // Unique schema identifier
  schemaVersion: string         // Semantic version (e.g., "1.0.0")
  templateVersion: string       // Platform's template version (if applicable; dynamic for Amazon)

  // Metadata
  sourceDocumentation: string[] // URLs to source documentation
  dateVerified: ISO8601         // When last verified against platform
  verificationStatus: enum      // VERIFIED | VERIFIED_FROM_TEMPLATE | VERIFIED_FROM_PUBLIC_DOCUMENTATION | REQUIRES_SELLER_ACCOUNT_VERIFICATION | DRAFT | DEPRECATED
  requirementClassification: enum // OFFICIAL_REQUIREMENT | OFFICIAL_RECOMMENDATION | PLATFORM_BEHAVIOUR | MERCHOS_BEST_PRACTICE | INFERENCE | UNVERIFIED
  notes: string                 // Human-readable notes

  // Fields
  fields: FieldDefinition[]     // Array of field definitions

  // Export
  exportFormat: ExportFormat     // CSV, TSV, XLSX, JSON, API
  columnOrder: string[]         // Exact column ordering for file exports
  encoding: string              // UTF-8, etc.
  delimiter: string             // comma, tab, etc.
}
```

### 3.4 Field Definition Structure

Each field within a schema is defined as:

```
FieldDefinition {
  // Identity
  fieldId: string               // Unique field identifier within schema
  platformFieldName: string     // Exact field/column name as platform expects
  canonicalMapping: string      // Path to canonical product model field (e.g., "content.title")

  // Requirements
  required: enum                // required | conditional | optional
  conditionExpression: string   // Condition for "conditional" fields (e.g., "product.type == 'variable'")

  // Type & Validation
  dataType: enum                // string | integer | decimal | boolean | enum | url | date | html
  maxLength: integer            // Maximum character length (null if unlimited)
  minLength: integer            // Minimum character length (0 if no minimum)
  allowedValues: string[]       // Enumeration of allowed values (null if unrestricted)
  pattern: regex                // Regex pattern for format validation (null if no pattern)
  minValue: number              // Minimum numeric value (null if no minimum)
  maxValue: number              // Maximum numeric value (null if no maximum)

  // Transformation
  transformation: string        // Transformation rule to apply during mapping (null if direct map)

  // Dependencies
  dependsOn: string[]           // Other fields this field depends on
  requiredWith: string[]        // Fields that become required when this field is populated
}
```

### 3.5 Schema Versioning

The registry supports multiple concurrent versions of a schema to handle:
- Platform template updates (new fields, changed rules)
- Rollback capability (if a new template version has issues)
- Audit trail (what schema was used for a historical export)

| Version Component | Example | Purpose |
|-------------------|---------|---------|
| Schema version | 1.0.0 | MerchOS's version of the schema definition |
| Template version | (dynamic, platform-assigned) | Platform's official template version — do not hard-code |
| Marketplace | za, us, uk | Regional marketplace variant |
| Status | draft → verified → deprecated | Lifecycle tracking |
| Verification status | VERIFIED_FROM_TEMPLATE / VERIFIED_FROM_PUBLIC_DOCUMENTATION / REQUIRES_SELLER_ACCOUNT_VERIFICATION / DRAFT / DEPRECATED | Source confidence |
| Requirement classification | OFFICIAL_REQUIREMENT / OFFICIAL_RECOMMENDATION / PLATFORM_BEHAVIOUR / MERCHOS_BEST_PRACTICE / INFERENCE / UNVERIFIED | Requirement authority level |

### 3.6 Registry Operations

| Operation | Description |
|-----------|-------------|
| Lookup | Find the applicable schema for (platform, category, version) |
| Validate | Check if a product satisfies a schema's requirements |
| List | Enumerate available schemas for a platform or category |
| Create | Add a new schema entry (draft status) |
| Update | Modify an existing schema (creates new version) |
| Deprecate | Mark a schema version as deprecated (no new exports) |
| Import | Import a platform template file and convert to schema entry |

---

## 4. Validation Engine

### 4.1 Purpose

The Validation Engine is the gatekeeper for all marketplace exports. It evaluates a canonical product against a target schema and produces a deterministic validation report. Validation is a **hard gate** — products with ERROR-level findings cannot proceed to export.

### 4.2 Validation Inputs

```
ValidationRequest {
  productId: string              // Canonical product identifier
  product: CanonicalProduct      // Full canonical product data
  targetPlatform: string         // Target marketplace
  targetCategory: string         // Target category/vertical (if applicable)
  exportMode: string             // full-create | offer-update | inventory-sync | price-update
  schemaVersion: string          // Specific version (or "latest")
}
```

### 4.3 Severity Levels

| Severity | Code | Behaviour | Description |
|----------|------|-----------|-------------|
| ERROR | `E` | **Blocks export** | Critical failure — product cannot be exported until resolved |
| WARNING | `W` | Export allowed | Potential issue — user should review but export proceeds |
| INFO | `I` | Export allowed | Informational note — no action required |

### 4.4 Validation Rules

The engine evaluates the following rule categories:

| Category | Examples |
|----------|----------|
| **Presence** | Required field missing; conditional field missing when condition met |
| **Type** | String in numeric field; invalid date format; non-boolean in boolean field |
| **Length** | Title exceeds max length; description below minimum length |
| **Format** | Invalid barcode check digit; invalid URL format; invalid email format |
| **Enumeration** | Value not in allowed values list; invalid product type |
| **Range** | Price ≤ 0; negative stock; leadtime < 1 |
| **Dependency** | Sale end date without sale start date; parent SKU missing for child variant |
| **Uniqueness** | Duplicate SKU; duplicate barcode within export batch |
| **Image** | No images; image URL not accessible; below minimum resolution |
| **Platform-Specific** | Takealot: selling price > RRP; Amazon: variation theme invalid for product type |

### 4.5 Validation Report Structure

```
ValidationReport {
  // Summary
  productId: string
  targetPlatform: string
  targetCategory: string
  schemaVersion: string
  timestamp: ISO8601
  exportAllowed: boolean          // true if no ERROR-level findings

  // Counts
  errorCount: integer
  warningCount: integer
  infoCount: integer

  // Findings
  findings: ValidationFinding[]
}

ValidationFinding {
  severity: "ERROR" | "WARNING" | "INFO"
  code: string                    // Machine-readable code (e.g., "REQUIRED_FIELD_MISSING")
  field: string                   // Affected field path
  platformField: string           // Platform's field name (for user display)
  message: string                 // Human-readable description
  currentValue: any               // Current field value (null if missing)
  expectedFormat: string          // Expected format/type description
  allowedValues: string[]         // Allowed values (if enumeration error)
  suggestion: string              // Actionable fix suggestion
}
```

### 4.6 Example Validation Output

```json
{
  "productId": "prod_abc123",
  "targetPlatform": "takealot",
  "targetCategory": "general",
  "schemaVersion": "1.0.0",
  "timestamp": "2026-08-08T10:30:00Z",
  "exportAllowed": false,
  "errorCount": 2,
  "warningCount": 1,
  "infoCount": 0,
  "findings": [
    {
      "severity": "ERROR",
      "code": "REQUIRED_FIELD_MISSING",
      "field": "content.barcode",
      "platformField": "Barcode",
      "message": "Barcode is required for Takealot product export",
      "currentValue": null,
      "expectedFormat": "EAN-13 (13 digits) or UPC-A (12 digits)",
      "allowedValues": null,
      "suggestion": "Add a valid EAN-13 or UPC-A barcode to the product"
    },
    {
      "severity": "ERROR",
      "code": "VALUE_BELOW_MINIMUM",
      "field": "commercial.sellingPrice",
      "platformField": "Selling Price",
      "message": "Selling price must be greater than 0",
      "currentValue": 0,
      "expectedFormat": "Decimal > 0 (ZAR)",
      "allowedValues": null,
      "suggestion": "Set a positive selling price in South African Rand"
    },
    {
      "severity": "WARNING",
      "code": "PRICE_EXCEEDS_RRP",
      "field": "commercial.sellingPrice",
      "platformField": "Selling Price",
      "message": "Selling price (R450.00) exceeds RRP (R400.00) — Takealot may flag this",
      "currentValue": 450.00,
      "expectedFormat": "Selling Price ≤ RRP recommended",
      "allowedValues": null,
      "suggestion": "Review pricing — selling price typically should not exceed RRP"
    }
  ]
}
```

### 4.7 Validation Invariants

The Validation Engine maintains these invariants at all times:

1. **Never silently truncate data** — If a title exceeds max length, report an ERROR. Do not auto-truncate.
2. **Never invent data** — If a required field is missing, report an ERROR. Do not generate placeholder values.
3. **Never alter data to pass validation** — The engine reports findings; it does not fix them.
4. **Deterministic** — Same product + same schema = same validation report. No randomness or time-dependent rules.
5. **Complete** — All applicable rules are evaluated. The engine does not short-circuit on the first error (except where dependency failures make subsequent checks meaningless).
6. **Actionable** — Every finding includes a human-readable message and suggestion for resolution.

---

## 5. Platform Adapters

### 5.1 Adapter Responsibilities

Each platform has a dedicated adapter that encapsulates all marketplace-specific logic:

| Responsibility | Description |
|---------------|-------------|
| Schema Selection | Determine the correct schema from the registry based on product category and export mode |
| Field Mapping | Map canonical product fields to platform-specific field names |
| Data Transformation | Apply platform-specific formatting (date formats, currency, units) |
| Validation | Execute platform-specific validation rules beyond generic checks |
| Export Formatting | Generate the exact output format (CSV columns, encoding, structure) |
| Error Interpretation | Map platform rejection codes back to MerchOS validation errors |

### 5.2 Adapter Registry

| Adapter | Platform | Category Awareness | Export Modes |
|---------|----------|:------------------:|--------------|
| TakealotAdapter | Takealot | Low (some category fields) | product-create, bulk-offers |
| MakroAdapter | Makro | **HIGH** (vertical-specific) | loadsheet-create, stock-update |
| AmazonAdapter | Amazon | **HIGH** (product-type-specific) | new-product, offer-existing, inventory-update |
| ShopifyAdapter | Shopify | Low (optional category) | product-csv, product-api |
| WooCommerceAdapter | WooCommerce | Low (product-type-driven) | product-csv, product-api |

### 5.3 Adapter Interface

All adapters implement a common interface:

```
PlatformAdapter {
  // Identity
  platform: string

  // Schema Operations
  selectSchema(product, category, exportMode): SchemaEntry
  getSupportedCategories(): CategoryDefinition[]
  getSupportedExportModes(): ExportMode[]

  // Mapping & Transformation
  mapFields(product, schema): MappedFieldSet
  transformValues(mappedFields, schema): TransformedFieldSet

  // Validation
  validate(product, schema): ValidationFinding[]
  interpretRejection(platformError): ValidationFinding[]

  // Export
  generateExport(transformedFields, schema): ExportOutput
  getExportFormat(): ExportFormatDefinition
}
```

### 5.4 Adapter Isolation Rules

1. **No platform-specific rules in the canonical model** — Platform logic lives exclusively in adapters.
2. **Adapters do not modify canonical product data** — They read and transform; they never write back.
3. **Adapters are independent** — No adapter depends on or references another adapter.
4. **Adapters own their schema interpretation** — The registry stores raw definitions; adapters apply business logic.
5. **Adapters handle platform quirks** — Each platform's idiosyncrasies are contained within its adapter.

### 5.5 TakealotAdapter Notes

- Must distinguish between product-creation and bulk-offers export modes
- Bulk offers: maps only 6 fields (barcode, sku, soh, sellingPrice, rrp, leadtime)
- Product creation: category-dependent field set
- Price is always required (even though MerchOS separates content from commercial data)
- Barcode is the primary linking identifier

### 5.6 MakroAdapter Notes

- **Vertical awareness is critical** — adapter must select correct loadsheet template per vertical
- Must validate BEFORE generating loadsheet (invalid loadsheets waste QC cycles)
- Maps Makro QC rejection feedback back to validation errors for iterative correction
- Supports multiple verticals with different field sets per vertical
- Platform-generated fields (PLU, status) are excluded from export

### 5.7 AmazonAdapter Notes

- **Product-type awareness is critical** — field requirements change completely per product type
- Must support importing Seller Central flat file templates as schema definitions
- Handles variation relationships (parent/child SKU mapping)
- Processing report interpretation: maps Amazon error codes to MerchOS validation findings
- Marketplace-specific (US, UK, DE, etc.) — same product type may have different requirements per marketplace
- Feed versioning: must track template version per marketplace

### 5.8 ShopifyAdapter Notes

- Handle generation: auto-generate URL-safe handle from title if not provided
- Variant expansion: canonical variants must expand to Shopify's row-per-variant CSV format
- Metafield mapping: store-specific configuration (different stores have different metafields)
- Image position ordering: map canonical image order to Shopify's position numbering
- Option limit: enforce 3-option / 100-variant maximum

### 5.9 WooCommerceAdapter Notes

- Product type detection: determine if product is simple, variable, grouped, or external
- Attribute formatting: pipe-separated values for multi-value attributes
- Category hierarchy: format as "Parent > Child > Grandchild" string
- Variable products: generate parent row + variation rows with correct Parent reference
- Custom metadata: support configurable meta field mapping per store
- Plugin-dependent fields (SEO, barcodes): store-specific configuration

---

## 6. Export Pipeline

### 6.1 Pipeline Stages

The export pipeline executes in strict sequence:

| Stage | Input | Output | Can Block? |
|-------|-------|--------|:----------:|
| 1. Target Selection | User request (platform, category, mode) | Export context | ❌ |
| 2. Schema Lookup | Export context | Schema entry from registry | ✅ (schema not found) |
| 3. Field Mapping | Canonical product + schema | Mapped field set | ❌ |
| 4. Transformation | Mapped fields + transformation rules | Transformed fields | ❌ |
| 5. Validation | Transformed fields + validation rules | Validation report | ✅ (ERROR findings) |
| 6. Export Generation | Transformed fields + export format spec | Platform-specific file/payload | ❌ |
| 7. Delivery | Export file | S3 storage / download / API submission | ❌ |

### 6.2 Export Modes

| Mode | Description | Typical Use |
|------|-------------|-------------|
| full-create | Complete product data for new catalogue entry | First-time export to platform |
| offer-update | Price/stock/availability update for existing listing | Regular price/stock sync |
| inventory-sync | Stock quantity only | Automated inventory updates |
| price-update | Pricing fields only | Price change propagation |

### 6.3 Batch Export

The pipeline supports both single-product and batch export:

- **Single product:** Validate and export one product
- **Batch:** Validate all products, generate combined export file (multi-row CSV/template)
- **Batch validation:** All products must pass validation; batch export blocked if ANY product has errors
- **Partial batch:** User may choose to export only passing products (exclude errored ones from batch)

### 6.4 Export Output Formats

| Platform | Format | Specifics |
|----------|--------|-----------|
| Takealot | CSV / XLSX | Comma-separated (offers), XLSX (product creation) |
| Makro | CSV | Vertical-specific loadsheet; exact column order |
| Amazon | TSV | Tab-separated flat file; includes metadata header rows |
| Shopify | CSV | Comma-separated; multi-row per product (variants/images) |
| WooCommerce | CSV | Comma-separated; multi-row for variable products |

### 6.5 Export Determinism

Given:
- The same canonical product data
- The same target platform and category
- The same schema version

The pipeline MUST produce byte-identical output. This enables:
- Automated testing (snapshot comparison)
- Audit trail verification
- Cache invalidation (detect when re-export is needed)
- Confidence in export correctness

---

## 7. Image Architecture

### 7.1 Canonical Image Storage

Product images are stored in **S3** as the canonical asset store. The canonical product model references images by S3 key, not by marketplace-specific URLs.

```
S3 Bucket: merchos-assets-{env}
├── tenants/
│   └── {tenantId}/
│       └── products/
│           └── {productId}/
│               ├── images/
│               │   ├── {imageId}-original.{ext}
│               │   ├── {imageId}-1000x1000.{ext}
│               │   └── {imageId}-500x500.{ext}
│               └── documents/
│                   └── ...
```

### 7.2 Image Reference in Canonical Model

```
ImageReference {
  imageId: string           // Unique image identifier
  s3Key: string             // S3 object key
  position: integer         // Display order (1-based; 1 = primary)
  altText: string           // Accessibility text
  mimeType: string          // image/jpeg, image/png, etc.
  width: integer            // Pixel width
  height: integer           // Pixel height
  fileSize: integer         // Bytes
  variantId: string         // Variant association (null = product-level)
}
```

### 7.3 Platform Image Resolution

Each adapter resolves image references to platform-required format:

| Platform | Image Format | URL Requirement |
|----------|--------------|-----------------|
| Takealot | Publicly accessible HTTPS URL | Must resolve at submission time |
| Makro | Publicly accessible HTTPS URL | Must resolve at submission time |
| Amazon | Publicly accessible HTTPS URL | Must resolve; meets size/format requirements |
| Shopify | Publicly accessible URL | Any accessible URL (HTTPS recommended) |
| WooCommerce | Publicly accessible URL | Any accessible URL |

**Resolution strategy:** The adapter generates a signed S3 URL or CloudFront CDN URL from the canonical S3 key, providing a publicly accessible URL for the export.

### 7.4 Image Validation Rules

| Rule | Severity | Platforms |
|------|----------|-----------|
| At least 1 image present | ERROR | Takealot, Makro, Amazon |
| Image URL accessible | ERROR | All |
| Minimum resolution met | WARNING/ERROR | Amazon (1000×1000), others vary |
| Main image white background | WARNING | Amazon |
| Image format supported | ERROR | Per platform requirements |
| Image count within limit | WARNING | Per platform maximum |
| Variant image present (if applicable) | INFO | Shopify, WooCommerce |

---

## 8. Commercial Data Architecture

### 8.1 Price in the Canonical Model

> **IMPORTANT:** Price is NOT removed from MerchOS. Commercial data (pricing, inventory, fulfilment) is maintained as a first-class part of the canonical product model.

The separation between "content data" and "commercial data" is an **organizational boundary**, not an exclusion. Commercial data is:
- Stored in the canonical product model alongside content data
- Validated as part of marketplace export validation
- Included in export files as required by each platform

### 8.2 Commercial Data Domains

| Domain | Fields | Notes |
|--------|--------|-------|
| **Pricing** | sellingPrice, rrp, salePrice, currency | May vary per marketplace |
| **Inventory** | stockQuantity, lowStockThreshold | May sync across platforms |
| **Fulfilment** | fulfilmentMethod, leadtimeDays | Platform-specific meaning |
| **Availability** | listingStatus, publishDate | Per-platform status |

### 8.3 Per-Marketplace Commercial Overrides

Products may have different commercial data per marketplace:
- Different pricing (currency, price point) per platform
- Different stock allocation per platform
- Different fulfilment methods per platform (e.g., FBA for Amazon, self-fulfilment for others)

The canonical model supports per-marketplace commercial overrides while maintaining a default/base commercial dataset.

### 8.4 Platform-Specific Commercial Requirements

| Platform | Commercial Requirement | Notes |
|----------|----------------------|-------|
| Takealot | Price REQUIRED at submission | Both Bulk Offers and product creation require price |
| Makro | Price REQUIRED at submission | Loadsheet includes pricing |
| Amazon | Price REQUIRED for offer | Listing requires price; can separate from catalogue item |
| Shopify | Variant Price REQUIRED | Price is per-variant |
| WooCommerce | Regular Price REQUIRED (simple/variation) | Required for purchasable products |

---

## 9. Error & Rejection Handling

### 9.1 Pre-Export Validation Errors

Handled by the Validation Engine before export generation. See [Section 4](#4-validation-engine).

### 9.2 Platform Rejection Handling

After export submission, platforms may reject products. Each adapter interprets platform-specific rejections:

```
Platform Rejection → Adapter.interpretRejection() → MerchOS ValidationFinding[]
```

This maps platform error codes back to actionable validation findings, enabling users to:
1. See what the platform rejected
2. Understand what field/value caused the rejection
3. Receive a suggestion for fixing the issue
4. Fix and re-validate before re-export

### 9.3 Rejection Feedback Loop

```
Export → Platform Rejection → Adapter interprets rejection
    → Schema Registry updated (if new rule discovered)
    → Validation rules strengthened
    → Future exports catch the issue pre-submission
```

This feedback loop continuously improves validation accuracy by incorporating real-world platform behaviour.

---

## 10. Extensibility

### 10.1 Adding a New Marketplace

To add support for a new marketplace platform:

1. **Schema Registry:** Add schema entries for the new platform (fields, rules, allowed values)
2. **Adapter:** Create a new adapter implementing the PlatformAdapter interface
3. **Export Format:** Define the export format specification (CSV structure, encoding, etc.)
4. **Validation Rules:** Add platform-specific validation rules to the schema entries
5. **Documentation:** Add platform section to the Marketplace Knowledge Base

No changes to the canonical product model, validation engine core, or export pipeline infrastructure are required.

### 10.2 Adding a New Category/Vertical

To support a new category on an existing platform:

1. **Schema Registry:** Add a new schema entry for the platform + category combination
2. **Adapter:** No code changes (adapter uses registry for schema selection)
3. **Validation:** Rules automatically applied from the new schema entry

### 10.3 Handling Platform Template Updates

When a marketplace updates their template:

1. **Identify changes:** Compare new template against current schema entry
2. **Create new version:** Add new schema version to registry (do not modify existing version)
3. **Verify:** Run validation against known-good products to confirm no regressions
4. **Activate:** Set new version as active; deprecate old version
5. **Update documentation:** Record verification date and status in Knowledge Base

### 10.4 Store-Specific Configuration

For platforms where each connected store may have different configurations (Shopify metafields, WooCommerce plugins):

- Store-specific schema extensions stored as **adapter configuration** per connected store
- Base platform schema + store-specific overrides = effective schema for that store
- Adapter configuration is tenant-level data (each MerchOS tenant connects their own stores)

---

> **Cross-References:**
> - [ADR-003: Canonical Product Model with Marketplace Adapters](./adr/ADR-003-canonical-product-model-marketplace-adapters.md)
> - [Marketplace Knowledge Base](./marketplace-knowledge-base.md)
> - [Blueprint Section 11: Canonical Product Model](./merchos-blueprint.md#11-canonical-product-model)
> - [Blueprint Section 12: Marketplace Export Architecture](./merchos-blueprint.md#12-marketplace-export-architecture)
