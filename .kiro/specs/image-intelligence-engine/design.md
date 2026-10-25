# Image Intelligence Engine — Design

> **Status:** Draft — awaiting approval
> **Requirements:** `./requirements.md`
> **Gaps addressed:** G01 (pipeline), G02 (Stable Image Inpaint enhancement), G03 (supplier-URL image sourcing)

## 1. Overview

The Image Intelligence Engine is a new serverless subsystem that turns a merchant-supplied product photo into a moderated, white-background hero image plus per-channel variants, served privately via CloudFront signed URLs. It follows the established MerchOS architecture: a dedicated CDK stack, Node.js 20 ESM Lambdas with Powertools, a Step Functions Express workflow for orchestration (mirroring Supplier Intelligence), tenant-isolated DynamoDB, Foundation S3/KMS/EventBridge, and middy middleware for RBAC + tenant isolation.

Processing is **deterministic-first**: Rekognition (subject + moderation) and the Sharp library (crop/resize/composite) always produce a usable result. Stability AI **Stable Image Inpaint** on Bedrock is an **optional, config-gated enhancement** for weak photos; if it is unavailable or fails, the engine falls back to the deterministic output.

## 2. Architecture

```
Seller/Supplier
      │  (upload or URL-sourced)
      ▼
Image_API (HTTP API + Cognito JWT, tenant isolation)
  POST /v1/images/upload           → presigned S3 PUT (raw-uploads)
  POST /v1/images/{productId}/process → start Image_Job
  GET  /v1/images/{imageId}        → metadata + per-channel keys
  GET  /v1/images/{imageId}/url/{channel} → CloudFront signed URL
      │
      ▼
Step Functions (Express) — ImageProcessingWorkflow
  Validate → Moderate(Rekognition) ──reject──▶ Quarantine + event
      │ pass
      ▼
  RemoveBackground(Rekognition+Sharp) → [weak? → EnhanceInpaint(Bedrock)]
      ▼
  PackageVariants(Sharp, per channel) → PersistRefs(DynamoDB + content.imageRefs)
      ▼
  EmitCompleted(EventBridge)
      │
Data: DynamoDB (Image_Job), S3 raw-uploads (source), S3 assets (variants/quarantine)
Delivery: CloudFront (OAC → private assets bucket) + signed URLs (key group)
```

**AWS services:** Lambda, Step Functions (Express), Rekognition, Amazon Bedrock (Stable Image Inpaint), S3 (Foundation raw-uploads + assets), DynamoDB, CloudFront, EventBridge, KMS, Secrets Manager (signing key), CloudWatch.

## 3. CDK Stack: `ImageIntelligenceStack`

New file `infrastructure/lib/image-intelligence-stack.ts`, wired in `bin/merch-os.ts` after Foundation/Auth (it imports Foundation values via SSM, same pattern as Product Intelligence / Supplier Intelligence).

Provisions:
- **DynamoDB** `merch-os-image-jobs-{env}` — PK `TENANT#{tenantId}`, SK `IMAGEJOB#{imageJobId}`; GSI1 by product (`GSI1PK=TENANT#{t}#PRODUCT#{productId}`, `GSI1SK=IMAGEJOB#CREATED#{ts}`); TTL `ttl`. PAY_PER_REQUEST, customer-managed KMS, PITR, RETAIN.
- **Lambda layers** `sharp-layer` and `heic-convert-layer` (Sharp needs a native binary layer; HEIC conversion layer for Apple formats).
- **Lambdas** (Node 20 ESM, Powertools, X-Ray): `image-ingest`, `image-moderation`, `image-background-removal`, `image-enhance` (Bedrock), `image-packager`, `image-persist`, `image-signed-url`, plus API handlers `start-process`, `get-image`, `upload-url`.
- **Step Functions Express** `ImageProcessingWorkflow` (see §5).
- **CloudFront distribution** with Origin Access Control over the private `assets` bucket + a **key group** for signed URLs (see §7).
- **HTTP API** with Cognito JWT authorizer and the routes in §6; stage throttling consistent with other stacks.
- **IAM**: per-Lambda least-privilege (see §8).
- **SSM exports**: image-jobs table name, CloudFront domain, distribution id.

Foundation values imported via SSM: platform KMS key, secrets KMS key, EventBridge bus name/arn, raw-uploads bucket, assets bucket.

