# Listing Synthesis Pipeline — Design

> **Status:** Draft — awaiting approval
> **Requirements:** `./requirements.md` (approved)

## 1. Overview

This design connects existing, mostly-built pieces into one working pipeline rather than inventing new architecture. It is organised in the three phases from the requirements, each independently deployable:

- **Phase 1 — Deploy synthesis:** instantiate the dormant `ProductIntelligenceStack`; add a seller api-client hook.
- **Phase 2 — Glue + review loop:** map synthesis output onto the canonical product; build approve/override/regenerate/transition handlers; reconcile lifecycle enums and add `GENERATING`.
- **Phase 3 — Multi-platform export:** a Schema Registry (targets + specs keyed by platform+country+category), a platform-agnostic Validation Engine, an adapter registry (one adapter per platform), and the `/exports` handler producing one marketplace-ready file per enabled target. Takealot (`takealot-za`) is fully populated and enabled; Shopify/Amazon/Makro/WooCommerce (and Amazon country variants) are registered but greyed out until their verified specs land.

The guiding principle: **the canonical product is the hub.** Synthesis results, review decisions, validation, and CSV generation all read from or write to `CanonicalProduct` in the products table. The synthesis engine stays as-is (its own table of `GenerationResult`s); new glue copies the relevant content onto the product.

### Architecture (end to end)

```
Seller (Create Listings)
  │ 1. select marketplaces, upload media (presigned S3), name Batch, submit
  ▼
ProductApi: POST /products ──────────────► products table (CanonicalProduct, DRAFT)
  │ 2. per product: request synthesis
  ▼
ProductIntelligenceApi: POST /intelligence/generate  (Phase 1 — deployed)
  │  Bedrock → GenerationResult (own table)
  ▼
Synthesis Glue (Phase 2)
  │ 3. write title/description/bullets/attributes + confidence onto product
  │    DRAFT → GENERATING → REVIEW
  ▼
Review Loop (Phase 2)  ── approve / override / regenerate per field ──► product.enrichmentLayer
  │ 4. all flags cleared → request export
  ▼
Validation Engine (Phase 3) ── product vs target's Marketplace_Spec ──► ValidationResult
  │  exportAllowed?  (per enabled target)
  ▼
Adapter registry + file writer (Phase 3)
  │ 5. CanonicalProduct → target columns (spec-driven) → file(s) in S3
  │    (one file per target: takealot-za CSV, shopify-za CSV, amazon-za TSV, ...)
  ▼
Exports: presigned downloadUrl per target   (product → EXPORT_READY)
```

## 2. Phase 1 — Deploy the Synthesis Engine

### 2.1 CDK wiring (`infrastructure/bin/merch-os.ts`)

Instantiate `ProductIntelligenceStack` alongside the existing seven stacks. It imports Foundation (KMS, EventBridge bus name/arn) and Auth (Cognito tenant pool id, seller client id) via SSM at deploy time, so declare explicit deploy dependencies (same pattern as `SupplierIntelligenceStack`):

```ts
import { ProductIntelligenceStack } from '../lib/product-intelligence-stack';

const productIntelligenceStack = new ProductIntelligenceStack(
  app, `MerchOS-ProductIntelligence-${env}`, { env: cdkEnv, environment: env });
productIntelligenceStack.addDependency(foundationStack);
productIntelligenceStack.addDependency(authStack);
```

No change to the stack internals is required — it already defines the table, 5 Lambdas, Bedrock IAM, JWT authorizer, and `/intelligence/*` routes.

**One fix needed:** the stack's CORS `allowOrigins` is hard-coded to `https://{env}.merchos.io`. The seller app is served from `merchos.co.za` (apex) in production and localhost in dev. Update `allowOrigins` to the real seller origins (production apex + dev) so browser calls are not blocked. (Requirement 1.2, 2.4)

### 2.2 API base URL export (Requirement 1.4)

The stack already prepares SSM exports. Ensure the HTTP API URL is exported at `/merch-os/{env}/product-intelligence/api-url`, and surface it to the seller Amplify build as `NEXT_PUBLIC_INTELLIGENCE_API_URL` (set in the Amplify env, mirroring how `NEXT_PUBLIC_API_URL` is provided).

### 2.3 Fail-fast on missing SSM (Requirement 1.5)

