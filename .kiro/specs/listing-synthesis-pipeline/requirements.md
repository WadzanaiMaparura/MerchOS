# Listing Synthesis Pipeline — Requirements

> **Status:** Draft — awaiting approval
> **Spec type:** Feature (requirements-first)
> **Goal:** Connect the seller Create Listings flow end-to-end: upload media → AI synthesis → per-field review loop → downloadable, marketplace-ready content file. Multi-platform from day one (Takealot, Shopify, Amazon, Makro, WooCommerce), country-scoped and extensible (eBay/Etsy and country variants added later with zero engine changes). SA-first launch; international-ready architecture (ADR-006).
>
> **Scope principle — precision over breadth.** Each marketplace (and each country variant) is driven by a complete, verified field specification. That specification is literally what builds the output file, so it must be exact — no guessed or partial field mappings are ever shipped. A marketplace/country variant is only enabled (selectable in the UI) once its specification is complete and verified; until then it is **registered but greyed out**. The pipeline framework is fully multi-platform now; individual platform specifications are populated over time.
>
> **Output at launch:** the seller downloads a marketplace-ready file for manual submission to each marketplace. Direct API integration with marketplaces is explicitly future work.

## Introduction

MerchOS has the pieces of an AI listing pipeline but they are not connected into a working product:

- The **Product Intelligence Engine** (`services/product-intelligence/`, Bedrock-backed title/description/bullets/SEO/category/brand/attributes/keywords/compliance generation) is fully built but its CDK stack (`infrastructure/lib/product-intelligence-stack.ts`) is **never instantiated** — so it is not deployed and the seller dashboard has no client for it.
- The **canonical product model** (`CanonicalProduct` in `packages/types/src/marketplace.ts`) and basic **product CRUD** API are built and deployed, but the synthesis engine persists its output to a separate table keyed by `resultId` — nothing maps generated content back onto a product.
- The **media intake** path (presigned S3 upload + async image pipeline, `ImageIntelligenceStack`) is built and deployed and can be reused.
- The **review loop** (approve/override/regenerate per field, lifecycle transitions) is called by the frontend (`useApproveAttribute`, `useOverrideAttribute`, `useTransitionLifecycle`) but **has no backend**.
- The **Takealot Product CSV generator** does not exist — only the type scaffolding (`MarketplaceSchema`, `FieldDefinition`, `ValidationResult`) is present in `packages/types/src/marketplace.ts`.

This spec defines the work to connect these into one pipeline: deploy the synthesis engine, build the glue that writes synthesis output onto the canonical product and drives the review loop, and build a **multi-platform export framework** — a Schema Registry and pluggable per-marketplace adapters — that generates a verified, marketplace-ready content file per target platform and country, with validation. It reconciles the two divergent lifecycle state machines and adds the missing `GENERATING` state the UI already references.

The export framework is platform-agnostic: adding a marketplace (or a country variant of one) is "register a complete schema + an adapter," never an engine change. At launch the framework is wired for five platforms — Takealot, Shopify, Amazon, Makro, WooCommerce — each keyed by country (SA first). Each platform/country variant becomes selectable only when its full field specification is complete and verified; others are registered but greyed out. eBay and Etsy are deliberately out of launch but must be addable later the same way.

Pricing, stock, and lead time remain the seller's responsibility (set on the marketplace) — MerchOS produces only the **content file** (e.g. Takealot content loadsheet, Shopify product CSV, Amazon category flat file), never an offers/pricing file. Video is URL passthrough only. No Inventory or Channels scope here.

## Glossary