## 4. Data Model

### 4.1 Image_Job (DynamoDB)

```
PK            TENANT#{tenantId}
SK            IMAGEJOB#{imageJobId}
GSI1PK        TENANT#{tenantId}#PRODUCT#{productId}
GSI1SK        IMAGEJOB#CREATED#{iso}
imageJobId, tenantId, productId
status        QUEUED | PROCESSING | COMPLETED | FAILED | REJECTED
sourceKeys    string[]            // raw-uploads S3 keys
heroImageId   string | null
variants      { channel, s3Key, width, height, upscaled }[]
moderation    { passed: boolean, rejectedLabels?: string[] }
enhancement   { attempted: boolean, applied: boolean, skippedReason?: string }
reviewRecommended boolean
error         { code, message } | null
createdAt, updatedAt, ttl
```

### 4.2 Canonical product linkage (reuses G07 unified model)

On success, the engine writes `CanonicalImageRef[]` to the product's `content.imageRefs` via the **same Products table and GSI1 layout** unified in G07 (no divergent write path). Each ref:

```
imageId, s3Key, position, altText, mimeType, width, height, fileSize, variantId
```

The engine updates `content.imageRefs` with a tenant-conditioned write; it does not touch `commercial`/`platformSpecific`.

### 4.3 S3 layout

```
raw-uploads:  images/{tenantId}/{productId}/source/{imageId}.{ext}      (never overwritten)
assets:       images/{tenantId}/{productId}/{channel}/{imageId}.jpg      (variants)
assets:       images/{tenantId}/quarantine/{imageId}_{ts}.{ext}          (rejected, 30-day lifecycle)
```

## 5. Step Functions — ImageProcessingWorkflow (Express)

States (mirrors the Supplier Intelligence workflow conventions, with retries/catch):

1. **ValidateInput** — format/size recorded (hard format/size rejection already happened at the API edge); set job `PROCESSING`.
2. **Moderate** (`image-moderation`) — Rekognition `DetectModerationLabels`. Disallowed label ≥ 0.80 → **Choice** routes to **Quarantine** (move to quarantine prefix, job `REJECTED`, emit `ImageModerationRejected`) → terminal.
3. **RemoveBackground** (`image-background-removal`) — Rekognition subject detection + Sharp composite onto white. Low confidence → set `reviewRecommended` and (optionally) mark as weak.
4. **EnhanceDecision** (Choice) — if weak AND enhancement enabled → **EnhanceInpaint**; else skip.
5. **EnhanceInpaint** (`image-enhance`) — Stable Image Inpaint on Bedrock, conditioned on the source. On failure/timeout → **catch** falls back to the deterministic hero (record `enhancement.skippedReason`), never fails the job.
6. **PackageVariants** (`image-packager`) — Sharp resize/crop per channel (Takealot 1000², Amazon 1600², Makro 800², Shopify 2048², WooCommerce 800², Custom 1200²); bicubic upscale + `upscaled` flag when below min.
7. **PersistRefs** (`image-persist`) — write variants to assets S3, update `content.imageRefs` on the product, job `COMPLETED`.
8. **EmitCompleted** — EventBridge `ImageProcessingCompleted`.

Failure path: any state catch → **HandleFailure** (job `FAILED`, emit `ImageProcessingFailed`, retain source) → Fail. Retries: transient Lambda errors ×3; DynamoDB throttling with jitter; Bedrock throttling ×3. Express workflow (fast, high-volume), 15-min timeout, CloudWatch logs (ERROR), X-Ray on.

**Why the enhancement runs here, not in a synchronous API call:** per requirement 7.4 and the G11 lesson, the long/variable AI step runs inside Step Functions (tolerant of >29s), not behind the 29s HTTP API cap. The API `start-process` call returns immediately with a jobId.

## 6. API (HTTP API v2 + Cognito JWT)

| Method & path | Purpose | Auth |
|---|---|---|
| `POST /v1/images/upload` | Return presigned S3 PUT URL (raw-uploads, tenant-scoped key) | JWT, tenant-scoped |
| `POST /v1/images/{productId}/process` | Start an Image_Job (returns `202 {imageJobId}`) | JWT, tenant-scoped, ownership of product |
| `GET /v1/images/{imageJobId}` | Job status + per-channel keys/metadata | JWT, tenant-scoped |
| `GET /v1/images/{imageId}/url/{channel}` | Mint a 1-hour CloudFront signed URL | JWT, tenant-scoped |

