# Image Intelligence Engine — Requirements

> **Status:** Draft — awaiting approval
> **Spec type:** Feature (requirements-first)
> **Gaps addressed:** G01 (image pipeline), G02 (AI image enhancement), G03 (image sourcing)

## Introduction

The Image Intelligence Engine extends MerchOS with end-to-end product-image processing. Today the platform only reads text off supplied images (Textract OCR in Supplier Intelligence) and has no capability to produce clean, marketplace-ready imagery. This engine takes a merchant-supplied product photo and produces a compliant image set per sales channel: a white-background hero image, per-channel resized/cropped variants, and content-moderated output stored in S3 and served via CloudFront.

The engine is **image-to-image only**: it always operates on a real image the merchant (or their supplier) provides. It never fabricates a product image from a text prompt alone. Processing follows a deterministic baseline (AWS Rekognition for subject/moderation + the Sharp library for crop/resize/composite) with an **optional AI enhancement booster** (Stability AI **Stable Image Inpaint** on Amazon Bedrock) for weak photos — background replacement and cleanup conditioned on the merchant's real image.

The engine integrates with the existing MerchOS platform: the canonical `CanonicalProduct` model (images live as `content.imageRefs`), the EventBridge event bus, tenant-isolated DynamoDB, the Foundation S3 buckets (raw-uploads, assets), KMS encryption, and the middy-based Lambda middleware with RBAC/tenant-isolation. Image sourcing reuses the Supplier Intelligence URL crawler to pull legitimate product images from a supplier's own site.

## Glossary

- **Image_Engine**: The backend subsystem that processes source images into channel-ready image sets, applies moderation, and manages image assets.
- **Source_Image**: A merchant- or supplier-provided product image that is the input to all processing. Never AI-fabricated from scratch.
- **Hero_Image**: The primary product image rendered on a pure white background (RGB 255,255,255), derived from a Source_Image via background removal.
- **Image_Variant**: A resized/cropped rendition of a Hero_Image or gallery image meeting a specific Channel's pixel requirements.
- **Channel**: A target marketplace (Takealot, Amazon, Makro, Shopify, WooCommerce) with its own image specifications.
- **Moderation_Check**: Rekognition `DetectModerationLabels` evaluation that rejects disallowed content.
- **Enhancement_Step**: The optional AI booster using Stability AI Stable Image Inpaint on Bedrock to clean up or replace the background of a weak Source_Image, conditioned on that image.
- **Image_Source_Crawl**: Reuse of the Supplier Intelligence URL crawler to discover and download legitimate product images from a supplier's own website.
- **Image_Job**: A single unit of image-processing work for one or more Source_Images tied to a product and tenant.
- **Quarantine**: Tenant-scoped S3 storage where moderation-rejected images are retained for a fixed window.
- **Image_API**: The HTTP API Gateway endpoints exposing image upload, processing status, and result retrieval.
- **CanonicalProduct**: The authoritative MerchOS product model; processed images are referenced via `content.imageRefs` (`CanonicalImageRef`).

## Requirements

### Requirement 1: Source Image Intake

**User Story:** As a seller, I want to upload one or more product images for a product, so that MerchOS can produce marketplace-ready imagery from them.

#### Acceptance Criteria

1. THE Image_Engine SHALL accept Source_Images in JPEG, PNG, WEBP, and HEIC formats and produce output in JPEG and PNG.
2. WHEN a seller uploads a Source_Image, THE Image_API SHALL store the original in the raw-uploads S3 bucket under the tenant-scoped prefix `images/{tenantId}/{productId}/source/` and never delete or overwrite it.
3. IF an uploaded image exceeds 10 MB, THEN THE Image_API SHALL reject it with a 413 response and a descriptive error.
4. IF an uploaded file is not a supported image format, THEN THE Image_API SHALL reject it with a 400 response identifying the unsupported format.
5. WHERE a seller provides multiple Source_Images for a product, THE Image_Engine SHALL treat the first as the Hero_Image candidate and the remainder as gallery images.
6. WHEN a Source_Image is accepted, THE Image_Engine SHALL create an Image_Job scoped to the tenant with status `QUEUED`.
7. THE Image_API SHALL require a valid Cognito JWT and enforce tenant isolation; a seller SHALL only process images for products within their own tenant.

### Requirement 2: Content Moderation (Rekognition)

**User Story:** As a platform operator, I want uploaded images screened for disallowed content, so that MerchOS never publishes policy-violating imagery to marketplaces.

#### Acceptance Criteria