- **Pipeline**: The end-to-end flow Create → Synthesis → Review → CSV for one Batch of products.
- **Batch**: A seller-named group of one or more products created together in the Create Listings flow (e.g. "November trampolines").
- **Synthesis_Engine**: The existing, already-built Product Intelligence Engine (`services/product-intelligence/`) that invokes Bedrock to generate listing content. This spec deploys and integrates it; it does not re-implement it.
- **Generation_Result**: The Synthesis_Engine's output object (`resultId`, `type`, `content`, `confidenceScore`, `metadata`), persisted in the product-intelligence table.
- **CanonicalProduct**: The authoritative product domain model (`packages/types/src/marketplace.ts`); listing content lives under `content`, images under `content.imageRefs`.
- **Enrichment_Layer**: The `Product` DTO's `enrichmentLayer` (per-attribute value + confidence + source + `flaggedForReview` + approver), which the review UI drives. Currently types-only; this spec populates it.
- **Synthesis_Glue**: The new backend component that maps a Generation_Result onto a CanonicalProduct / its Enrichment_Layer so generated content becomes part of the product.
- **Review_Loop**: The per-field approve / edit (override) / regenerate workflow a seller performs before a product is eligible for CSV generation.
- **Lifecycle_State**: The product pipeline state. This spec uses the UI/DTO `LifecycleState` enum (`packages/types/src/common.ts`) as the single external contract and reconciles it with the canonical model's simplified subset.
- **Marketplace_Target**: A target sales channel + country, modelled per ADR-006 as `{id, platform, name, country, locale, currency, enabled}`. Launch platforms: Takealot, Shopify, Amazon, Makro, WooCommerce. `id` is `platform-country` (e.g. `takealot-za`, `amazon-za`, `amazon-uk`, `shopify-za`). `enabled` is false (greyed out) until the variant's spec is complete and verified.
- **Marketplace_Spec**: The complete, verified field specification for one Marketplace_Target (and category where the platform is category-specific). It defines every column/field, its canonical mapping, requirement classification, constraints, output format, column order, delimiter, and encoding. The Marketplace_Spec is the authoritative source that builds the output file — it must be exact; no partial or guessed spec is shipped.
- **Schema_Registry**: The component that stores Marketplace_Specs keyed by platform + country + category and exposes lookup + the list of enabled targets. Versioned.
- **Validation_Engine**: The platform-agnostic component that checks a product's content against a Marketplace_Spec and produces a `ValidationResult` with `exportAllowed`.
- **Marketplace_Adapter**: A pluggable per-platform component that maps a CanonicalProduct into that platform's output columns/fields in the Marketplace_Spec's order and format. One adapter per platform (country/category handled via the spec), registered in an adapter registry.
- **Content_File**: The marketplace-ready output file MerchOS generates and the seller downloads for manual submission (Takealot content loadsheet, Shopify product CSV, Amazon category flat file, etc.). Content only — never pricing/stock/leadtime.
- **Export_Job**: A unit of file-generation work for one or more products in a Batch, producing one Content_File per target Marketplace_Target.

## Requirements

### Requirement 1: Deploy the Synthesis Engine

**User Story:** As a platform operator, I want the already-built Product Intelligence Engine deployed, so that the seller dashboard can request AI listing content.

#### Acceptance Criteria

1. THE infrastructure CDK app SHALL instantiate the `ProductIntelligenceStack` in `infrastructure/bin/merch-os.ts` with its environment, Foundation (KMS, EventBridge), and Auth (Cognito) deploy-time dependencies declared.
2. WHEN the stack is deployed, THE Synthesis_Engine SHALL expose its `/intelligence/*` routes behind the Cognito JWT authorizer scoped to the seller user pool.
3. THE deployed Synthesis_Engine SHALL enforce tenant isolation and the existing token budget check on every generation request.
4. THE deployment SHALL export the Synthesis_Engine API base URL via SSM so the seller dashboard build can consume it.
5. IF the stack's required SSM parameters (KMS key, event bus, Cognito pool/client) are absent at deploy time, THEN the deployment SHALL fail fast with a clear error rather than deploy a non-functional stack.

### Requirement 2: Seller API Client for Synthesis

**User Story:** As a seller, I want the Create Listings flow to call the synthesis engine, so that my uploaded products get AI-generated content.

#### Acceptance Criteria