All protected by `rbacMiddleware` + `tenantContextMiddleware`. RBAC resource `images`, actions `read`/`write` — to be added to the `@merch-os/rbac` permission registry and the blueprint permission matrix (consistency requirement).

## 7. CloudFront + Signed URLs (full scope)

- **Distribution** with **Origin Access Control (OAC)** to the private `assets` bucket. Bucket stays `BLOCK_ALL` public access; an OAC bucket policy grants only the distribution read access. No public S3 exposure (requirement 4.6/8).
- **Signed URLs via a CloudFront key group**: an RSA key pair; the **public key** registered in a CloudFront `PublicKey` + `KeyGroup`; the **private key** stored in **Secrets Manager** (encrypted with the Foundation secrets KMS key).
- **`image-signed-url` Lambda** reads the private key from Secrets Manager (key id from config/env, not hardcoded), signs a URL with 1-hour TTL, and returns it. Key id is configuration so the key can be **rotated without a code change** (requirement 8 item 8).
- **Caching**: default TTL tuned for immutable processed assets (long cache, cache-busting by `{imageId}` key).
- **Operational note (design-level):** key rotation is a documented runbook step — generate new key pair, add the new public key to the key group, switch the Secrets Manager secret, retire the old key after TTL. Flagged as a real operational dependency.

## 8. Security & IAM (least privilege per Lambda)

| Lambda | Permissions |
|---|---|
| image-ingest / upload-url | S3 PutObject on `raw-uploads/images/{tenant}/*`; KMS |
| image-moderation | Rekognition `DetectModerationLabels` (`*` — no resource-level perms); S3 get source; DynamoDB job RW |
| image-background-removal | Rekognition `DetectLabels`/subject; S3 get/put; KMS |
| image-enhance | Bedrock `InvokeModel` on **only** the configured Stable Image Inpaint model ARN; S3 get/put; KMS |
| image-packager | S3 get/put assets; KMS |
| image-persist | DynamoDB job RW + Products table RW (scoped ARN, G09-style); EventBridge PutEvents |
| image-signed-url | SecretsManager GetSecretValue on the signing-key secret; KMS |

Tenant isolation enforced in middleware via JWT `custom:tenantId`; all S3 keys and DynamoDB items tenant-scoped. KMS encryption via Foundation platform key for all stored objects.

## 9. Model Adapter (future-proofing, blueprint §14)

A single `imageEnhancementModel` abstraction wraps the Bedrock image call: `{ modelId, invoke(sourceImage, mask/params) }`. `modelId` comes from config (default: Stable Image Inpaint). The IAM policy references the same configured ARN. Swapping to Titan Image Generator / Stable Diffusion 3.5 / a future model is a config + IAM change, not a rewrite — and the feature flag can disable enhancement entirely per environment/region.

## 10. Image Sourcing (G03) integration

`image-ingest` accepts a `sourceUrlImages` mode used by the Supplier Intelligence URL-import path: the existing `url-crawler` discovers product image URLs **on the supplier's own domain only** (honouring robots.txt/same-origin/rate-limit/circuit-breaker), downloads them into raw-uploads as Source_Images, and hands off to the same Step Functions workflow. No new crawling logic; no third-party/general-web scraping (out of scope). If a product yields no images, it is flagged for manual attention, not failed.

## 10a. Seller Dashboard UI (frontend — in scope, Option B)

The frontend lives in `apps/seller-dashboard` and follows existing conventions: a route under the `(dashboard)` group, client components, co-located `components/`, TanStack Query for data fetching, Zustand for local UI state, and the shared `@merch-os/ui` component library (Radix + Tailwind). All calls go through the existing `@merch-os/api-client` against the Image_API with the Cognito bearer token.

**Route & surfaces:**
- Image management is surfaced **on the product detail page** (`(dashboard)/products/[productId]`) as an "Images" section/tab, since images belong to a product. A thin `(dashboard)/products/[productId]/images` sub-route may host the gallery if the page grows.