`StringParameter.valueForStringParameter` already fails the deployment if a parameter is absent (CloudFormation resolves it at deploy time). Document the required parameters in the stack header; no extra code needed beyond the explicit `addDependency` calls that guarantee ordering.

### 2.4 Seller api-client hook (Requirement 2)

Add `packages/api-client/src/hooks/useGenerateContent.ts`:

- `useGenerateContent()` → `useMutation` calling `POST /intelligence/generate` on a **second** axios client pointed at `NEXT_PUBLIC_INTELLIGENCE_API_URL` (the intelligence API is a separate HTTP API from the product API).
- Request body: `{ type: GenerationType, productData: ProductData, marketplace?: MarketplaceId, options? }`.
- Returns `GenerationResult` (includes `confidenceScore`).
- **402 handling:** map the engine's `BUDGET_EXCEEDED` response to a typed `ApiError` with a `code` the UI can switch on to show "generation limit reached" (Requirement 2.3).
- Reuses the existing `ApiClientProvider` auth-session token getter so the Cognito JWT is attached (Requirement 2.4).

Because the intelligence API has a different base URL, extend `ApiClientProvider` to expose a second configured client (or a factory), rather than hard-coding one base URL. Keep the existing product client unchanged.

## 3. Phase 2 — Synthesis Glue, Lifecycle, Review Loop

### 3.1 Lifecycle reconciliation (Requirement 5)

Two enums exist today:
- DTO/UI `LifecycleState` (`packages/types/src/common.ts`): `DRAFT | INGESTED | ENRICHED | REVIEW | VALIDATED | EXPORT_READY | PUBLISHED | ARCHIVED`.
- Canonical `CanonicalProduct.lifecycleState` (`marketplace.ts`): `draft | ready | validated | exported | archived`.

**Decisions:**
1. Add `GENERATING` to the DTO `LifecycleState` enum (between `DRAFT` and `REVIEW`).
2. The DTO enum is the single external contract. Create a mapping module `services/product/service/lifecycle.ts`:
   - `toCanonical(state: LifecycleState): CanonicalLifecycle` and `toDto(canonical, context?)`.
   - Mapping: `DRAFT→draft`, `GENERATING→draft`, `INGESTED→draft`, `ENRICHED→ready`, `REVIEW→ready`, `VALIDATED→validated`, `EXPORT_READY→validated`, `PUBLISHED→exported`, `ARCHIVED→archived`.
   - Because the canonical subset is lossy (several DTO states map to `draft`/`ready`), persist the **precise DTO state** as a new field `uiLifecycleState` on the stored item while keeping `lifecycleState` (canonical) for export-pipeline logic. The DTO assembly returns `uiLifecycleState`. This avoids ambiguous round-trips.
3. Allowed-transition table (enforced in the service, Requirement 5.3):

```
DRAFT      → GENERATING, ARCHIVED
GENERATING → REVIEW, DRAFT          (DRAFT on failure)
REVIEW     → EXPORT_READY, DRAFT, ARCHIVED
EXPORT_READY → PUBLISHED, REVIEW, ARCHIVED
PUBLISHED  → ARCHIVED
(any)      → ARCHIVED
```
Transition to `EXPORT_READY` is additionally gated (no `flaggedForReview` fields + validation passes — Requirement 6.6).

4. Every transition appends a `LifecycleTransition` (`fromState, toState, transitionedAt, actor, reason?`) to a stored `lifecycleHistory` array (Requirement 5.4).

### 3.2 Enrichment layer persistence (Requirement 4)

The `Product` DTO exposes `enrichmentLayer` (per-attribute `{value, confidence, source, flaggedForReview, approvedBy, approvedAt}` + `channelContent`). Today the repository stores only `CanonicalProduct` (no enrichment). 

**Decision:** store an **auxiliary enrichment record** in the same products table under the same partition, so a single query by `PK=TENANT#{tenantId}` returns product + enrichment + history:
- `PK=TENANT#{tenantId}`, `SK=PRODUCT#{productId}` → CanonicalProduct (unchanged)
- `PK=TENANT#{tenantId}`, `SK=PRODUCT#{productId}#ENRICHMENT` → EnrichmentLayer record
- `PK=TENANT#{tenantId}`, `SK=PRODUCT#{productId}#HISTORY#{ts}` → lifecycle transitions (or a single history item appended to the enrichment record — chosen: single history array on the enrichment record for simplicity at launch volume)

