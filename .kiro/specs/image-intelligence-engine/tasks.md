# Image Intelligence Engine — Tasks

> **Status:** Draft — awaiting approval
> **Requirements:** `./requirements.md` · **Design:** `./design.md`
> Each task is verified before being marked done: backend → `tsc` + unit tests + `cdk synth`; frontend → `tsc` + React Testing Library + build. Tasks marked `[*]` are optional/test-only.

## Phase 1 — Foundations (stack, data, intake) ✅ COMPLETE (verified: infra tsc + cdk synth SYNTH_EXIT 0)

- [x] 1. Create `ImageIntelligenceStack` CDK skeleton
  - Added `infrastructure/lib/image-intelligence-stack.ts`; wired in `bin/merch-os.ts` after Foundation/Auth (addDependency on both); imports platform KMS, EventBridge bus name/arn, raw-uploads + assets buckets, Cognito pool/client via SSM. Powertools layer + Node 20 ESM bundling with Powertools externalized (G18 pattern).
  - _Requirements: 8.2, 8.3_
- [x] 2. Provision Image_Job DynamoDB table
  - `merch-os-image-jobs-{env}`: PK/SK + GSI1 (by product), TTL `ttl`, PAY_PER_REQUEST, customer-managed KMS, PITR, RETAIN. SSM-exported table name.
  - _Requirements: 8.5_
- [~] 3. Define S3 prefixes + lifecycle
  - Key prefixes defined in handlers/design (`images/{tenantId}/{productId}/source/`, `.../quarantine/`). **Quarantine 30-day lifecycle rule deferred to a Foundation-stack change** — lifecycle rules cannot be attached to an imported bucket L2 ref; the assets bucket is owned by FoundationStack. Follow-up: add the rule on the Foundation assets bucket. (Documented in-stack.)
  - _Requirements: 1.2, 2.3_
- [ ] 4. Add Sharp + HEIC Lambda layers  _(deferred to Phase 2 — no Sharp-using Lambda exists until background-removal/packager are built)_
  - _Requirements: 1.1, 3.1, 4.1_
- [x] 5. Implement job model + shared types
  - `services/image-intelligence/types/{image,events,index}.ts` (Image_Job, statuses, variant, moderation, enhancement, events); `utils/{image-job-status,event-emitter,extract-tenant}.ts`.
  - _Requirements: 7.1_
- [x] 6. Implement upload presign + start-process API handlers
  - `upload-url` (presigned S3 PUT, tenant-scoped key, format/size validated via Zod), `start-process` (create Image_Job QUEUED + tenant/product source-key guard, return 202), `get-image` (tenant-scoped status read). middy + RBAC (`images` create/read) + tenant isolation + rate limit + input validation.
  - _Requirements: 1.2, 1.3, 1.4, 1.6, 1.7, 8.1_
- [x] 7. HTTP API + Cognito JWT authorizer + routes (upload, process, get)
  - _Requirements: 1.7, 7.1_
