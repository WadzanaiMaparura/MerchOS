# Listing Synthesis Pipeline — Implementation Plan

> **Status:** Draft — awaiting approval
> **Requirements:** `./requirements.md` (approved) · **Design:** `./design.md` (approved)

Each top-level task is a shippable unit. Phases map to PRs: Phase 1 (deploy synthesis), Phase 2 (glue + review loop), Phase 3 (Takealot CSV). Every task ends green (`tsc --noEmit` + affected builds) before the phase PR is merged.

## Phase 1 — Deploy the Synthesis Engine

- [ ] 1. Wire and deploy the Product Intelligence stack
  - [ ] 1.1 Instantiate `ProductIntelligenceStack` in `infrastructure/bin/merch-os.ts`
    - Import the stack; create `MerchOS-ProductIntelligence-${env}` with `{ env, environment }`
    - Add explicit deploy dependencies on `foundationStack` and `authStack` (SSM import ordering)
    - _Requirements: 1.1, 1.3, 1.5_
  - [ ] 1.2 Fix CORS origins in `infrastructure/lib/product-intelligence-stack.ts`
    - Replace hard-coded `https://{env}.merchos.io` with the real seller origins: production apex `https://merchos.co.za` and the dev/localhost origin
    - _Requirements: 1.2, 2.4_
  - [ ] 1.3 Export the Intelligence API base URL via SSM
    - Add/confirm SSM export `/merch-os/{env}/product-intelligence/api-url` = HTTP API URL
    - _Requirements: 1.4_
  - [ ] 1.4 `cdk synth` + deploy to dev; verify `/intelligence/generate` responds 401 without JWT and 200/402 with a seller JWT
    - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Seller api-client support for synthesis
  - [ ] 2.1 Extend `ApiClientProvider` to expose a second client for the Intelligence API
    - Add a client factory/base keyed on `NEXT_PUBLIC_INTELLIGENCE_API_URL`; reuse the existing Cognito session token getter; leave the product client unchanged
    - _Requirements: 2.4_
  - [ ] 2.2 Implement `useGenerateContent` in `packages/api-client/src/hooks/useGenerateContent.ts`
    - `useMutation` → `POST /intelligence/generate` with `{ type, productData, marketplace?, options? }`; return `GenerationResult`
    - Map `BUDGET_EXCEEDED` (402) to a typed `ApiError` code the UI can switch on
    - Export the hook from the package index
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ] 2.3 Set `NEXT_PUBLIC_INTELLIGENCE_API_URL` in the seller Amplify env (from the SSM export of 1.3)
    - _Requirements: 1.4, 2.1_

## Phase 2 — Synthesis Glue, Lifecycle, Review Loop

- [ ] 3. Lifecycle reconciliation
  - [ ] 3.1 Add `GENERATING` to `LifecycleState` in `packages/types/src/common.ts`
    - Place between `DRAFT` and `REVIEW`; add matching `EventType` entries `product.synthesis_failed`
    - _Requirements: 4.4, 5.1_
  - [ ] 3.2 Create `services/product/service/lifecycle.ts`
    - `toCanonical(state)` / `toDto(canonical)` mapping per design §3.1; `ALLOWED_TRANSITIONS` table; `assertTransition(from, to)` throwing a typed error on invalid transitions
    - _Requirements: 5.2, 5.3_
  - [ ] 3.3 Unit tests for the mapping and transition table (exhaustive allowed/denied pairs)
    - _Requirements: 5.2, 5.3_

- [ ] 4. Enrichment persistence + DTO assembly
  - [ ] 4.1 Add enrichment item read/write to `ProductRepository`
    - New methods `getEnrichment`, `putEnrichment`, `appendLifecycleTransition` on `SK=PRODUCT#{p}#ENRICHMENT` (EnrichmentLayer + `lifecycleHistory` + `uiLifecycleState`)
    - _Requirements: 4.1, 5.4_
  - [ ] 4.2 Store `uiLifecycleState` on the product/enrichment item and keep canonical `lifecycleState` for the pipeline
    - _Requirements: 5.1, 5.2_
  - [ ] 4.3 Upgrade `get-product.ts` to assemble the full `Product` DTO (canonical + enrichment + history + `uiLifecycleState`)
    - Update `list-products.ts` to include `uiLifecycleState` in `ProductSummary`
    - _Requirements: 6 (foundation), 5.1_
  - [ ] 4.4 Unit tests for DTO assembly and enrichment round-trip (tenant-scoped)
    - _Requirements: 4.1, 11.1, 11.5_