The `get-product` handler is upgraded to assemble the `Product` DTO from the canonical item + enrichment item (Requirement 6 depends on this). `list-products` continues to return `ProductSummary` from the canonical item only (adds `uiLifecycleState`).

### 3.3 Synthesis glue (Requirement 4)

New module `services/product/service/synthesis-glue.ts` (runs inside the product service, invoked by a new handler):

- Input: `productId`, the `GenerationResult`(s) from the engine.
- Maps each `GeneratedContent` variant onto the product:
  - `title` → `content.title` + `enrichmentLayer.attributes.title`
  - `description` → `content.longDescription` + `enrichmentLayer.attributes.description`
  - `bullets` → `content.bulletPoints` + `enrichmentLayer.attributes.bullets`
  - `attributes` → merged into `content.attributes` + per-key `enrichmentLayer.attributes.{key}`
  - `brand` → `content.brand` + attribute
  - `category` → `categoryMappings[channel]` recommended nodes
- For each written field: set `confidence = GenerationResult.confidenceScore`, `source = 'bedrock'`, and `flaggedForReview = confidence < REVIEW_THRESHOLD` (configurable env, default 0.7 to match the engine's `reviewRecommended`).
- Lifecycle: caller sets `GENERATING` before invoking the engine, `REVIEW` on success, back to `DRAFT` on failure with the reason recorded (Requirement 4.3–4.5).

**Orchestration (who calls the engine):** a new product-side handler `POST /products/{id}/synthesize` that: transitions to `GENERATING`, calls the intelligence API server-to-server for the needed types, runs the glue, transitions to `REVIEW`, emits events. Running orchestration server-side (not in the browser) keeps tenant/budget enforcement and avoids the 29s client timeout concern by generating the small set of fields needed. Batch/many-product synthesis uses the engine's existing `/intelligence/batch` under the same handler for a Batch.

> Alternative considered: have the browser call `/intelligence/generate` directly then PATCH the product. Rejected — it leaks orchestration to the client, multiplies round-trips, and makes the `GENERATING→REVIEW` transition racy. Server-side orchestration is cleaner and matches how image processing is already triggered.

### 3.4 Review-loop handlers (Requirement 6)

New handlers in `services/product/api/handlers/`, wired into `ProductApiStack` routes:

| Route | Handler | Behaviour |
|---|---|---|
| `POST /products/{id}/attributes/{name}/approve` | `approve-attribute.ts` | clear `flaggedForReview`, set `approvedBy` (from JWT), `approvedAt` |
| `POST /products/{id}/attributes/{name}/override` | `override-attribute.ts` | set value, `source='manual'`, clear flag |
| `POST /products/{id}/attributes/{name}/regenerate` | `regenerate-attribute.ts` | re-invoke engine for that one field, replace enrichment entry |
| `PATCH /products/{id}/attributes` | `patch-attribute.ts` | resolves the `useUpdateProduct` method/path mismatch (Requirement 6.5) |
| `POST /products/{id}/lifecycle/transition` | `transition-lifecycle.ts` | validate against transition table + export gate |

All handlers: `extractTenantContext`, RBAC middleware, Zod validation, `mapErrorToResponse`, append audit event (Requirement 6.7, 11.1/11.3). The `EXPORT_READY` gate lives in `transition-lifecycle.ts` and calls the Validation Engine (Phase 3) — until Phase 3 lands, the gate checks only `flaggedForReview == false` and returns a clear "validation not yet available" for the schema path.

## 4. Phase 3 — Takealot Product CSV

### 4.1 Multi-Platform Schema Registry (Requirement 7, 7a, 7b)

New package `packages/marketplace-schemas/` (pure data + loader, no AWS). It is the single source of truth for *which* marketplaces exist, *whether* each is enabled, and *how* each builds its file.

**Target registry** — a declarative list of `Marketplace_Target`s:

```ts
interface MarketplaceTarget {
  id: string;            // `${platform}-${country}` e.g. 'takealot-za', 'amazon-za', 'amazon-uk'
  platform: Platform;    // 'takealot' | 'shopify' | 'amazon' | 'makro' | 'woocommerce' | ... (ebay/etsy later)
  name: string;          // display name e.g. 'Takealot (South Africa)'
  country: string;       // ISO 'ZA' | 'GB' | 'US' | 'CA' | 'AU'
  locale: string;        // e.g. 'en-ZA'
  currency: string;      // e.g. 'ZAR'  (informational; not written into content files)
  enabled: boolean;      // false = registered but greyed out until spec verified
}
```

**Spec storage** — `MarketplaceSchema` (`packages/types/src/marketplace.ts`) keyed by `platform + country + category`:
- Platforms that are category-specific (Takealot, Amazon) store one spec per category node.
- Platforms that are not (Shopify, WooCommerce, Makro single-format) store one platform-wide spec.
- Each spec carries `fields: FieldDefinition[]`, `columnOrder`, `delimiter`, `encoding`, and `exportFormat` (`'CSV' | 'TSV' | 'XLSX' | ...`) so Amazon's tab-delimited flat file, Shopify's product CSV, etc. are all expressed as data, not code.

**Loader API (platform-agnostic):**
```ts
listTargets(): MarketplaceTarget[];                  // all, incl. disabled (UI greys out !enabled)
listEnabledTargets(): MarketplaceTarget[];
getTarget(id): MarketplaceTarget | null;
getSchema(targetId, categoryNode?, version?): MarketplaceSchema | null;  // null → unsupported/pending
```

**Launch population:**
- `takealot-za`: fully encoded from the verified loadsheet-104 structure (`title`, `subtitle`, `description`, `brand`, `color_main/secondary/name`, `Attribute_whats_in_the_box`, `Images_image_url_1..20`, `Video_links_video_url_1`, dimensions/weight/warranty, category-specific `Attribute_*`), `enabled: true` (Requirement 7a).
- `shopify-za`, `amazon-za`, `makro-za`, `woocommerce-za`: registered targets with a registered adapter but `enabled: false` and `getSchema` returning `null` until each verified spec is added (Requirement 7b.1–7b.2). Amazon country variants `amazon-uk/us/ca/au` are registered disabled targets to prove the keying (Requirement 7.4).
- eBay/Etsy: **not registered** at launch; addable later purely by appending a target + spec + adapter (Requirement 7.5, 7b.4).

**Precision guard (Requirement 7.7):** a target MUST NOT be flipped to `enabled: true` until its spec is complete and verified against authoritative marketplace documentation. The registry is the gate; no guessed mappings. A CI check asserts every `enabled: true` target has a non-null schema for at least its base category and that no field has a placeholder/`TODO` mapping.

This is a data package so schemas can be reviewed/extended without touching Lambda code; the export stack bundles it. Versioned so a spec revision is additive (Requirement 7.3).

### 4.2 Validation Engine (Requirement 8)

New module `services/export/validation.ts`:
- `validate(product: CanonicalProduct + enrichment, schema): ValidationResult`.
- Per `FieldDefinition`: presence (required/conditional via `conditionExpression`), type, length (`maxLength`/`minLength`), `allowedValues`, `pattern`, numeric range, `dependsOn`/`requiredWith`.
- Produces `ValidationFinding[]` (severity `ERROR`/`WARNING`/`INFO`, field, expected format, suggestion) and sets `exportAllowed = errorCount === 0 && no missing required` (Requirement 8.1–8.3). Warnings are non-blocking (8.4).
- Reused by the `EXPORT_READY` gate and by export itself.

### 4.3 Adapter registry + file writer (Requirement 9, platform-pluggable)

New `services/export/`:
- **Adapter interface** — one per platform, registered in an adapter registry keyed by `platform`:
  ```ts
  interface MarketplaceAdapter {
    platform: Platform;
    map(product: CanonicalProduct & Enrichment, schema: MarketplaceSchema): Row; // column→value
  }
  ```
  The adapter applies each `FieldDefinition`'s `canonicalMapping` + `transformation`, fills the spec's image fields from the product's image refs (up to the spec's max) and the spec's video field from the stored video URL, and emits **no pricing/stock/leadtime** fields (Requirement 9.2). Country/category differences are driven by the spec passed in, so one adapter per platform serves all its country variants.