**Components (co-located under the product images section):**
- `ImageUploader` — drag-and-drop / file-picker; validates format (JPEG/PNG/WEBP/HEIC) and 10 MB client-side before requesting a presigned URL; uploads directly to S3 via the presigned PUT; then calls `POST /v1/images/{productId}/process`.
- `ImageJobStatus` — polls `GET /v1/images/{imageJobId}` (TanStack Query with refetch interval) showing `QUEUED → PROCESSING → COMPLETED/FAILED/REJECTED`; surfaces moderation rejection reason.
- `ImageGallery` — thumbnails of the hero + per-channel variants, each loaded via a short-lived CloudFront signed URL from `GET /v1/images/{imageId}/url/{channel}`.
- `ModerationBadge` — APPROVED / REJECTED / PENDING badge on each thumbnail (reuses `@merch-os/ui` Badge).
- `HeroImageSelector` — designate an APPROVED image as hero; blocks selection of REJECTED/PENDING (mirrors the platform-spec rule).
- `UpscaledIndicator` — marks variants that were upscaled, with the channel that triggered it.
- `EnhanceControl` — explicit seller override to request/skip AI enhancement (design decision #2: auto-detect weak photos with a seller override).

**Data hooks (TanStack Query):** `useRequestUploadUrl`, `useStartImageProcessing`, `useImageJob(imageJobId)` (polling), `useImageSignedUrl(imageId, channel)`.

**Accessibility:** uploader keyboard-operable, status changes announced via ARIA live region, badges have text alternatives (accessibility-compliance requirement).

**State:** ephemeral upload/progress state in a small Zustand store or local state; server state via TanStack Query (no duplication of server data in client stores).

## 11. Testing Strategy

- **Backend unit (vitest + aws-sdk-client-mock):** moderation decision (threshold 0.80, label mapping), Sharp resize/crop math + upscale flagging, hero composite params, enhancement fallback-on-failure, signed-URL TTL/shape, `content.imageRefs` write shape (canonical, G07-consistent).
- **Workflow:** state transitions incl. moderation-reject → quarantine, enhance-skip path, failure path.
- **IAM/synth:** `cdk synth` of the new stack; assert Bedrock ARN scoping and OAC bucket policy.
- **Frontend (vitest + React Testing Library):** uploader validation (format/size rejection), hero-selection blocked for non-APPROVED images, job-status polling render states, moderation/upscaled badges, signed-URL hook. Accessibility assertions (roles, ARIA live region).
- Follows the established mock-injection pattern (`setDynamoClient`, etc.) and the app's existing component-test setup.

## 12. Phasing (implementation order for tasks.md)

1. **Phase 1 — Foundations:** CDK stack skeleton, DynamoDB, S3 prefixes/lifecycle, Sharp/HEIC layers, API + job model, upload presign. (Deterministic, no AI yet.)
2. **Phase 2 — Deterministic pipeline (G01):** moderation, background removal, per-channel variants, persist `content.imageRefs`, events/metrics, Step Functions.
3. **Phase 3 — CloudFront delivery:** distribution + OAC + key group + Secrets Manager key + signed-URL Lambda/endpoint.
4. **Phase 4 — AI enhancement (G02):** `image-enhance` with Stable Image Inpaint, config/region gating, fallback.
5. **Phase 5 — Image sourcing (G03):** URL-crawler hand-off for supplier-own-domain images.
6. **Phase 6 — RBAC + docs:** `images` permissions in `@merch-os/rbac` + blueprint matrix.
7. **Phase 7 — Seller Dashboard UI (G01–G03 frontend, Option B):** product-detail Images section — uploader, job-status polling, variant gallery via signed URLs, moderation/hero/upscaled/enhance controls, data hooks, component tests, accessibility.

Each phase is independently deployable and verified (backend: tsc + unit tests + cdk synth; frontend: tsc + RTL tests + build), consistent with the gap-fix workflow.

## 13. Open design questions for approval

1. **CloudFront key management** — RESOLVED: Secrets Manager for the private key with a manual rotation runbook.
2. **Enhancement trigger** — RESOLVED: auto-detect "weak" photos (low background-removal confidence / low contrast) to trigger Inpaint, with a seller override (`EnhanceControl`).
3. **Sharp delivery** — RESOLVED: Lambda layer (`sharp-layer`), matching the platform design.
4. **Seller Dashboard UI** — RESOLVED (Option B): the frontend image-management UI **is** part of this build, surfaced on the product detail page (§10a, Phase 7).