- [ ] 5. Synthesis glue + orchestration handler
  - [ ] 5.1 Create `services/product/service/synthesis-glue.ts`
    - Map each `GeneratedContent` variant onto `content` + `enrichmentLayer` per design §3.3; set `confidence`, `source='bedrock'`, `flaggedForReview = confidence < REVIEW_THRESHOLD` (env, default 0.7)
    - Populate `categoryMappings[takealot].recommendedNodes` from the `category` result (no `confirmedNodeId`)
    - _Requirements: 4.1, 4.2_
  - [ ] 5.2 Implement `POST /products/{id}/synthesize` handler
    - Transition `→ GENERATING`; call the Intelligence API server-to-server for required types (single or `/intelligence/batch` for a Batch); run glue; transition `→ REVIEW`; on failure `→ DRAFT` with reason; emit events
    - _Requirements: 4.3, 4.5, 11.2_
  - [ ] 5.3 Wire the `synthesize` route into `ProductApiStack` with JWT + RBAC + tenant isolation
    - _Requirements: 11.1_
  - [ ] 5.4 Unit + integration tests: DRAFT→GENERATING→REVIEW on success, →DRAFT on failure; glue mapping per variant
    - _Requirements: 4.1, 4.3, 4.5_

- [ ] 6. Review-loop handlers
  - [ ] 6.1 `approve-attribute.ts` — `POST /products/{id}/attributes/{name}/approve` (clear flag, set approver/time)
    - _Requirements: 6.1_
  - [ ] 6.2 `override-attribute.ts` — `POST .../override` (set value, `source='manual'`, clear flag)
    - _Requirements: 6.2_
  - [ ] 6.3 `regenerate-attribute.ts` — `POST .../regenerate` (re-invoke engine for one field, replace entry)
    - _Requirements: 6.3_
  - [ ] 6.4 `patch-attribute.ts` — `PATCH /products/{id}/attributes` (resolve the `useUpdateProduct` method/path mismatch)
    - _Requirements: 6.5_
  - [ ] 6.5 `transition-lifecycle.ts` — `POST /products/{id}/lifecycle/transition` honouring `ALLOWED_TRANSITIONS`; `EXPORT_READY` gate: no `flaggedForReview` fields AND category confirmed AND (Phase 3) validation passes
    - _Requirements: 6.4, 6.6_
  - [ ] 6.6 Category confirmation path: approving/confirming the category sets `confirmedNodeId/confirmedBy/confirmedAt`; unconfirmed category is a required review item
    - _Requirements: 6.6, 7.4_
  - [ ] 6.7 Wire all review-loop routes into `ProductApiStack`; each handler: tenant context, RBAC, Zod, `mapErrorToResponse`, audit event
    - _Requirements: 6.7, 11.1, 11.3_
  - [ ] 6.8 Unit + integration tests for each handler incl. invalid-transition rejection and export-gate blocking
    - _Requirements: 6.1–6.6_

## Phase 3 — Multi-Platform Export Framework

- [ ] 7. Multi-platform Schema Registry
  - [ ] 7.1 Create `packages/marketplace-schemas/` package (data + loader, no AWS deps)
    - `MarketplaceTarget` type + target registry; `listTargets()`, `listEnabledTargets()`, `getTarget(id)`, `getSchema(targetId, categoryNode?, version?)`; versioned; `null` for unknown/pending
    - _Requirements: 7.1, 7.3, 7.6_
  - [ ] 7.2 Register all launch targets with correct `enabled` flags and country keying
    - `takealot-za` (enabled true at 7.3); `shopify-za`, `amazon-za`, `makro-za`, `woocommerce-za` (enabled false); Amazon country variants `amazon-uk/us/ca/au` registered disabled
    - _Requirements: 7.2, 7.4, 7b.1_
  - [ ] 7.3 Encode the verified `takealot-za` content-loadsheet schema(s) from loadsheet-104; set `enabled: true`
    - `MarketplaceSchema` per category: title, subtitle, description, brand, colour, whats-in-the-box, `Images_image_url_1..20`, `Video_links_video_url_1`, dimensions/weight/warranty, category-specific `Attribute_*`; `exportFormat: 'CSV'`
    - _Requirements: 7a.1, 7a.2, 9.2, 9.3_
  - [ ] 7.4 Add placeholder (empty-schema, `enabled:false`) entries for the other four platforms with their intended `exportFormat`/delimiter/encoding recorded for when specs land
    - _Requirements: 7b.1, 7b.3_
  - [ ] 7.5 CI/precision guard: assert every `enabled:true` target has a non-null verified schema and no field carries a placeholder/`TODO` mapping
    - _Requirements: 7.7_
  - [ ] 7.6 Unit tests: target keying (platform+country), enabled/disabled listing, schema lookup, no pricing/stock/leadtime fields in any enabled schema
    - _Requirements: 7.1, 7.4, 9.2_