- `adapters/takealot.ts`: launch-complete (handles `takealot-*`). `adapters/shopify.ts`, `adapters/amazon.ts`, `adapters/makro.ts`, `adapters/woocommerce.ts`: registered, implemented against the interface, but only exercised once their spec is enabled.
- **File writer** — format-aware, driven by the spec: `exportFormat` selects the serialiser (`csv`/`tsv`/`xlsx`), `columnOrder`/`delimiter`/`encoding` drive output (Requirement 9.6). Amazon's tab-delimited flat file and Shopify/WooCommerce CSV layouts are all the same code path with different spec data.
- One file per target `Marketplace_Target` for a Batch (Requirement 9.5).
- Adding eBay/Etsy later = add a target + spec + one `adapters/{platform}.ts` registration; the export job, validation, writer, and API are untouched (Requirement 7.5).

### 4.4 Export stack + `/exports` handler (Requirements 9, 10)

Two options for where export runs:

- **(A) New `ExportApiStack`** — dedicated HTTP API + Lambda(s) + an exports DynamoDB table + reuse Foundation assets S3 bucket for generated CSVs.
- **(B) Add `/exports` routes to the existing `ProductApiStack`** — fewer moving parts, shares the product table and API.

**Chosen: (A) a dedicated `ExportApiStack`.** Exports are a distinct subsystem with their own table (`Export_Job` records), their own S3 prefix for generated files, and will grow (more marketplaces). Keeping it separate matches the existing one-stack-per-subsystem convention (Product, Inventory, Supplier, Image, Intelligence) and avoids overloading the product API.