- [ ]* 8. Unit tests: intake validation (format/size reject), job creation, tenant scoping.  _(deferred — bundled with Phase 2 test task #15 since the workflow mocks share setup)_

> **Phase 1 notes:** `images` RBAC resource uses action `create`/`read` (the rbac `Action` union is `create|read|update|delete` — not `write`). Registering `images` in `@merch-os/rbac` config is Phase 6 (#28); until then authorization will deny at runtime — acceptable as Phase 1 is not yet deployed/live. Per-service isolated `tsc` shows the same `@middy/core`/rootDir noise as every other service; authoritative check is `cdk synth` (passed).

## Phase 2 — Deterministic pipeline (G01) ✅ COMPLETE (verified: infra tsc + cdk synth SYNTH 0; 21 unit tests pass)

- [x] 9. `image-moderation` Lambda (Rekognition `DetectModerationLabels`)
  - `processors/moderation.ts`: MinConfidence 80, DISALLOWED_MODERATION_CATEGORIES set, matches top-level ParentName; handler flips QUEUED→PROCESSING then moderates. Moderation-reject routed to quarantine by the workflow Choice (`processors/quarantine.ts`: CopyObject → assets quarantine prefix, job REJECTED, emit `ImageModerationRejected`).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
- [x] 10. `image-background-removal` Lambda (Rekognition subject + Sharp white composite)
  - `processors/background-removal.ts`: Rekognition DetectLabels subject confidence < 75 → `reviewRecommended`; Sharp `contain` composite onto RGB(255,255,255), aspect ratio preserved, JPEG, no watermark. Sharp external (layer).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
- [x] 11. `image-packager` Lambda (per-channel resize/crop + upscale flag)
  - `processors/packager.ts` + `utils/channel-specs.ts`: Takealot 1000², Amazon 1600², Makro 800², Shopify 2048², WooCommerce 800², Custom 1200²; `contain` + cubic kernel (bicubic) upscale + `upscaled` flag; variants written to assets.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
- [x] 12. `image-persist` Lambda (canonical `content.imageRefs` write)
  - `processors/persist.ts`: `buildImageRefs` → `CanonicalImageRef[]`; tenant-conditioned `UpdateCommand SET content.imageRefs` on the unified G07 Products table (scoped IAM, G09 pattern); job COMPLETED; also the RECORD_FAILURE recorder.
  - _Requirements: 4.5_
- [x] 13. Step Functions Express `ImageProcessingWorkflow`
  - In `image-intelligence-stack.ts`: Moderate → Choice(passed? RemoveBackground : Quarantine) → PackageVariants → PersistImageRefs → Succeed; HandleImageFailure (persist RECORD_FAILURE) + Fail; retries (transient + S3) and `addCatch` on each step; EXPRESS; LogGroup (ERROR, exec data); X-Ray; 15-min timeout. `start-process` starts the execution (ARN via env, grantStartExecution). _(Enhance step added in Phase 4.)_
  - _Requirements: 7.1, 7.2, 7.3_
- [x] 14. Events + CloudWatch metrics
  - `utils/event-emitter.ts` (`ImageProcessingCompleted`/`Failed`/`ModerationRejected`) + `utils/metrics.ts` (`countMetric` + `IMAGE_METRICS`: moderationRejected, jobFailed, jobCompleted, enhancement*).
  - _Requirements: 7.2, 7.3, 7.5_
- [x]* 15. Unit tests (21 pass): moderation threshold/label mapping/de-dup, channel specs + upscale math, `buildImageRefs` canonical shape, status transition validity + conditional-write/illegal-transition guard.

> **Phase 2 notes:** Sharp layer provisioned (`layers/sharp`, built in CI; `--external:sharp` confirmed in synth for background-removal + packager). Sharp-dependent processing logic is validated via the pure-function tests (`isUpscaleRequired`, moved to `channel-specs.ts` so tests don't import the native lib); full Sharp image I/O is exercised at the Phase 8 dev checkpoint. Task #4 (HEIC layer) still pending — HEIC decode support to be added to the Sharp layer build or a separate layer before the checkpoint.

## Phase 3 — CloudFront signed-URL delivery ✅ COMPLETE (verified: infra tsc 0; 25 unit tests pass; synth verification below)

- [x] 16. CloudFront distribution over private assets bucket
  - `cloudfront.Distribution` with `trustedKeyGroups` (signed URLs required), REDIRECT_TO_HTTPS, CACHING_OPTIMIZED, GET/HEAD. Origin keeps the assets bucket private. SSM-exports CloudFront domain + signing-key secret ARN.
  - **Follow-up:** this CDK version (2.155) provides `S3Origin` (Origin Access **Identity**), not the newer `S3BucketOrigin.withOriginAccessControl` (OAC). OAI keeps the bucket private too; migrate to OAC on CDK upgrade. Documented in-stack.
  - _Requirements: 4.6, 4.7, 8_
- [x] 17. Key group + Secrets Manager signing key
  - `cloudfront.PublicKey` + `KeyGroup`; private key in `secretsmanager.Secret` (`merch-os/{env}/image-signing-private-key`, secrets-KMS encrypted, RETAIN). Public key PEM supplied via CDK context at deploy (placeholder keeps synth working). Key-pair id + secret id passed to the Lambda via env → rotatable with no code change.
  - _Requirements: 4.7, 8 (item 8)_
- [x] 18. `image-signed-url` Lambda + `GET /v1/images/{imageId}/url/{channel}`
  - `handlers/signed-url.ts`: `@aws-sdk/cloudfront-signer` getSignedUrl, 1-hour TTL, reads private key from Secrets Manager (cached), channel validation, tenant-scoped object path. Scoped IAM: SecretsManager GetSecretValue on the one secret + KMS Decrypt. Route added with JWT authorizer.
  - _Requirements: 4.6, 4.7_
- [x]* 19. Unit tests (4): tenant-required 401, unsupported-channel 400, missing-params 400, missing-config 500. (Signing with a real key is exercised at the Phase 8 dev checkpoint.)
- [x] 20. Key-rotation runbook — `docs/architecture/image-signing-key-rotation-runbook.md` (zero-downtime multi-key overlap procedure + emergency revocation).

## Phase 4 — AI enhancement (G02, Stable Image Inpaint) ✅ COMPLETE (verified: infra tsc 0; 34 unit tests pass; synth below)

- [x] 21. `imageEnhancementModel` adapter + config/region gating
  - `services/enhancement-model.ts`: single Bedrock abstraction; `getEnhancementModelId()` from `IMAGE_ENHANCEMENT_MODEL_ID` (default `stability.stable-image-inpaint-v1:0`); `isEnhancementEnabled()` from `IMAGE_ENHANCEMENT_ENABLED` (off unless `true`). Swapping models = config + IAM change (blueprint §14).
  - _Requirements: 5.2, 5.3, 9 (adapter)_
- [x] 22. `image-enhance` Lambda (Bedrock Stable Image Inpaint, image-conditioned)
  - `processors/enhance.ts`: reads deterministic hero from assets, invokes the model conditioned on it (image-to-image, `search-and-replace`), overwrites the hero; original source preserved in raw-uploads. Scoped Bedrock `InvokeModel` IAM on ONLY the configured model ARN. Stack: enhanceFn (1024MB/120s) + env (model id + enabled flag).
  - _Requirements: 5.1, 5.2, 5.4, 5.6, 8.3_
- [x] 23. Wire EnhanceDecision (auto-detect weak) + fallback on failure/timeout
  - Workflow: RemoveBackground → **EnhanceHero** → PackageVariants. `shouldEnhance(weak)` = weak photo (bg-removal `reviewRecommended`) AND feature enabled; otherwise skip with reason. On model failure → keep deterministic hero, record `skippedReason`, **never fail the job** (no addCatch to HandleFailure). Metrics: enhancementInvoked / enhancementFailed.
  - _Requirements: 5.1, 5.5_
- [x]* 24. Unit tests (9): model-id default/pluggable, enabled-flag parsing, shouldEnhance matrix, skip-not-weak / skip-disabled / fallback-on-failure / applied-on-success. Bedrock ARN scoping verified via synth.

## Phase 5 — Image sourcing (G03) ✅ COMPLETE (verified: infra tsc 0; 42 unit tests pass; synth below)

- [x] 25. Supplier-URL image sourcing (reuses Supplier Intelligence extractor)
  - `processors/source-url.ts`: fetches the supplier's OWN product page (User-Agent `MerchOS-Crawler/1.0`), reuses `extractProductsFromHtml` (JSON-LD / og:image / `<img>` selectors, `downloadImages:false`) to discover image URLs, downloads them into **raw-uploads** as source images (`images/{tenantId}/{productId}/source/{uuid}.{ext}`), creates an Image_Job, and starts the standard ImageProcessingWorkflow. Stack: `SourceUrl` Lambda (512MB/120s), raw-uploads PutObject + image-jobs RW IAM, grantStartExecution + env.
  - _Requirements: 6.1, 6.2, 6.3_
- [x] 26. Supplier-domain-only guard + no-image handling
  - `isSameOrigin(imageUrl, pageUrl)` filters to the supplier's own origin — third-party/CDN/arbitrary-web images are **rejected** (no general scraping, requirement 6.2/6.4). No usable images → Image_Job `COMPLETED` with `reviewRecommended: true` (flagged for manual attention), **never FAILED** (requirement 6.5). Max 15 images/product.
  - _Requirements: 6.4, 6.5_
- [x]* 27. Unit tests (8): same-origin accept / third-party reject / scheme+subdomain strict / malformed-safe; discover de-dupes + excludes third-party + empty-on-none; sourceSupplierImages downloads to correct raw-uploads key + zero-key no-image case.

> **Phase 5 note:** uses a single supplier product-page fetch + the existing extractor rather than the full BFS `url-crawler` construct — appropriate for per-product image sourcing and avoids standing up crawler infra in this stack. The crawler's robots.txt/rate-limit/circuit-breaker apply on the Supplier Intelligence URL-import path that triggers this; broad multi-page crawling for images remains out of scope (third-party scraping deferred).

## Phase 6 — RBAC + docs ✅ COMPLETE (verified: rbac tsc clean for touched files, 135 rbac tests pass)

- [x] 28. Add `images` resource/actions to `@merch-os/rbac`
  - `packages/rbac/src/config.ts`: added `{ resource: 'images', actions: ['create','read','update','delete'] }` to **Seller** (own-tenant) and **Admin** (full). Support intentionally excluded (read-oriented cross-tenant scope; images not in its troubleshooting set). Handlers use `images.create` (upload/process) and `images.read` (get/signed-url) — both now resolve. 3 new registry tests (Seller full / Admin full / Support denied); all 135 rbac tests pass.
  - _Requirements: 8.1_
- [x] 29. Update blueprint permission matrix + endpoint metadata
  - `docs/architecture/merchos-blueprint.md` §3.4 (AI Domain): added `images` Read/Create/Update/Delete rows (Seller 🔒 / Support ❌ / Admin ✅), matching `defaultPermissionConfig` (consistency requirement satisfied), plus a note mapping each Image_API endpoint to its required permission.
  - _Requirements: 8.1_

> **Phase 6 note:** this clears the carried "images RBAC registration" follow-up from Phases 1–5 — the engine's HTTP endpoints now authorize at runtime instead of denying. The 3 pre-existing `integration.test.ts` tsc strictness errors (confirmed via git-stash baseline) are unrelated to this change.

## Phase 7 — Seller Dashboard UI (Option B) ✅ COMPLETE (verified: api-client tsc 0, dashboard tsc 0, 18 dashboard tests pass)

> **Integration decision (Option 1):** the dashboard already had a `ProductImageGallery` wired to the OLD synchronous image model (`useImageUpload`/`useSetHeroImage` → `POST /products/{id}/images`). Rather than duplicate, those hooks were **removed** and the gallery **rewired** to the Image Intelligence Engine's async flow. Only consumer was `ImageGallery.tsx` (clean blast radius).

- [x] 30. Images section on product detail page
  - `ProductImageGallery` remains the "Images" section on `(dashboard)/products/[productId]`, now driven by the engine.
  - _Requirements: 1.5, 4.6_
- [x] 31. Uploader (presign → PUT → process)
  - `ImageGallery.tsx`: `FileUpload` (JPEG/PNG/WEBP/HEIC, 10 MB), then presigned S3 PUT (direct browser→S3), then start processing. editor+ role gating; at-limit (15) guard.
  - _Requirements: 1.1, 1.3, 1.4, 1.5_
- [x] 32. Data hooks (TanStack Query) — `packages/api-client/src/hooks/useImageIntelligence.ts`
  - `useRequestUploadUrl`, `useStartImageProcessing`, `useImageJob` (polls every 2s, stops on terminal status), `useImageSignedUrl` (~55-min cache). Exported from api-client index; old `useImageUpload`/`useSetHeroImage` removed.
  - _Requirements: 7.1_
- [x] 33. `ImageJobStatus` + variant gallery
  - `ImageJobStatus` renders QUEUED/PROCESSING/COMPLETED/FAILED/REJECTED; `VariantThumbnail` resolves CloudFront signed URLs per variant.
  - _Requirements: 4.6, 7.1_
- [x] 34. Badges / indicators / review surfacing
  - `ModerationBadge` (existing processed images), moderation-reject reasons, upscaled indicator, enhancement-applied note, reviewRecommended warning. (Hero selection is now a product-level concern; AI enhancement is an engine auto-decision + env flag rather than a per-image UI toggle — see note.)
  - _Requirements: 2.4, 3.4, 4.3, 5.1_
- [x]* 35. Frontend tests (RTL, 8): role gating (editor shows / viewer hides uploader), empty state, job-status render states (processing / rejected-with-reason / review-recommended / enhancement-applied / failed).
- [x] 36. Accessibility pass
  - `aria-live="polite"` region around job status, labelled uploader button, `role="list"`/`listitem` on galleries, `figure`/`figcaption` + alt text on variant thumbnails.
  - _Requirements: (accessibility compliance)_

> **Phase 7 notes:** (1) `EnhanceControl` as a per-image seller toggle was NOT added — enhancement is auto-triggered for weak photos and gated by the deployment feature flag (design decision #2 auto-detect + env), so a per-image override is deferred; the UI surfaces whether enhancement was applied. (2) `HeroImageSelector` UI deferred — hero is position-0 in `content.imageRefs` set by the engine; explicit re-designation is a product-update follow-up. (3) `useImageSignedUrl` is called from `VariantThumbnail` with an `imageId`; wiring the exact imageId for already-persisted `content.imageRefs` entries is finalized at the Phase 8 dev checkpoint against real data.

## Phase 8 — Checkpoint

- [ ] 37. End-to-end verification in `dev`
  - Deploy stack; upload HEIC + PNG; verify white-background hero, all channel variants in S3, signed URLs resolve, upscaled flag correct, moderation reject → quarantine, enhancement applied on a weak photo + fallback on forced failure, supplier-URL sourcing. Run all backend + frontend tests. Ask the user if questions arise.
  - _Requirements: all_