- [ ] 8. Platform-agnostic Validation Engine
  - [ ] 8.1 Create `services/export/validation.ts` → `validate(product+enrichment, schema): ValidationResult`
    - Spec-driven only (no platform branching): presence/conditional, type, length, allowedValues, pattern, range, dependsOn/requiredWith; set `exportAllowed`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ] 8.2 Wire the Validation Engine into the `EXPORT_READY` gate in `transition-lifecycle.ts`; reject disabled targets
    - _Requirements: 6.6, 8.1, 8.2, 8.6_
  - [ ] 8.3 Unit + property tests: never `exportAllowed` when a required field is empty; findings carry field/expected/suggestion; same engine validates two different platform specs
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [ ] 9. Adapter registry + format-aware file writer
  - [ ] 9.1 Define `MarketplaceAdapter` interface + adapter registry keyed by `platform`
    - _Requirements: 7.5, 9.1_
  - [ ] 9.2 `services/export/adapters/takealot.ts` (launch-complete) → `map(product, schema)`
    - Apply `canonicalMapping` + `transformation`; fill image fields up to spec max, video field from stored URL; never emit pricing/stock/leadtime; serves all `takealot-*`
    - _Requirements: 9.1, 9.2, 9.3_
  - [ ] 9.3 Register `shopify.ts`, `amazon.ts`, `makro.ts`, `woocommerce.ts` adapters implementing the interface (exercised when their specs enable)
    - _Requirements: 7b.2_
  - [ ] 9.4 `services/export/file-writer.ts` → format-aware serialiser driven by `exportFormat`/`columnOrder`/`delimiter`/`encoding` (CSV/TSV/XLSX)
    - _Requirements: 9.6, 7b.3_
  - [ ] 9.5 Unit + property tests: output columns ⊆ schema `columnOrder`; image/video fill; CSV and TSV writer correctness; adding a new platform needs no engine change
    - _Requirements: 9.1, 9.6, 7.5_

- [ ] 10. Export API stack + handlers
  - [ ] 10.1 Create `infrastructure/lib/export-api-stack.ts` (`ExportApiStack`)
    - Exports DynamoDB table (`TENANT#{t}` / `EXPORT#{id}`), HTTP API + JWT authorizer, S3 prefix `exports/{tenantId}/...`, least-privilege IAM, SSM export of API URL; bundle `packages/marketplace-schemas`
    - Instantiate in `infrastructure/bin/merch-os.ts` with Foundation/Auth deps
    - _Requirements: 9.4, 10.1, 11.1_
  - [ ] 10.2 `create-export.ts` — `POST /exports` {productIds, targetIds[]}
    - Reject disabled targets; per target × product: load+validate; map via platform adapter; write file (format per spec) to S3; create `Export_Job`; passing products → `EXPORT_READY`; failing reported, not written; one file per target; return `ExportSummary[]` with short-lived presigned `downloadUrl`
    - _Requirements: 8.2, 8.6, 9.1, 9.4, 9.5_
  - [ ] 10.3 `list-exports.ts` — `GET /exports` (tenant-scoped) and `download-export.ts` — `GET /exports/{id}/download` (fresh presigned URL each call)
    - _Requirements: 10.1, 10.2, 10.4_
  - [ ] 10.4 Emit `product.exported` + audit events; Powertools logging with tenant/correlation ids
    - _Requirements: 11.2, 11.3, 11.4_
  - [ ] 10.5 Integration tests: validation-failure blocks file; success writes file + transitions; disabled target rejected; cross-tenant access denied
    - _Requirements: 8.2, 8.6, 9.4, 11.5_

- [ ] 11. Seller api-client + Create Listings selector + Exports page
  - [ ] 11.1 Add `useMarketplaceTargets` (from the registry) exposing enabled + disabled targets
    - _Requirements: 3.6, 7.2_
  - [ ] 11.2 Update the Create Listings marketplace selector to list all targets, render `enabled:false` as greyed-out "coming soon", and block selecting/submitting them
    - _Requirements: 3.6, 3.7_
  - [ ] 11.3 Repoint `useProductExport` to the Export API (targetIds[]); add `useExports` (list) and `useExportDownload`
    - _Requirements: 9.1, 9.4, 10.1, 10.2_
  - [ ] 11.4 Replace `apps/seller-dashboard/app/(dashboard)/exports/page.tsx` placeholder with the real list (Batch, target, product count, download per file); keep the empty state when none
    - _Requirements: 10.1, 10.3_
  - [ ] 11.5 `tsc --noEmit` + `next build` for the seller app; verify greyed-out targets, empty exports state, and a populated list against dev
    - _Requirements: 3.6, 10.3_

## Cross-cutting (every phase)

- [ ] 12. Verification gates
  - [ ] 12.1 Each phase PR: `tsc --noEmit` across affected packages + `next build` for the seller app + service builds; clean before merge
  - [ ] 12.2 Tenant-isolation assertions in every new handler's tests (cross-tenant id → 404/empty)
    - _Requirements: 11.1, 11.5_
  - [ ] 12.3 Remove any temporary artifacts; confirm no fabricated/sample data introduced (launch "structure, no fake data" standard)
    - _Requirements: 10.3_