- `POST /exports` → `create-export.ts`: accepts product ids + one or more `targetId`s. Rejects any `targetId` whose `enabled` is false (Requirement 8.6). For each target × product: resolve the target's schema (by confirmed category where category-specific), validate, map via the platform adapter, write the file (format per spec) to `exports/{tenantId}/{batch}/{targetId}.{ext}` in S3, create an `Export_Job` item, and return an `ExportSummary` per file with a short-lived presigned URL (Requirement 9.4). Products that pass transition to `EXPORT_READY`; products that fail validation are reported in the response and NOT written (Requirement 8.2). One file per target (Requirement 9.5).
- `GET /exports` → `list-exports.ts`: tenant-scoped list for the Exports page (Requirement 10.1).
- `GET /exports/{id}/download` → `download-export.ts`: issues a fresh presigned URL each call (Requirement 10.2), tenant-isolated (10.4).
- api-client: `useProductExport` (exists) repointed to this API; add `useExports` (list) and `useExportDownload`.

### 4.5 Exports page (Requirement 10)

The existing `exports/page.tsx` placeholder is replaced to list `Export_Job`s via `useExports` with Batch name, marketplace, product count, download action; empty state stays when there are none (Requirement 10.3) — consistent with the "structure, no fake data" standard.

## 5. Data Model Summary (products table additions)

| Item | PK | SK | Purpose |
|---|---|---|---|
| Product (existing) | `TENANT#{t}` | `PRODUCT#{p}` | CanonicalProduct + `uiLifecycleState` |
| Enrichment (new) | `TENANT#{t}` | `PRODUCT#{p}#ENRICHMENT` | EnrichmentLayer + lifecycleHistory |

Exports table (new, in ExportApiStack):

| Item | PK | SK | Purpose |
|---|---|---|---|
| Export job | `TENANT#{t}` | `EXPORT#{exportId}` | Batch name, marketplace, product count, status, s3Key, createdAt |

All access is tenant-scoped via `TENANT#{tenantId}` (Requirement 11.1, 11.5).

## 6. Events & Observability (Requirement 11)

Emit on the platform bus (`EventType` additions where needed): `product.enriched` (synthesis complete), a new `product.synthesis_failed`, `product.validated`, `product.exported`. Review-loop actions and exports write audit events. All new Lambdas use Powertools logger/tracer/metrics with `tenantId` + correlation id, matching existing services.

## 7. Testing Strategy

- **Unit:** lifecycle mapping + transition table (exhaustive allowed/denied pairs); synthesis-glue field mapping per `GeneratedContent` variant; validation engine per constraint type; Takealot adapter column mapping incl. image/video fill and the "no pricing columns" guarantee; CSV writer delimiter/encoding.
- **Property-based (fast-check, matching repo convention):** validation never marks `exportAllowed` true when a required field is empty; adapter output column set always ⊆ schema `columnOrder`.
- **Integration (aws-sdk-client-mock):** synthesize handler drives DRAFT→GENERATING→REVIEW and writes enrichment; export handler blocks on validation failure and writes CSV on success; tenant isolation (cross-tenant id returns 404/empty).
- **Build gate:** `tsc --noEmit` + each affected `next build`/service build before each phase PR.