1. THE api-client package SHALL provide a hook (e.g. `useGenerateContent`) that calls `POST /intelligence/generate` with product data, target marketplace, and generation type.
2. WHEN a generation request is in flight, THE hook SHALL expose loading state, and on success return the Generation_Result including its Confidence_Score.
3. IF the engine returns a budget-exceeded (402) response, THEN THE hook SHALL surface a distinct, user-readable "generation limit reached" error, not a generic failure.
4. THE hook SHALL send the seller's Cognito JWT and SHALL only ever operate within the seller's own tenant.

### Requirement 3: Create Listings → Product Creation

**User Story:** As a seller, I want to create a batch of products from uploaded media, so that I can then generate and review their listings.

#### Acceptance Criteria

1. WHEN a seller completes the Create Listings flow (selects marketplaces, uploads media, names the Batch, submits), THE Pipeline SHALL create one CanonicalProduct per product in the Batch, tenant-scoped, in the `DRAFT` Lifecycle_State.
2. THE Pipeline SHALL reuse the existing presigned-S3 media intake for product images and SHALL store a provided video as a URL reference only (no hosting/transcoding).
3. THE Pipeline SHALL record the seller-provided Batch name and the selected target Marketplace_Targets on each product in the Batch.
4. WHERE the seller selects multiple Marketplace_Targets, THE Pipeline SHALL target all selected targets for that Batch.
5. THE Pipeline SHALL advise the seller, in the video field, that only the URL is used and MerchOS does not process the video.
6. THE Create Listings marketplace selector SHALL list all registered Marketplace_Targets but SHALL render targets with `enabled = false` as visibly disabled (greyed out, not selectable) with an indication that they are coming soon.
7. THE Pipeline SHALL reject selection or submission of a Marketplace_Target whose `enabled` is false.

### Requirement 4: Synthesis Glue onto the Canonical Product

**User Story:** As a seller, I want AI-generated content to attach to my product, so that I can review it as part of the product rather than as a detached result.

#### Acceptance Criteria

1. WHEN synthesis completes for a product, THE Synthesis_Glue SHALL write the generated title, description, bullet points, and extracted attributes onto the product's content and Enrichment_Layer.
2. THE Synthesis_Glue SHALL record, per enriched field, the Confidence_Score and a source of `ai`, and SHALL set `flaggedForReview` true for any field whose Confidence_Score is below a configurable review threshold.
3. WHEN synthesis for a product begins, THE Pipeline SHALL transition the product to the `GENERATING` Lifecycle_State; WHEN synthesis completes, THE Pipeline SHALL transition it to `REVIEW`.
4. THE system SHALL add `GENERATING` to the `LifecycleState` enum and define its allowed transitions (`DRAFT → GENERATING → REVIEW`, and `GENERATING → DRAFT` on failure).
5. IF synthesis fails for a product after retries, THEN THE Pipeline SHALL return the product to `DRAFT`, record the failure reason, and surface it to the seller without losing any prior product data.

### Requirement 5: Lifecycle Reconciliation

**User Story:** As a developer, I want one coherent lifecycle contract, so that the UI, API, and canonical model agree on product state.

#### Acceptance Criteria

1. THE system SHALL treat the DTO `LifecycleState` enum as the single external (API/UI) contract for product state.
2. THE system SHALL define a deterministic, documented mapping between the DTO `LifecycleState` and the canonical model's simplified subset (`draft|ready|validated|exported|archived`) and SHALL apply it in code at the service boundary (not only in prose).
3. THE system SHALL reject any lifecycle transition that is not in the allowed-transition set and SHALL return a clear error identifying the invalid transition.
4. THE system SHALL record every lifecycle transition (from, to, timestamp, actor) in the product's lifecycle history.

### Requirement 6: Review Loop Backend

**User Story:** As a seller, I want to approve, edit, or regenerate each generated field, so that I control listing quality before export.

#### Acceptance Criteria