1. WHEN a Source_Image enters processing, THE Image_Engine SHALL run a Moderation_Check using Rekognition `DetectModerationLabels` before any other processing.
2. IF the Moderation_Check returns a disallowed label (nudity, violence, or other marketplace-policy-violating category) with confidence ≥ 0.80, THEN THE Image_Engine SHALL reject the image and SHALL NOT produce any Image_Variant from it.
3. WHEN an image is rejected by moderation, THE Image_Engine SHALL move it to Quarantine under `images/{tenantId}/quarantine/`, retain it for 30 days via an S3 lifecycle rule, and emit a `merch-os.image-intelligence` event with detail-type `ImageModerationRejected`.
4. WHEN an image is rejected by moderation, THE Image_Engine SHALL record the rejection reason on the Image_Job and surface it to the seller.
5. THE Image_Engine SHALL NOT send an image to the Enhancement_Step or produce variants until the Moderation_Check passes.

### Requirement 3: Hero Image Generation (Deterministic Baseline)

**User Story:** As a seller, I want a clean white-background hero image generated from my photo, so that my listings meet marketplace hero-image standards without manual editing.

#### Acceptance Criteria

1. WHEN a moderated Source_Image is processed, THE Image_Engine SHALL detect the product subject using Rekognition and composite it onto a pure white background (RGB 255,255,255) using the Sharp library to produce a Hero_Image.
2. THE Image_Engine SHALL preserve the product's aspect ratio and SHALL NOT distort the subject when producing the Hero_Image.
3. THE Image_Engine SHALL produce the Hero_Image without watermarks.
4. WHERE background removal confidence is below a configured threshold, THE Image_Engine SHALL flag the Hero_Image as `reviewRecommended` on the Image_Job rather than silently producing a low-quality result.
5. THE deterministic baseline (Rekognition + Sharp) SHALL be the default path and SHALL NOT require the Enhancement_Step to produce a Hero_Image.

### Requirement 4: Per-Channel Variants

**User Story:** As a seller, I want channel-specific image variants generated automatically, so that one upload satisfies every marketplace's size rules.

#### Acceptance Criteria

1. THE Image_Engine SHALL resize and crop the Hero_Image (and gallery images) to meet each target Channel's required pixel dimensions without distorting aspect ratio.
2. THE Image_Engine SHALL enforce these minimum resolutions: Takealot 1000×1000px, Amazon 1600×1600px, Makro 800×800px, Shopify 2048×2048px, WooCommerce 800×800px.
3. WHEN a Source_Image is below a Channel's minimum resolution, THE Image_Engine SHALL upscale using bicubic interpolation and flag the resulting Image_Variant as `upscaled`.
4. THE Image_Engine SHALL generate a watermark-free, marketplace-compliant image set per target Channel from a single Source_Image.
5. THE Image_Engine SHALL store each Image_Variant in the assets S3 bucket under `images/{tenantId}/{productId}/{channel}/` and record a `CanonicalImageRef` on the product's `content.imageRefs`.
6. THE Image_Engine SHALL serve processed images via CloudFront using signed URLs; it SHALL NOT expose the assets bucket publicly.
7. THIS feature SHALL provision the CloudFront distribution and signed-URL delivery for the assets bucket (per platform spec §25): a distribution with Origin Access Control reading the private `assets` bucket, a key group for URL signing, and a signed-URL issuance endpoint `GET /v1/images/{imageId}/url/{channel}` returning a 1-hour TTL signed URL.
8. THE signed-URL private key SHALL be stored in AWS Secrets Manager (encrypted with the Foundation secrets KMS key), SHALL NOT be committed to source or embedded in Lambda code, and SHALL support rotation without a code change (key id resolved from configuration).

### Requirement 5: AI Enhancement Booster (Stable Image Inpaint — optional)

**User Story:** As a seller with a poor-quality photo, I want MerchOS to clean it up, so that my listing image looks professional even when my source photo is weak.

#### Acceptance Criteria

1. WHERE a Source_Image is flagged as weak (e.g. cluttered background, low contrast, or background-removal confidence below threshold), THE Image_Engine MAY invoke the Enhancement_Step to clean up or replace the background.
2. THE Enhancement_Step SHALL use Stability AI **Stable Image Inpaint** on Amazon Bedrock, conditioned on the merchant's Source_Image, and SHALL NOT generate a product from a text prompt alone.
3. THE Enhancement_Step SHALL be configurable and region-gated: the model identifier SHALL be read from configuration, and the engine SHALL function with the Enhancement_Step disabled (falling back to the deterministic baseline) if the model is unavailable in the deployment region.
4. THE Image_Engine SHALL restrict Bedrock `InvokeModel` IAM permission to only the configured Stable Image Inpaint model ARN (least privilege), consistent with the multi-model pattern in blueprint §14.
5. IF the Enhancement_Step fails or times out, THEN THE Image_Engine SHALL fall back to the deterministic Hero_Image and SHALL record that enhancement was skipped, without failing the Image_Job.
6. THE Image_Engine SHALL retain both the original Source_Image and the enhanced result; enhancement SHALL NOT overwrite the original.