## 8. Rollout / Sequencing

1. **Phase 1 PR:** CDK wiring + CORS fix + SSM URL export + `useGenerateContent`. Deployable, no behaviour change to existing flows. Verify `/intelligence/generate` reachable with a seller JWT.
2. **Phase 2 PR:** lifecycle module + `GENERATING` + enrichment persistence + synthesize + review-loop handlers + DTO assembly. Create Listings becomes functional end-to-end up to REVIEW.
3. **Phase 3 PR:** marketplace-schemas package + validation + Takealot adapter + ExportApiStack + Exports page. Full pipeline to downloadable CSV.

Each phase is a separate branch/PR off `main`, built and verified before merge, consistent with the launch cadence.

## 9. Resolved Design Decisions (confirmed)

1. **Enrichment storage:** auxiliary item in the products table (`SK=PRODUCT#{p}#ENRICHMENT`), keeping the canonical product item clean. **Confirmed.**
2. **`uiLifecycleState` dual field:** store both the precise DTO state (for the UI) and the lossy canonical state (for the export pipeline), avoiding ambiguous round-trips. **Confirmed.**
3. **Export stack separation:** a dedicated `ExportApiStack` with its own table and S3 prefix, matching the one-stack-per-subsystem convention. **Confirmed.**
4. **Category source:** the Takealot schema is per category node. The engine's `category` prediction populates a recommended category into `categoryMappings[takealot]`, and the **seller confirms (or corrects) the category in the Review_Loop** before export. A product cannot reach `EXPORT_READY` without a confirmed category. **Confirmed (AI-predicted + seller-confirmed).**

### Category confirmation — concrete behaviour

- After synthesis, `categoryMappings[takealot]` holds `recommendedNodes[]` (nodeId + confidence) from the engine's `category` result, with no `confirmedNodeId`.
- The Review_Loop treats an unconfirmed category as a required review item (same gating as a `flaggedForReview` attribute): the seller picks the node (defaulting to the top recommendation), which sets `confirmedNodeId`/`confirmedBy`/`confirmedAt`.
- The Schema Registry lookup (§4.1) uses `confirmedNodeId` to select the loadsheet; validation and the `EXPORT_READY` gate fail closed if no category is confirmed (ties into Requirement 7.4 "unsupported category" and 6.6 export gate).


## 10. Phase 4 — Post-Submission Rejection Loop (design sketch)

> Depends on Phase 3 (export engine). Sketched now so the lifecycle and data
> model account for it; full design expands when Phase 4 is scheduled.

**Lifecycle:** add a `REJECTED` state. Transitions: `PUBLISHED → REJECTED`
(marketplace rejected after the seller marked it submitted/accepted-pending) and
`EXPORT_READY → REJECTED` (rejected before acceptance was recorded). Recovery:
`REJECTED → REVIEW` (seller corrects via the existing review loop) → `EXPORT_READY`
→ resubmit → `PUBLISHED` on recorded acceptance. Add to `ALLOWED_TRANSITIONS`
and the DTO enum; map `REJECTED` → canonical `ready` (it is being reworked).

**Rejection intake:** a new endpoint records rejections against an Export_Job /
product — manual entry and/or upload of the marketplace's rejection report.
Each rejection captures: marketplace target, category, per-product reason(s)
(free text + structured code/field where available), the offending value, and a
link to the Export_Job attempt.

**Attempt history:** store resubmission attempts per product per marketplace
(e.g. `PRODUCT#{id}#ATTEMPT#{marketplace}#{n}`) linking rejection → correction →
re-export, so the loop is auditable and the seller sees the history.

**Targeted correction:** rejection reasons drive the review loop — a flagged
field can be regenerated with the rejection reason passed to the engine as
context, and/or the seller overrides it. Re-export reuses Phase 3 unchanged.

**Learning signal (capture only):** persist every rejection as a tenant-scoped,
structured record (reason, field, marketplace, category, offending value,
applied correction). This is a reusable dataset for later prompt refinement /
Marketplace_Spec + Validation_Engine tightening. Where a rejection maps to a
constraint MerchOS could have validated pre-export, flag it to tighten the spec
(feeds Requirements 7/8 precision). Applying the signal to the model is future
work (out of scope here).

**Security:** all rejection-loop operations are tenant-isolated, RBAC-gated, and
audited, consistent with Section 6.