1. THE API SHALL provide a handler to approve an enriched attribute (`POST /products/{id}/attributes/{name}/approve`) that clears `flaggedForReview` and records the approver and timestamp.
2. THE API SHALL provide a handler to override an enriched attribute (`POST /products/{id}/attributes/{name}/override`) that sets the seller-provided value, marks the source as `manual`, and clears `flaggedForReview`.
3. THE API SHALL provide a handler to regenerate a single field, re-invoking the Synthesis_Engine for that field only and updating the Enrichment_Layer with the new Generation_Result.
4. THE API SHALL provide a handler to transition a product's Lifecycle_State (`POST /products/{id}/lifecycle/transition`) honouring the allowed-transition rules in Requirement 5.
5. THE API SHALL resolve the method/path mismatch for attribute updates so the frontend `useUpdateProduct` contract is served by a deployed handler.
6. THE API SHALL block transition to `EXPORT_READY` for any product that still has fields `flaggedForReview` or that fails marketplace validation (Requirement 8).
7. EVERY review-loop handler SHALL enforce tenant isolation and RBAC, and SHALL record an audit event.

### Requirement 7: Multi-Platform Schema Registry

**User Story:** As a platform operator, I want a registry of complete, verified marketplace specifications keyed by platform, country, and category, so that any supported marketplace can validate and build its own content file without engine changes.

#### Acceptance Criteria

1. THE Schema_Registry SHALL store Marketplace_Specs keyed by `platform + country + category` (category where the platform is category-specific; otherwise a single platform-wide spec), each defining every field/column, canonical mapping, requirement classification, data type, constraints, output format, column order, delimiter, and encoding.
2. THE Schema_Registry SHALL register all five launch platforms (Takealot, Shopify, Amazon, Makro, WooCommerce) and SHALL mark each Marketplace_Target `enabled` only when its Marketplace_Spec is complete and verified; incomplete targets SHALL be registered but `enabled = false`.
3. THE Schema_Registry SHALL be versioned so a spec revision can be adopted without breaking in-flight products.
4. THE Schema_Registry SHALL support country variants of the same platform as distinct targets (e.g. `amazon-za`, `amazon-uk`, `amazon-us`, `amazon-ca`, `amazon-au`) without duplicating adapter logic.
5. THE Schema_Registry SHALL accept new platforms (e.g. eBay, Etsy) purely by adding a spec and an adapter registration, with no change to the Validation_Engine, Export_Job, or API.
6. WHERE a product's category has no registered spec for the target, THE Pipeline SHALL surface a clear "unsupported category" state rather than produce an invalid file.
7. NO Marketplace_Spec SHALL contain guessed or partial field mappings; a target SHALL remain `enabled = false` until its spec is verified against the marketplace's authoritative documentation.

### Requirement 7a: Takealot Specification (launch, SA)

**User Story:** As a seller selling on Takealot, I want an exact Takealot content loadsheet, so that my upload is accepted.

#### Acceptance Criteria

1. THE Schema_Registry SHALL encode the verified Takealot (`takealot-za`) content-loadsheet structure per category (e.g. loadsheet-104 named ranges: title, subtitle, description, brand, colour, attributes, up to 20 image URLs, 1 video URL, dimensions/weight/warranty, category-specific attributes).
2. THE `takealot-za` target SHALL be `enabled` at launch.

### Requirement 7b: Additional Platform Specifications (framework now, specs over time)

**User Story:** As a platform operator, I want Shopify, Amazon, Makro, and WooCommerce represented in the framework, so that each can be completed and enabled precisely without re-engineering.

#### Acceptance Criteria

