# MerchOS Gap Register

> **Purpose:** Track the gaps identified during the Week 1 architecture review so they can be
> closed across both the blueprint (design docs) and the working repo (code/infra).
> **Status:** Living document — update as gaps are verified, fixed, or re-scoped.
> **Created:** 2026-10 (Week 1 review)

## Legend

| Field | Values |
|-------|--------|
| **Severity** | Critical · High · Medium · Low |
| **Where** | Blueprint (docs) · Code (repo) · Infra (CDK) · Diagram · Both |
| **Status** | Open · Verified · In Progress · Fixed · Re-scoped · Won't Fix |

---

## A. Capability gaps (designed/discussed, not built)

| ID | Gap | Severity | Where | Status | Notes |
|----|-----|----------|-------|--------|-------|
| G01 | Image pipeline (background removal, hero image, per-channel resize, moderation) | High | Code | **Built — pending deploy** | **Image Intelligence Engine** spec (`.kiro/specs/image-intelligence-engine`, requirements→design→tasks) + implementation. Deterministic pipeline: Rekognition moderation (≥0.80 reject→quarantine) → Rekognition+Sharp white hero → per-channel variants (Takealot 1000²…Shopify 2048², bicubic upscale flag) → canonical `content.imageRefs` write, orchestrated by a Step Functions Express workflow. New `services/image-intelligence` + `infrastructure/lib/image-intelligence-stack.ts`. Verified: infra tsc + `cdk synth`; image-intelligence unit tests. **Real Sharp/Rekognition I/O + HEIC layer validated at the Phase 8 dev-deploy checkpoint (can't run native Sharp locally).** |
| G02 | Image enhancement path (weak photo → cleaned/upscaled) | High | Both | **Built — pending deploy** | **Stable Image Inpaint** (Bedrock) replaces the deprecated Nova Canvas. `services/enhancement-model.ts` is a pluggable, region-gated adapter (model id from config, `IMAGE_ENHANCEMENT_ENABLED` off by default); `processors/enhance.ts` is image-to-image only (conditioned on the merchant's photo), auto-triggered for weak photos, **falls back to the deterministic hero on any failure (never fails the job)**. Scoped Bedrock IAM to the one model ARN. Verified: tsc + synth (IAM scoping confirmed in template) + 9 unit tests. |
| G03 | Image sourcing from the supplier's own site | Medium | Both | **Built — pending deploy** | `processors/source-url.ts` reuses the Supplier Intelligence HTML extractor to discover product images on the supplier's OWN product page, filters **same-origin only** (`isSameOrigin` — third-party/CDN/arbitrary-web rejected), downloads to raw-uploads, and starts the image workflow. No images → product flagged for manual attention (not failed). General web scraping remains out of scope (copyright). Verified: tsc + synth + 8 unit tests. |
| G04 | Marketplace export adapters only half-real | High | Code | **Open (not in this engagement's scope)** | Only a content-length helper inside product-intelligence. Real export adapters (ADR-003) still not built. The image track (G01–G03) was prioritised; the export track (G05→G04) remains for a future engagement. |
| G05 | Export / Validation path (Schema Registry + Validation Engine) not built | High | Code | **Open (not in this engagement's scope)** | Described in `schema-validation-architecture.md`; no runtime implementation. Prerequisite for G04. Deferred with G04. |

## B. Correctness / likely bugs

| ID | Gap | Severity | Where | Status | Notes |
|----|-----|----------|-------|--------|-------|
| G06 | Product Intelligence env-var mismatch | Critical | Infra | **Fixed + verified** | **VERIFIED & FIXED.** CDK set `TABLE_NAME`/`EVENT_BUS_ARN`; code reads `PRODUCT_INTELLIGENCE_TABLE`/`EVENT_BUS_NAME` in 6+ files. Result: table name fell back to literal `'product-intelligence'` (wrong table in every env) and ALL EventBridge events silently skipped. Fix: CDK now sets both `PRODUCT_INTELLIGENCE_TABLE` + `TABLE_NAME` and `EVENT_BUS_NAME` + `EVENT_BUS_ARN` (bus name imported from `/eventbridge/bus-name` SSM param). `tsc --noEmit` passes; product-intelligence unit tests 57/57 pass. **Pending deploy.** |
| G07 | Imported products bypass product-service invariants | High | Code | **Fixed + verified (Option A)** | **FULL FIX.** `product-persister.ts` now writes the **canonical `CanonicalProduct` shape**: nested `content.sku`/`content.title`/`content.brand`/`content.longDescription`, `importMetadata` inside `content.attributes`, price→`commercial.sellingPrice`, canonical defaults, lowercase `'draft'`. GSI1 unified to `GSI1PK=TENANT#{t}#SKU` / `GSI1SK=SKU#{sku}` — identical to `ProductRepository.toItem`, so API `findBySku` and the import detector see the SAME records (cross-path SKU visibility restored). `duplicate-detector.queryBySku` updated to the unified GSI1, making it the correct SKU-uniqueness gate. Tests: supplier-intelligence unit 402/402, product 119/119. Earlier casing fix also retained. See migration note below. |
| G08 | ProductRepository doesn't use TenantDynamoClient | Low | Code | **Re-scoped (not a bug)** | **VERIFIED.** Intentional & documented; `update`/`delete` do enforce tenant conditions. Residual: `get`/`list`/`findBySku` rely on PK construction only. Acceptable; downgraded from bug to defense-in-depth observation. |

## C. Security / IAM

| ID | Gap | Severity | Where | Status | Notes |
|----|-----|----------|-------|--------|-------|
| G09 | Over-broad IAM on supplier-intelligence processors (`resources: ['*']`) | High | Infra | **Fixed + verified** | Scoped `duplicate-detector` (table + GSI1) and `product-persister` (table) to the reconstructed Products ARN. `tsc` + `cdk synth` pass; template shows scoped ARNs. Textract `*` left (no resource-level perms). |
| G10 | Unauthenticated WhatsApp webhook relies solely on HMAC | Medium | Code | **Reviewed + fixed** | Core `verifyHmacSignature` was correct (timingSafeEqual, `sha256=` prefix, length-throw catch). Fixed 2 real issues: (1) **body not base64-decoded** before HMAC — API GW v2 `isBase64Encoded` would fail legit requests / hash wrong bytes; now decoded. (2) verify-token compared with `===`; now `timingSafeStringEqual`. 13/13 webhook tests pass. |

## D. Resilience / scalability

| ID | Gap | Severity | Where | Status | Notes |
|----|-----|----------|-------|--------|-------|
| G11 | Synchronous AI generation risks API Gateway timeout | Medium | Both | **Mitigated + roadmap** | **Partial fix.** `generate` Lambda timeout was 60s behind an HTTP API with a hard 29s integration cap — so it could keep running (billing + orphan writes) 30–60s after the client already got a 504. Fixed: aligned the generate Lambda timeout to **29s** (CDK) so it stops when the client can no longer receive the response. `tsc`/tests pass. **Roadmap (not built):** long generations should move to an async submit→poll job pattern (like the existing 300s `batch` endpoint); documented below. |
| G12 | Silent failure of usage/billing/audit writes | Medium | Code | **Fixed + verified** | **FIXED.** The three swallowed-failure paths in `generate.ts` (token-usage record, result store, low-confidence event emit) now emit CloudWatch Count metrics — `TokenRecordFailure`, `ResultStoreFailure`, `LowConfidenceEventFailure` (namespace `MerchOS`) — via Powertools `metrics` + the `logMetrics` middleware (mirrors the auth handlers). Behavior stays non-blocking (correct for availability) but is now **alertable** so billing/usage/audit drift is visible. product-intelligence tests 57/57 pass; infra `tsc` clean. |

## E. Documentation / blueprint drift

| ID | Gap | Severity | Where | Status | Notes |
|----|-----|----------|-------|--------|-------|
| G13 | Blueprint says one Cognito app client; code provisions three | Low | Blueprint | **Fixed** | Blueprint §1.3 rewritten: three clients (seller-dashboard SPA/PKCE, admin-dashboard SPA/PKCE, api-gateway with secret) with table, rationale, and as-built note. |
| G14 | Marketplace knowledge base largely unverified | Medium | Blueprint | **Fixed** | Added prominent verification caveat after §1.1 with classification table and current-state summary; ties to blueprint §13 (no adapters on unverified schemas). |
| G15 | Model IDs pinned to early-2024 Claude 3 | Low | Both | **Fixed (docs)** | Documented in new blueprint §14.4: pinning is intentional; upgrade considerations incl. inference-profile IDs changing both model ID + IAM ARN. Code IDs unchanged by design. |
| G16 | Multi-model Bedrock routing not documented as a pattern | Low | Blueprint | **Fixed** | New blueprint §14 (AI / Bedrock Model Strategy): single-API multi-model principle, text routing table, image-to-image routing, least-privilege-per-model. |
| G17 | Diagram label: "Supplier Intel" shows only Textract OCR | Low | Diagram | **Fixed** | SVG relabeled to CSV·PDF·ZIP·img·URL·WhatsApp·OCR; PNG re-rendered. |

## F. Build / deploy (found during verification)

| ID | Gap | Severity | Where | Status | Notes |
|----|-----|----------|-------|--------|-------|
| G18 | Auth stack bundling fails — breaks `cdk synth`/deploy | Critical | Infra | **Fixed + verified** | **VERIFIED & FIXED.** `auth-api-stack` bundling config lacked `externalModules` for Powertools and attached no Powertools layer. esbuild tried to bundle `@aws-lambda-powertools/tracer` → `aws-xray-sdk-core`'s dynamic `./aws-xray` require → `Could not resolve "./aws-xray"` → whole `cdk synth` failed. Fix: added Powertools layer + externalized the 3 Powertools modules (mirrors product-intelligence stack). `tsc --noEmit` passes; `cdk synth MerchOS-AuthApi-dev` now succeeds (SYNTH_EXIT 0). This unblocks full-app synth/deploy. |
| G19 | Products table has no GSI2, but duplicate-detector queries it | High | Both | **Mitigated — needs infra** | **Found during G07.** The Products table (`product-api-stack`) defines only GSI1. The duplicate-detector's title-similarity check (`queryTitlesBySupplier`) queries `IndexName: 'GSI2'`, which would raise `ValidationException` at runtime — the secondary dedupe has never worked against the real table. **Mitigated:** the detector now degrades safely (catches missing-index error, skips title similarity, falls back to the exact-SKU check) instead of failing the import. **Still needs:** add a GSI2 (`GSI2PK=TENANT#{t}#SUPPLIER#{s}`) to the Products table + persister to write it, if title-similarity dedupe is required. |

---

## Verification notes (Week 1 pass)

- **G06** confirmed by reading `infrastructure/lib/product-intelligence-stack.ts` (sets `TABLE_NAME`, `EVENT_BUS_ARN`) vs `services/product-intelligence/**` (reads `PRODUCT_INTELLIGENCE_TABLE`, `EVENT_BUS_NAME`). Fixed in CDK; `tsc --noEmit` passes.
- **G07** confirmed by reading `services/supplier-intelligence/processors/product-persister.ts` — direct `BatchWriteCommand`, no SKU-uniqueness, lifecycle casing mismatch (`'DRAFT'` vs repository lowercase).
- **G08** downgraded after reading `services/product/repository/product-repository.ts` — the non-use of `TenantDynamoClient` is intentional and documented; writes carry tenant conditions.

## Environment findings (not repo defects)

- **RESOLVED:** vitest could not run due to a partial/inconsistent `node_modules` (mixed vitest 1.6.0/1.6.1, missing hoisted transitive deps like `pathe`/`@vitest/utils`/`pretty-format`). Fixed by running `npm ci` at repo root. Tests now run: product-intelligence 57/57, product 119/119, supplier-intelligence unit 401/401. Infra `tsc --noEmit` passes.
- **STILL OPEN (separate gap — G18):** `cdk synth --all` fails bundling `services/auth/handlers/refresh.ts` (`Could not resolve "./aws-xray"`). This blocks full synth/deploy and should be investigated. Added as G18 below.

## G07 migration / backfill note (pre-existing imported rows)

The G07 fix changes the **write shape** of import-created products to the canonical model. Any products **already imported** under the old scheme will be inconsistent with the new one and need a one-off backfill before they behave correctly:

**Old (pre-fix) imported item:**
- Flat top-level `sku`, `title`, `brand`, `description`, `category` fields.
- `GSI1PK = TENANT#{t}#SKU#{sku}`, `GSI1SK = PRODUCT#CREATED#{ts}`.
- `GSI2PK/GSI2SK` per-supplier (against a non-existent GSI2).
- Top-level `importMetadata`.
- `lifecycleState` possibly `'DRAFT'` (uppercase) on the oldest rows.

**New (canonical) item:**
- Nested `content.{sku,title,brand,longDescription,attributes}`; `importMetadata` inside `content.attributes`; price under `commercial.sellingPrice`.
- `GSI1PK = TENANT#{t}#SKU`, `GSI1SK = SKU#{sku}` (unified with the Product API).
- No GSI2 attributes.
- `lifecycleState = 'draft'` (lowercase).

**Backfill approach (recommended):**
1. Scan the Products table for items where `GSI1PK` matches `TENANT#*#SKU#*` (old scheme) or where a top-level `sku` exists.
2. For each, transform to the canonical shape (move fields under `content`, relocate `importMetadata` into `content.attributes`, map price to `commercial.sellingPrice`, rewrite `GSI1PK/GSI1SK`, drop `GSI2*`, lowercase `lifecycleState`).
3. Conditional-write the transformed item; log any SKU collisions surfaced by the now-unified index for manual review.

This backfill is only required if products were imported before this fix was deployed. New imports use the canonical shape directly. **Status: not yet implemented — tracked here as a follow-up to G07.**

## G11 async-generation roadmap (not built)

The synchronous `POST /intelligence/generate` endpoint is now capped at 29s (aligned to the API Gateway HTTP API integration limit). That removes the wasted-compute/orphan-write problem, but it does **not** let a single generation exceed 29s. For generations that legitimately need longer, the recommended pattern (not yet implemented):

1. **Submit** — `POST /intelligence/generate/jobs` enqueues the request (SQS or Step Functions), returns `202 Accepted` with a `jobId` immediately (well under 29s).
2. **Process** — a worker Lambda (longer timeout, like the existing 300s `batch`) runs the AI generation off the request path and writes the result to DynamoDB.
3. **Poll / notify** — client polls `GET /intelligence/generate/jobs/{jobId}` for status/result, or subscribes to an EventBridge completion event.

Until then: short generations use the synchronous endpoint; bulk/long work uses the existing `batch` endpoint (300s). No single synchronous call may exceed the 29s gateway cap.

---

## Consolidation summary (engagement close-out)

### Gap status at a glance

| ID | Gap | Final status |
|----|-----|--------------|
| G01 | Image pipeline | **Built — pending deploy** |
| G02 | Image enhancement (Stable Image Inpaint) | **Built — pending deploy** |
| G03 | Supplier-own-domain image sourcing | **Built — pending deploy** |
| G04 | Marketplace export adapters | Open (future engagement) |
| G05 | Schema Registry + Validation Engine | Open (future engagement, precedes G04) |
| G06 | Product Intelligence env-var mismatch | **Fixed + verified** |
| G07 | Imported products bypass product-service invariants | **Fixed + verified** |
| G08 | ProductRepository tenant client | Re-scoped (not a bug) |
| G09 | Over-broad IAM on supplier processors | **Fixed + verified** |
| G10 | WhatsApp webhook HMAC | **Reviewed + fixed** (base64 decode + timing-safe token) |
| G11 | Synchronous AI generation timeout | **Mitigated** (29s cap) + async roadmap documented |
| G12 | Silent usage/billing/audit write failures | **Fixed + verified** (CloudWatch metrics) |
| G13 | Blueprint "one app client" vs three | **Fixed** (blueprint §1.3) |
| G14 | Marketplace knowledge base unverified | **Fixed** (verification caveat added) |
| G15 | Model IDs pinned to early-2024 Claude 3 | **Fixed (docs)** (blueprint §14.4) |
| G16 | Multi-model Bedrock routing undocumented | **Fixed** (blueprint §14) |
| G17 | Diagram: "Supplier Intel" showed only Textract | **Fixed** (diagram relabelled) |
| G18 | Auth stack bundling broke `cdk synth`/deploy | **Fixed + verified** (unblocked deploy) |
| G19 | Products table has no GSI2, detector queried it | **Mitigated** (safe degrade) — needs GSI2 infra for title-similarity dedupe |

### Image Intelligence Engine — build phases

Spec: `.kiro/specs/image-intelligence-engine/{requirements,design,tasks}.md`.

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Foundations: stack, Image_Jobs table, intake API (upload presign / start-process / get) | ✅ complete + verified |
| 2 | Deterministic pipeline: moderation, hero, variants, persist, Step Functions | ✅ complete + verified |
| 3 | CloudFront signed-URL delivery + Secrets Manager signing key + rotation runbook | ✅ complete + verified |
| 4 | AI enhancement (Stable Image Inpaint), pluggable + region-gated | ✅ complete + verified |
| 5 | Supplier-own-domain image sourcing (G03) | ✅ complete + verified |
| 6 | RBAC `images` resource + blueprint matrix | ✅ complete + verified |
| 7 | Seller Dashboard UI (rewired gallery to the async engine) | ✅ complete + verified |
| 8 | Dev-deploy checkpoint (real Sharp/Bedrock/Rekognition I/O) | ⏳ requires AWS deploy |

All code verified locally via `tsc` + `cdk synth` (`--exclusively` for the image stack) + unit tests. Native Sharp image I/O and live Bedrock/Rekognition calls are only exercisable on a real deploy (Phase 8).

### Remaining follow-ups (all require a deploy or a CDK upgrade)

1. **Phase 8 dev checkpoint** — deploy to `dev`; exercise upload→moderate→hero→variants→signed-URL end to end; confirm Sharp/Rekognition/Bedrock behaviour against real services.
2. **HEIC layer** — add HEIC decode support to the Sharp layer build before the checkpoint (Phase 2 task #4).
3. **S3 quarantine lifecycle rule** — 30-day expiry on `assets/images/{tenant}/quarantine/`; must be added on the Foundation stack (it owns the assets bucket), not the image stack (imported-bucket L2 limitation).
4. **CloudFront OAC migration** — current CDK (2.155) uses `S3Origin` (Origin Access Identity); migrate to `S3BucketOrigin.withOriginAccessControl` (OAC) on CDK upgrade. OAI keeps the bucket private in the meantime.
5. **G19 GSI2** — add a per-supplier GSI2 to the Products table if title-similarity dedupe is wanted (SKU-exact dedupe already works).
6. **G07 backfill** — one-off transform of any pre-fix imported product rows to the canonical shape (only needed in an env that imported before the G07 fix deployed). Procedure documented above.
7. **Deferred image UI bits** — explicit hero re-designation and a per-image enhance toggle (enhancement is currently auto + env-flag gated).
8. **Async AI-generation job pattern** (G11) — for text generations that need >29s.

### Git status

All of the above is **uncommitted local working-tree changes** — nothing has been staged, committed, or pushed this engagement. Branch: `feature/supplier-intelligence`. The tree also contains some pre-existing unrelated modifications that predate this work.