### Requirement 6: Image Sourcing from Supplier Websites (G03)

**User Story:** As a seller importing from a supplier URL, I want MerchOS to pull the supplier's own product images, so that products with missing imagery still get legitimate photos.

#### Acceptance Criteria

1. WHEN a URL-based import runs, THE Image_Engine SHALL reuse the Supplier Intelligence URL crawler to discover product images on the supplier's own site, honouring the crawler's existing robots.txt, same-origin, rate-limit, and circuit-breaker rules.
2. THE Image_Engine SHALL only source images from the supplier's own domain being imported; it SHALL NOT perform general web-image scraping across arbitrary third-party sites.
3. WHEN a product image is sourced from a supplier URL, THE Image_Engine SHALL download it into the raw-uploads bucket as a Source_Image and process it through the standard moderation → hero → variants pipeline.
4. WHERE copyright or licensing status of a sourced image cannot be established as the supplier's own, THE Image_Engine SHALL treat sourcing as out of scope and SHALL NOT ingest the image. (General web-image acquisition is explicitly deferred pending a licensing review.)
5. IF no images are found or downloadable for a product during a crawl, THEN THE Image_Engine SHALL record that the product has no imagery and leave it flagged for manual attention rather than failing the import.

### Requirement 7: Orchestration, Status & Events

**User Story:** As a seller, I want to track image-processing progress and have other parts of MerchOS react to completion, so that I know when my images are ready.

#### Acceptance Criteria

1. THE Image_Engine SHALL expose Image_Job status via the Image_API with states `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`, and `REJECTED` (moderation).
2. WHEN an Image_Job completes successfully, THE Image_Engine SHALL emit a `merch-os.image-intelligence` event with detail-type `ImageProcessingCompleted` carrying tenantId, productId, and the resulting image references.
3. WHEN an Image_Job fails, THE Image_Engine SHALL record the failure reason on the job and emit an `ImageProcessingFailed` event, retaining the original Source_Image.
4. THE Image_Engine SHALL complete processing of a single image to all Channel specifications within 30 seconds under normal load for the deterministic path; the Enhancement_Step MAY extend this and SHALL run on a path that tolerates longer processing (not a 29s-capped synchronous API call).
5. THE Image_Engine SHALL emit CloudWatch metrics for moderation rejections, enhancement invocations/failures, and job failures so operational drift is observable.

### Requirement 8: Security, Tenancy & Data Handling

**User Story:** As a platform operator, I want image processing to respect tenant isolation and least privilege, so that the feature upholds MerchOS security guarantees.

#### Acceptance Criteria

1. THE Image_Engine SHALL enforce tenant isolation on every operation using the authenticated JWT `custom:tenantId`; cross-tenant access to images SHALL be denied.
2. THE Image_Engine SHALL encrypt all stored images with the Foundation platform KMS key (consistent with existing bucket defaults).
3. THE Image_Engine SHALL grant each Lambda only the IAM permissions it needs (Rekognition detect/moderation, scoped S3 prefixes, scoped Bedrock model ARN, scoped DynamoDB, EventBridge PutEvents), following the least-privilege pattern used by other MerchOS stacks.
4. THE Image_Engine SHALL never log image binary content or signed-URL secrets; it SHALL reference assets by S3 key.
5. THE Image_Engine SHALL store Image_Job records with tenant-scoped keys (PK `TENANT#{tenantId}`) consistent with the platform's DynamoDB conventions.

## Out of Scope (this spec)

- Text-to-image generation (creating a product image from a prompt with no source photo).
- General web-image scraping from arbitrary third-party sites (deferred pending licensing review).
- Video processing.
- A full async submit→poll job API for the Product Intelligence text engine (tracked separately as G11 roadmap).

## Dependencies & Assumptions

- Stability AI **Stable Image Inpaint** is the chosen enhancement model on Bedrock; its availability in the deployment region (eu-west-1) must be confirmed at deploy time, and the engine degrades to the deterministic baseline if absent.
- Reuses existing Foundation resources (S3 raw-uploads/assets, KMS, EventBridge) and the Supplier Intelligence URL crawler.
- This feature **provisions** the CloudFront distribution + signed-URL delivery (Origin Access Control over the private assets bucket, key group, signed-URL Lambda/endpoint, 1-hour TTL), implementing the already-designed platform spec §25. No CloudFront exists in the deployed infra today.
- Images are referenced on the canonical product via `content.imageRefs` (`CanonicalImageRef`), consistent with the G07 unified data model.