1. THE Schema_Registry SHALL include registered (initially `enabled = false`) entries for Shopify (`shopify-za`), Amazon (`amazon-za` first, then `amazon-uk`/`amazon-us`/`amazon-ca`/`amazon-au` as future country variants), Makro (`makro-za`), and WooCommerce (`woocommerce-za`).
2. EACH additional platform SHALL have a registered Marketplace_Adapter and SHALL be enabled only once its Marketplace_Spec is complete and verified (Requirement 7.2, 7.7).
3. WHERE a platform uses a different output format than CSV (e.g. Amazon's category flat file is tab-delimited; Shopify/WooCommerce have their own product CSV layouts), THE Marketplace_Spec SHALL capture that format, delimiter, and encoding, and the Export_Job SHALL honour it.
4. eBay and Etsy SHALL NOT be launch targets but SHALL be addable later under Requirement 7.5 with no engine change.

### Requirement 8: Validation Before Export

**User Story:** As a seller, I want my listing validated against the target marketplace's rules before I download the file, so that my upload is not rejected.

#### Acceptance Criteria

1. WHEN a seller requests export for a product against a Marketplace_Target, THE Validation_Engine SHALL evaluate the product against that target's Marketplace_Spec and produce a `ValidationResult` with per-field findings and an `exportAllowed` flag.
2. IF any required field is missing or any finding has severity `ERROR`, THEN THE Validation_Engine SHALL set `exportAllowed` false and THE Pipeline SHALL NOT generate the file for that product.
3. THE Validation_Engine SHALL return findings with enough detail (field, expected format, suggestion) for the seller to fix the issue in the Review_Loop.
4. THE Validation_Engine SHALL treat warnings as non-blocking but SHALL surface them to the seller.
5. THE Validation_Engine SHALL be platform-agnostic — it SHALL derive all rules from the Marketplace_Spec and contain no platform-specific branching.
6. THE Pipeline SHALL reject an export request for a Marketplace_Target whose `enabled` is false.

### Requirement 9: Content File Generation (per platform)

**User Story:** As a seller, I want to download a marketplace-ready content file for my batch per target marketplace, so that I can upload it to each marketplace to create my listings.

#### Acceptance Criteria

1. WHEN a seller requests export (`POST /exports` with product IDs and one or more enabled Marketplace_Target ids), THE matching Marketplace_Adapter SHALL map each validated product's CanonicalProduct content into that target's columns/fields in the Marketplace_Spec's order and format.
2. THE Export_Job SHALL produce a content file only; it SHALL NOT include pricing, stock, or lead-time columns (those are the seller's responsibility on the marketplace).
3. THE Export_Job SHALL place a provided video URL into the spec's video field (where the spec has one) and image URLs into the spec's image fields up to the spec's maximum.
4. WHEN generation succeeds, THE API SHALL return an `ExportSummary` with a short-lived presigned `downloadUrl` per file, and the product SHALL transition to `EXPORT_READY` (then `PUBLISHED` is a seller action outside MerchOS).
5. THE Export_Job SHALL produce one content file per target Marketplace_Target, so a batch targeting multiple marketplaces/countries yields one file per target.
6. THE generated file SHALL use the output format, encoding, and delimiter defined by the Marketplace_Spec and SHALL be openable by that marketplace's bulk import without transformation.

### Requirement 10: Exports Surface

**User Story:** As a seller, I want my generated CSVs listed and downloadable, so that I can retrieve them when I'm ready to upload.

#### Acceptance Criteria

1. THE Exports page SHALL list completed Export_Jobs for the tenant with Batch name, target marketplace, product count, and a download action.
2. WHEN a download is requested, THE API SHALL issue a fresh short-lived presigned URL rather than storing a long-lived public link.
3. WHERE no exports exist, THE Exports page SHALL show its empty state (no fabricated rows), consistent with the launch "structure, no fake data" standard.
4. THE Exports surface SHALL enforce tenant isolation; a seller SHALL only see and download their own tenant's exports.

### Requirement 11: Tenant Isolation, Security, and Observability

**User Story:** As a platform operator, I want the pipeline to be secure and observable, so that it is safe to run in production.

#### Acceptance Criteria

1. EVERY new handler SHALL require a valid Cognito JWT, enforce tenant isolation via `TENANT#{tenantId}` key scoping, and apply the existing RBAC middleware.
2. THE pipeline SHALL emit EventBridge events for key transitions (synthesis started/completed/failed, export generated) on the platform event bus.
3. THE pipeline SHALL record audit events for review-loop actions and exports.
4. THE pipeline SHALL use AWS Powertools (logger, tracer, metrics) consistently with existing services, with tenant and correlation IDs in structured logs.
5. THE pipeline SHALL NOT expose another tenant's products, results, or exports under any request.

### Requirement 12: Post-Submission Rejection Loop (Phase 4)

**User Story:** As a seller, when a marketplace rejects some of my products after I upload the content file, I want to feed those rejections back into MerchOS so it corrects them and regenerates a file, repeating until the marketplace accepts — and I want MerchOS to get better at avoiding those rejections over time.

> **Context:** At launch, submission to the marketplace is manual (file download, Requirement/Out-of-scope). Marketplaces (Takealot first) may reject individual products after upload with per-product reasons (e.g. missing required attribute, disallowed value, image spec failure). This requirement closes the loop: capture those rejections, correct the affected products, regenerate, and resubmit — and capture the rejections as a learning signal.

#### Acceptance Criteria

1. THE system SHALL let a seller record a marketplace rejection against a specific Export_Job / product, capturing the rejection reason(s) per product (free-text and, where the marketplace provides them, structured reason codes/fields). Intake SHALL support both manual entry and upload of the marketplace's rejection report where one exists.
2. WHEN a rejection is recorded for a product, THE Pipeline SHALL move that product to a `REJECTED` state (a new Lifecycle_State) and surface the reasons to the seller against the specific fields where determinable.
3. THE Pipeline SHALL let the seller correct a rejected product via the existing Review_Loop (approve/override/regenerate per field), including targeted regeneration informed by the rejection reason (e.g. regenerate the field the marketplace flagged), then return the product to `REVIEW` → `EXPORT_READY`.
4. WHEN corrected, THE Pipeline SHALL regenerate the content file for the resubmission batch so the seller can re-upload, and SHALL track the resubmission as a new attempt linked to the prior rejection (an attempt history per product per marketplace).
5. THE loop SHALL repeat (reject → correct → regenerate → resubmit) until the seller records acceptance, at which point the product reaches `PUBLISHED`.
6. THE system SHALL persist every rejection (reason, field, marketplace, category, the offending value, and the correction the seller/engine applied) as a tenant-scoped, privacy-respecting **learning signal** that can be used to improve future synthesis (e.g. prompt refinement, marketplace-rule tightening, validation rules). Use of this signal to adjust the model/rules is itself future work; this requirement only mandates capturing it in a structured, reusable form.
7. WHERE rejection reasons map to a Marketplace_Spec field constraint that MerchOS could have caught pre-export, THE system SHALL flag the gap so the Validation_Engine / Marketplace_Spec can be tightened (feeding Requirement 7/8 precision).
8. EVERY rejection-loop operation SHALL enforce tenant isolation, RBAC, and audit logging, consistent with Requirement 11.

## Out of Scope

- Offers/pricing files, pricing, stock, and lead-time handling (seller sets these on the marketplace).
- Direct API integration with any marketplace — launch is file download for manual submission; marketplace API push is future work.
- Video hosting, transcoding, or AI video generation (URL passthrough only).
- Inventory and Channels dashboard scope.
- Completing every platform's Marketplace_Spec at launch — the multi-platform framework and all five platform adapters are built now, Takealot (`takealot-za`) is complete and enabled, and the remaining platforms/country variants are registered but greyed out until their verified specs are provided. eBay/Etsy are future platforms.
- UI internationalisation, multi-currency, and tax handling (deferred per ADR-006).
- Re-implementing the Product Intelligence Engine itself (already built under the `product-intelligence-engine` spec; this spec deploys and integrates it).
- Automatically retraining or fine-tuning the AI model from rejection signals (Requirement 12.6). The rejection loop CAPTURES the learning signal in a structured, reusable form now; applying it to improve synthesis (prompt refinement, rule tightening, fine-tuning) is future work.
- Direct marketplace API submission of corrected files in the rejection loop — resubmission is manual (file download/re-upload), same as initial submission.
