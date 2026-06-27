# Implementation Plan: MerchOS Platform

## Overview

MerchOS is implemented as a TypeScript monorepo using Turborepo, AWS CDK for all infrastructure, Lambda for compute, Step Functions for orchestration, and Next.js 14 for the two dashboards. Tasks are ordered so that each phase produces a deployable, independently testable slice of the platform. All Lambda functions are written in TypeScript; property-based tests use fast-check with a minimum of 100 iterations (`fc.configureGlobal({ numRuns: 100 })`).

---

## Tasks

## Phase 1: Foundation & Auth

- [ ] 1. Initialise monorepo and shared tooling
  - Create the root `merch-os/` monorepo with npm workspaces and Turborepo (`turbo.json`)
  - Add `tsconfig.base.json` with strict TypeScript settings shared across all packages
  - Add root ESLint config (TypeScript-aware), Prettier config, and `.editorconfig`
  - Add `package.json` scripts: `build`, `test`, `lint`, `synth`, `deploy:dev`
  - Create workspace packages: `infrastructure/`, `services/shared/`, `services/tenant/`, `apps/seller-dashboard/`, `apps/admin-dashboard/`
  - _Requirements: 17.1, 17.2_

- [x] 2. Implement shared TypeScript types and utilities
  - [x] 2.1 Create canonical TypeScript interfaces in `services/shared/types/`
    - Define `Product`, `Listing`, `Variant`, `ImageReference`, `EnrichedAttribute`, `ChannelContent`, `LifecycleState`, `LifecycleTransition`, `CategoryMapping`, `ComplianceReport`, `ExportRecord` interfaces
    - Define `Tenant`, `TenantSettings`, `WebhookConfig`, `ChannelIntegration` interfaces
    - Define `InventoryRecord`, `InventoryTransaction` interfaces
    - Define `ChannelId`, `PlanId`, `LanguageCode`, `EventType` union types
    - _Requirements: 14.1, 14.2_
  - [x] 2.2 Create DynamoDB client wrapper in `services/shared/utils/dynamo-client.ts`
    - Wrap `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` with tenant-scoped helpers
    - Enforce `ConditionExpression: TenantID = :callerTenantId` on all write operations
    - _Requirements: 1.3, 1.8_
  - [x] 2.3 Create Middy + Powertools middleware stack in `services/shared/middleware/`
    - Configure `Logger`, `Tracer`, `Metrics` from `@aws-lambda-powertools`
    - Create `withPowertools` Middy middleware factory used by all Lambda handlers
    - _Requirements: 16.7_

- [ ] 3. Implement CDK Foundation Stack
  - [x] 3.1 Create `infrastructure/lib/foundation-stack.ts`
    - Define KMS keys: `merch-os/platform`, `merch-os/secrets`, `merch-os/cloudtrail`
    - Create S3 buckets: `merch-os-raw-uploads`, `merch-os-assets`, `merch-os-exports`, `merch-os-invoices`, `merch-os-config`, `merch-os-ops`; all buckets: block public access, versioning enabled, S3 server-side encryption with KMS key
    - Create EventBridge custom bus `merch-os-events`
    - Export all resource ARNs and names to SSM Parameter Store under `/merch-os/{env}/`
    - Apply resource tags: `Environment`, `Subsystem`, `TenantScope`, `CostCenter`, `ManagedBy`
    - _Requirements: 17.1, 17.7, 14.8, 14.9, 14.10_
  - [ ] 3.2 Add CDK snapshot test for FoundationStack
    - Write `infrastructure/test/foundation-stack.test.ts` using `Template.fromStack()`
    - Verify KMS keys, S3 bucket policies, EventBridge bus, and SSM exports are synthesised correctly
    - _Requirements: 17.1_

- [ ] 4. Implement CDK Auth Stack and Cognito pools
  - [x] 4.1 Create `infrastructure/lib/auth-stack.ts`
    - Define `merch-os-tenant-pool`: custom attributes `tenantId` and `role`; password policy min 12 chars; advanced security mode; SAML IdP placeholder; app clients `seller-dashboard` (PKCE) and `api-gateway`
    - Define `merch-os-admin-pool`: MFA required (TOTP); app client `admin-dashboard` (PKCE); custom attribute `role = operator`
    - _Requirements: 2.1, 2.3, 2.9_
  - [ ] 4.2 Implement `cognito-post-confirmation-fn` Lambda
    - On user confirmation: write user record to DynamoDB `Tenants` table SK `USER#<userId>`; assign default `Viewer` role
    - Require email verification before writing record
    - _Requirements: 2.2, 2.5_
  - [ ] 4.3 Implement `cognito-pre-token-fn` Lambda
    - Inject `tenantId` and `role` claims into JWT access token via pre-token-generation trigger
    - _Requirements: 2.7_
  - [ ] 4.4 Implement `account-lockout-fn` Lambda
    - Count failed authentication events from Cognito trigger; lock account after 5 failures within 10 minutes
    - Send SES email to Tenant Owner on lockout
    - _Requirements: 2.11_

- [ ] 5. Implement Lambda authorizer and RBAC middleware
  - [ ] 5.1 Implement `api-authorizer-fn` Lambda
    - Validate JWT (RS256) from `Authorization: Bearer` header against Cognito JWKS endpoint
    - Reject with HTTP 401 on missing or expired token
    - Return IAM allow/deny policy; inject `tenantId` into request context
    - Block suspended tenants with HTTP 403
    - _Requirements: 1.4, 1.6, 2.7, 13.9_
  - [ ]* 5.2 Write property test for JWT validity window
    - **Property 5: JWT Access Token Validity Window** — for any issued token, `exp - iat ≤ 3600`
    - **Validates: Requirements 2.7**
    - File: `services/tenant/authorizer/__tests__/jwt-window.property.test.ts`
  - [ ] 5.3 Create RBAC middleware in `services/shared/middleware/rbac.ts`
    - Implement role × action matrix (Owner/Admin/Editor/Viewer) as defined in design
    - Return HTTP 403 with no side effects for denied actions
    - _Requirements: 2.5, 2.6_
  - [ ]* 5.4 Write property test for RBAC denial
    - **Property 4: RBAC Denial for Unauthorised Roles** — for any role R and action A where RBAC matrix marks R as not permitted, return HTTP 403
    - **Validates: Requirements 2.6**
    - File: `services/tenant/authorizer/__tests__/rbac.property.test.ts`

- [ ] 6. Implement Tenant registration and lifecycle Lambdas
  - [ ] 6.1 Implement `tenant-registration-fn` Lambda
    - Generate UUID v4 Tenant ID; write to DynamoDB `Tenants` table (PK `TENANT#<tenantId>`, SK `METADATA`)
    - Provision S3 prefix namespace `{tenantId}/`; emit `tenant.created` EventBridge event
    - _Requirements: 1.1, 1.2, 1.9_
  - [ ]* 6.2 Write property test for Tenant ID uniqueness
    - **Property 1: Tenant ID Uniqueness** — for any set of tenant registrations, all Tenant IDs must be globally unique
    - **Validates: Requirements 1.1**
    - File: `services/tenant/registration/__tests__/tenant-id.property.test.ts`
  - [ ] 6.3 Implement `tenant-suspension-fn` Lambda
    - Update tenant status to SUSPENDED in DynamoDB; revoke all Cognito tokens for tenant
    - Emit `tenant.suspended` EventBridge event; denial enforced within 60 seconds via authorizer reading DynamoDB status
    - _Requirements: 1.6, 1.9_
  - [ ] 6.4 Implement `tenant-deletion-fn` Lambda (Step Functions trigger)
    - Orchestrate data purge across DynamoDB, S3, OpenSearch for the tenant
    - Write purge-complete audit log entry; emit `tenant.deleted` EventBridge event
    - _Requirements: 1.7, 1.9, 1.10_
  - [ ]* 6.5 Write property test for Tenant lifecycle events
    - **Property 3: Tenant Lifecycle Events Emitted** — for any tenant lifecycle operation, the corresponding EventBridge event must carry `detail.tenantId` matching the affected tenant
    - **Validates: Requirements 1.9**
    - File: `services/tenant/registration/__tests__/lifecycle-events.property.test.ts`

- [ ] 7. Implement CDK API Stack (foundation routes)
  - [ ] 7.1 Create `infrastructure/lib/api-stack.ts` with API Gateway v2
    - Define API Gateway v2 HTTP API, base path `/v1/`, JWT authorizer referencing `api-authorizer-fn`
    - Add routes for tenant, auth, and health endpoints
    - Configure per-tenant usage plans and rate limiting (HTTP 429 + `Retry-After`)
    - _Requirements: 13.1, 13.2, 13.8_
  - [ ] 7.2 Wire tenant API endpoints to Lambda handlers
    - `POST /v1/admin/tenants` → `tenant-registration-fn`
    - `POST /v1/admin/tenants/{tenantId}/suspend` → `tenant-suspension-fn`
    - `POST /v1/admin/tenants/{tenantId}/reactivate` → `tenant-suspension-fn`
    - `DELETE /v1/admin/tenants/{tenantId}` → `tenant-deletion-fn`
    - _Requirements: 13.1_

- [x] 8. Implement product lifecycle state machine and audit log
  - [x] 8.1 Create lifecycle state machine in `services/shared/lifecycle/state-machine.ts`
    - Implement valid transition graph: `DRAFT→INGESTED→ENRICHED→REVIEW→VALIDATED→EXPORT_READY→PUBLISHED→ARCHIVED` plus backward edge `any→REVIEW` on Tenant attribute edit
    - Reject invalid transitions; write `LifecycleTransition` record
    - _Requirements: 19.1, 19.3_
  - [ ]* 8.2 Write property test for lifecycle state machine validity
    - **Property 22: Lifecycle State Machine Validity** — for any sequence of transition requests, only valid edges succeed; invalid transitions are rejected
    - **Validates: Requirements 19.1, 19.3**
    - File: `services/shared/lifecycle/__tests__/state-machine.property.test.ts`
  - [x] 8.3 Implement audit log writer in `services/shared/utils/audit-log.ts`
    - Write to DynamoDB `AuditLog` table (PK `TENANT#<tenantId>`, SK `AUDIT#<timestamp>#<eventId>`)
    - Record `actor`, `timestamp`, `action`, `affectedResource`, `previousState`, `newState`
    - _Requirements: 1.10, 19.2_
  - [ ]* 8.4 Write property test for lifecycle audit log entries
    - **Property 23: Lifecycle Transitions Recorded in Audit Log** — for any successful transition, an audit log entry exists with matching `actor`, `timestamp`, `previousState`, `newState`
    - **Validates: Requirements 19.2**
    - File: `services/shared/lifecycle/__tests__/audit-log.property.test.ts`

- [ ] 9. Checkpoint — Phase 1 deployable foundation
  - Deploy FoundationStack + AuthStack + ApiStack to `dev` environment: `cd infrastructure && npx cdk deploy FoundationStack AuthStack ApiStack --context env=dev`
  - Smoke-test: register a tenant, obtain JWT, call a protected endpoint, verify HTTP 200; call with wrong tenant context, verify HTTP 403
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.1–1.10, 2.1–2.11, 13.1–13.2_

---

## Phase 2: Product Ingestion Pipeline

- [ ] 10. Implement ClamAV Lambda layer and AV scan Lambda
  - [ ] 10.1 Build `layers/clamav/` Lambda layer
    - Package ClamAV binary and freshclam signatures into a zip-based Lambda layer targeting `arm64`
    - Add layer build script to Turborepo pipeline
    - _Requirements: 3.2, 15.3_
  - [ ] 10.2 Implement `ingestion-av-scan-fn` Lambda
    - Invoke ClamAV against the uploaded S3 object (streamed via presigned URL)
    - On positive detection: move file to `quarantine/{tenantId}/`; update job status to FAILED with `reason: MALWARE_DETECTED`
    - On clean scan: proceed to content extraction step
    - _Requirements: 3.2, 15.3_

- [ ] 11. Implement ingestion trigger and SQS queue
  - [ ] 11.1 Implement `ingestion-trigger-fn` Lambda
    - Triggered by S3 `ObjectCreated` event on `merch-os-raw-uploads` bucket
    - Validate file type (JPEG, PNG, WEBP, HEIC, PDF, TXT, ZIP) and file size (≤ 50 MB for single files, ≤ 500 MB for ZIP)
    - Generate unique `jobId` (UUID v4); write job record to DynamoDB with status QUEUED
    - Enqueue job to `ingestion-jobs-queue` SQS (visibility timeout 6 min, DLQ after 3 failures)
    - _Requirements: 3.1, 3.2, 3.3, 3.7_
  - [ ] 11.2 Add `POST /v1/ingestion/upload` and `GET /v1/ingestion/jobs/{jobId}` API routes
    - Upload route returns presigned S3 URL for direct browser-to-S3 upload
    - Job status route reads DynamoDB job record; returns `{jobId, status, progress}`
    - Add `GET /v1/ingestion/jobs` list route
    - _Requirements: 3.7, 13.11_

- [ ] 12. Implement extraction Lambdas
  - [ ] 12.1 Implement `ingestion-pdf-fn` Lambda
    - Call Textract `StartDocumentAnalysis` (async); poll `GetDocumentAnalysis` until complete
    - Extract tables, key-value pairs, and raw text; write raw extraction JSON to S3
    - _Requirements: 3.5_
  - [ ] 12.2 Implement `ingestion-image-fn` Lambda
    - Call Rekognition `DetectLabels` and `DetectText` on uploaded image
    - Produce structured attribute JSON with product labels and visible text
    - _Requirements: 3.6_
  - [ ] 12.3 Implement `ingestion-url-fn` Lambda
    - Fetch URL content via HTTP; call Bedrock with scraping/parsing prompt to extract structured attributes
    - Complete within 120 seconds; emit failure event on HTTP 4xx
    - _Requirements: 3.4, 3.11_

- [ ] 13. Implement attribute merge and canonicalisation Lambdas
  - [ ] 13.1 Implement `ingestion-merge-fn` Lambda
    - Accept array of attribute sets from multiple sources; apply conflict resolution: most-recently-uploaded source wins
    - _Requirements: 3.10_
  - [ ] 13.2 Implement `ingestion-canonicalise-fn` Lambda
    - Transform merged attributes into canonical `Product` TypeScript interface
    - Validate all required fields are present; write record to DynamoDB `Products` table (PK `TENANT#<tenantId>`, SK `PRODUCT#<productId>`)
    - Set initial `lifecycleState = INGESTED`; emit `product.ingested` EventBridge event
    - _Requirements: 3.12, 14.1, 19.1_
  - [ ]* 13.3 Write property test for ingestion output conforming to canonical schema
    - **Property 6: Ingestion Output Conforms to Canonical Product Schema** — for any valid ingestion input, the output must be a valid Product record satisfying the canonical JSON Schema
    - **Validates: Requirements 3.12, 14.1**
    - File: `services/ingestion/canonicalise/__tests__/schema.property.test.ts`

- [ ] 14. Implement Ingestion Step Functions workflow
  - [ ] 14.1 Define `IngestionWorkflow` state machine in CDK (`infrastructure/lib/ingestion-stack.ts`)
    - States: `ValidateAndScan` (Parallel: FileTypeValidation + AntivirusScan) → `ExtractContent` (Choice by fileType: PDFTextract / ImageRekognition / URLFetch / ZIPUnpackAndFanOut Map) → `MergeAttributes` → `CanonicaliseProduct` → `WriteToDatabase` → `EmitIngestionComplete`
    - Configure retry with exponential backoff on all Textract/Rekognition/Bedrock states
    - On failure: emit `ingestion.failed` EventBridge event; update job status to FAILED; retain original file for 7 days (S3 lifecycle rule)
    - _Requirements: 3.7, 3.8, 3.9_
  - [ ] 14.2 Add CDK snapshot test for IngestionStack
    - Verify state machine definition, Lambda integrations, SQS DLQ configuration, and S3 event trigger are synthesised correctly
    - _Requirements: 17.1_
  - [ ]* 14.3 Write unit tests for ingestion error paths
    - Test: malware-detected path quarantines file and emits FAILED event
    - Test: unsupported file type rejected before AV scan
    - Test: URL 4xx does not retry and emits `ingestion.failed`
    - _Requirements: 3.2, 3.8_

- [ ] 15. Implement tenant isolation property test
  - [ ]* 15.1 Write property test for tenant isolation invariant
    - **Property 2: Tenant Isolation Invariant** — for any API request carrying Tenant ID A, any attempt to access a resource belonging to Tenant ID B (A ≠ B) must be denied with HTTP 403
    - **Validates: Requirements 1.3, 1.5**
    - File: `services/tenant/authorizer/__tests__/isolation.property.test.ts`

- [ ] 16. Checkpoint — Phase 2 ingestion pipeline
  - Deploy IngestionStack to `dev` environment
  - Upload a test PDF, JPEG, and ZIP; verify jobs reach COMPLETED state within 5 minutes; verify Product records written to DynamoDB
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 3.1–3.12_

---

## Phase 3: AI Enrichment Engine

- [ ] 17. Implement enrichment Lambdas
  - [ ] 17.1 Implement `enrichment-language-fn` Lambda
    - Call Bedrock Converse API with language detection prompt; return ISO 639-1 language code
    - Record detected language in Product record `enrichmentLayer.detectedLanguage`
    - _Requirements: 4.1, 20.2_
  - [ ] 17.2 Implement `enrichment-attribute-fn` Lambda
    - Call Bedrock Claude 3 Sonnet with attribute extraction prompt for: name, brand, model, dimensions, weight, colour, material, and any marketplace-specific attributes
    - Write extracted attributes to `enrichmentLayer.attributes`; include `confidence`, `source`, `flaggedForReview` for each attribute
    - _Requirements: 4.1, 4.6_
  - [ ] 17.3 Implement `enrichment-confidence-fn` Lambda
    - Iterate over all attributes in `enrichmentLayer.attributes`; validate each confidence score is in [0.0, 1.0]
    - Set `flaggedForReview = true` for any attribute with confidence < 0.70
    - _Requirements: 4.6, 4.7_
  - [ ]* 17.4 Write property test for confidence scores in [0, 1]
    - **Property 7: Enrichment Confidence Scores in [0, 1]** — for any product processed by the Enrichment Engine, every confidence score must satisfy `0.0 ≤ score ≤ 1.0`
    - **Validates: Requirements 4.6**
    - File: `services/enrichment/confidence/__tests__/scores.property.test.ts`

- [ ] 18. Implement per-channel content generation Lambdas
  - [ ] 18.1 Implement `enrichment-title-fn` Lambda
    - Call Bedrock per channel with channel-specific title prompt; enforce character limits: Takealot 120, Amazon 200, Makro 150, Shopify 255, WooCommerce 120
    - Store per-channel titles in `enrichmentLayer.channelContent[channelId].title`
    - _Requirements: 4.2_
  - [ ] 18.2 Implement `enrichment-description-fn` Lambda
    - Call Bedrock per channel; generate description ≥ 100 words and ≤ 2,000 characters in channel-preferred format (Amazon bullets, Shopify prose, etc.)
    - Store in `enrichmentLayer.channelContent[channelId].description`
    - _Requirements: 4.3_
  - [ ] 18.3 Implement `enrichment-keywords-fn` Lambda
    - Call AWS Titan Text per channel; generate 5–10 SEO keywords per channel
    - Store in `enrichmentLayer.channelContent[channelId].keywords`
    - _Requirements: 4.4_
  - [ ]* 18.4 Write property test for enriched channel content structural constraints
    - **Property 24: Enriched Channel Content Satisfies Structural Constraints** — title length ≤ channel max, description 100–2000 chars, keyword count 5–10
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - File: `services/enrichment/__tests__/content-constraints.property.test.ts`

- [ ] 19. Implement translation and attribute immutability
  - [ ] 19.1 Implement `enrichment-translation-fn` Lambda
    - Detect source language; call Bedrock translation prompt for target channel language
    - Store translated content as a separate entry in `enrichmentLayer.languageVersions[langCode]`; never overwrite `tenantSuppliedAttributes`
    - _Requirements: 4.5, 4.10, 20.3_
  - [ ]* 19.2 Write property test for tenant-supplied attribute immutability
    - **Property 8: Tenant-Supplied Attributes Preserved After Enrichment** — after enrichment, original tenant-supplied attribute values must be byte-for-byte identical to pre-enrichment values
    - **Validates: Requirements 4.10**
    - File: `services/enrichment/__tests__/immutability.property.test.ts`
  - [ ]* 19.3 Write property test for enrichment JSON round-trip
    - **Property 9: Enrichment JSON Round-Trip** — serialising enrichment output to JSON and deserialising must produce a deeply equal object
    - **Validates: Requirements 4.13**
    - File: `services/enrichment/__tests__/roundtrip.property.test.ts`
  - [ ]* 19.4 Write property test for language version isolation
    - **Property 25: Language Version Isolation** — editing content in language L must leave all other language versions L' byte-for-byte unchanged
    - **Validates: Requirements 20.7**
    - File: `services/enrichment/translation/__tests__/lang-isolation.property.test.ts`

- [ ] 20. Implement review queue router and Enrichment Step Functions workflow
  - [ ] 20.1 Implement `enrichment-review-router-fn` Lambda
    - If any attribute has `flaggedForReview = true`: write to `review-queue` SQS; emit `product.review_required` EventBridge event; set `lifecycleState = REVIEW`
    - Otherwise: advance lifecycle to ENRICHED; emit `product.enriched` event
    - _Requirements: 4.7, 19.1_
  - [ ] 20.2 Define `EnrichmentWorkflow` state machine in `infrastructure/lib/enrichment-stack.ts`
    - States: `DetectLanguage` → `ExtractAttributes` → `GenerateChannelContent` (Map over 6 channels: GenerateTitle + GenerateDescription + GenerateKeywords) → `TranslateIfRequired` (Choice) → `AssessConfidenceScores` → `RouteToReviewOrAdvance` → `UpdateProductRecord` → `EmitEnrichmentComplete`
    - Consumed by EventBridge rule on `product.ingested` event
    - Configure Bedrock exponential backoff retry (1s, 4s, 16s; max 3 attempts)
    - _Requirements: 4.8, 4.12_
  - [ ] 20.3 Implement `POST /v1/products/{productId}/enrich` and enrichment read endpoints
    - Manual re-enrichment trigger; `GET /v1/products/{productId}/enrichment` returns enrichment layer with confidence scores
    - `POST /v1/products/{productId}/attributes/{key}/approve` — records approval actor + timestamp in audit log
    - _Requirements: 4.11_

- [ ] 21. Checkpoint — Phase 3 enrichment pipeline
  - Deploy EnrichmentStack to `dev`; trigger enrichment on a previously ingested Product; verify enrichment layer populated, confidence scores present, and REVIEW routing works for low-confidence items
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 4.1–4.13_

---

## Phase 4: Image Processing Pipeline

- [ ] 22. Build Lambda layers for image processing
  - [ ] 22.1 Build `layers/sharp/` Lambda layer
    - Package Sharp `>=0.33` compiled for `linux/arm64` Node.js 20.x as a Lambda layer
    - Add layer build script; include in Turborepo pipeline
    - _Requirements: 5.1, 5.3_
  - [ ] 22.2 Build `layers/heic-convert/` Lambda layer
    - Package `heic-convert` npm package for HEIC to JPEG/PNG conversion as a Lambda layer
    - _Requirements: 5.1_

- [ ] 23. Implement image ingestion and background removal
  - [ ] 23.1 Implement `image-ingest-fn` Lambda
    - Validate format (JPEG, PNG, WEBP, HEIC); validate size per channel limits; enqueue to `image-processing-queue` SQS
    - Store original image in `{tenantId}/images/source/{imageId}_original.{ext}`; record S3 key in Product `images[]`
    - _Requirements: 5.1, 5.12_
  - [ ] 23.2 Implement `image-background-removal-fn` Lambda
    - Call Rekognition `DetectLabels` to identify subject bounding box; crop subject using Sharp; composite onto RGB(255,255,255) white background
    - _Requirements: 5.2_
  - [ ] 23.3 Implement `image-moderation-fn` Lambda
    - Call Rekognition `DetectModerationLabels`; reject images with NUDITY/VIOLENCE/DRUGS labels above 0.80 confidence
    - Quarantine rejected images to `{tenantId}/quarantine/`; emit tenant notification; retain 30 days via S3 lifecycle rule
    - _Requirements: 5.8, 5.9_

- [ ] 24. Implement per-channel resize and packaging
  - [ ] 24.1 Implement `image-resize-fn` Lambda
    - Per-channel resize using Sharp: Takealot 1000×1000, Amazon 1600×1600, Makro 800×800, Shopify 2048×2048, WooCommerce 800×800, Custom 1200×1200
    - Preserve aspect ratio with white padding (do not stretch); upscale using bicubic interpolation when source is below minimum
    - Set `isUpscaled = true` in `ImageReference` when upscaling is applied
    - _Requirements: 5.3, 5.4, 5.5_
  - [ ]* 24.2 Write property test for image output dimensions
    - **Property 10: Image Output Meets Channel Dimension Requirements** — for any source image processed for a given channel, output dimensions must exactly match channel spec and aspect ratio must be preserved
    - **Validates: Requirements 5.3, 5.4**
    - File: `services/image-pipeline/resize/__tests__/dimensions.property.test.ts`
  - [ ]* 24.3 Write property test for upscaled image flagging
    - **Property 11: Upscaled Images Are Correctly Flagged** — for any source below minimum channel resolution, output meets minimum resolution AND `isUpscaled = true`
    - **Validates: Requirements 5.5**
    - File: `services/image-pipeline/resize/__tests__/upscale.property.test.ts`
  - [ ] 24.4 Implement `image-channel-packager-fn` Lambda
    - Assemble per-channel image set; write all variants to S3 under `{tenantId}/images/processed/{channel}/`
    - Record all per-channel S3 keys in DynamoDB Product record `images[].channelKeys`
    - _Requirements: 5.6, 5.7, 5.10_

- [ ] 25. Implement CloudFront distribution and signed URL generation
  - [ ] 25.1 Add CloudFront distribution to `infrastructure/lib/image-pipeline-stack.ts`
    - Origin: `merch-os-assets` S3 bucket; signed URLs required (key group + key pair); default TTL 1 hour
    - _Requirements: 5.10_
  - [ ] 25.2 Implement `image-signed-url-fn` Lambda
    - Generate CloudFront signed URL with 1-hour TTL for specified `imageId` and `channel`
    - Expose as `GET /v1/images/{imageId}/url/{channel}` API endpoint
    - _Requirements: 5.10_
  - [ ] 25.3 Wire image API endpoints
    - `POST /v1/images/upload` → presigned S3 URL; `GET /v1/images/{imageId}` → image metadata + channel S3 keys; `GET /v1/images/{imageId}/url/{channel}` → CloudFront signed URL
    - _Requirements: 5.1_

- [ ] 26. Checkpoint — Phase 4 image pipeline
  - Deploy ImagePipelineStack to `dev`; upload HEIC and PNG test images; verify Hero Image white background, all channel variants present in S3, CloudFront signed URLs resolve correctly, upscaled flag set correctly
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 5.1–5.12_

---

## Phase 5: Category Mapping Engine

- [ ] 27. Implement taxonomy storage and refresh
  - [ ] 27.1 Create OpenSearch domain for taxonomy index in `infrastructure/lib/category-mapping-stack.ts`
    - VPC-deployed OpenSearch; index template: `taxonomy-{channel}-{yyyyMMdd}` with fields `nodeId`, `path`, `displayName`, `isLeaf`, `parentId`
    - _Requirements: 6.1_
  - [ ] 27.2 Implement `taxonomy-refresh-fn` Lambda
    - Fetch current taxonomy from each channel's public source; store full taxonomy JSON in `s3://merch-os-config/{channel}/taxonomy/taxonomy_{yyyyMMdd}.json`
    - Index leaf nodes into OpenSearch; invalidate DynamoDB taxonomy cache
    - Schedule via EventBridge Scheduler (weekly)
    - Emit `taxonomy.refresh_complete` EventBridge event
    - _Requirements: 6.1, 6.6_
  - [ ] 27.3 Implement `POST /v1/admin/taxonomy/refresh/{channel}` operator endpoint
    - Trigger manual on-demand taxonomy refresh for a specific channel
    - _Requirements: 12.5_

- [ ] 28. Implement category recommendation and validation
  - [ ] 28.1 Implement `category-recommend-fn` Lambda
    - Call Bedrock with product attributes + channel taxonomy context; return top-3 category candidates with confidence scores
    - Present top recommendation to Tenant review when highest confidence < 0.85
    - _Requirements: 6.2, 6.3_
  - [ ] 28.2 Implement `category-validate-fn` Lambda
    - Deterministic validation: check selected node exists in current taxonomy AND `isLeaf = true`
    - Reject non-leaf or non-existent nodes; AI output does not override this check
    - _Requirements: 6.4, 9.9_
  - [ ]* 28.3 Write property test for category leaf-node enforcement
    - **Property 12: Category Leaf-Node Enforcement** — a category selection must be accepted if and only if the node exists in the current taxonomy AND `isLeaf = true`
    - **Validates: Requirements 6.4, 9.9**
    - File: `services/category-mapping/validate/__tests__/leafnode.property.test.ts`
  - [ ] 28.4 Implement `category-search-fn` Lambda
    - OpenSearch query across taxonomy index; return nodes matching keyword; target sub-500ms response
    - Expose as `GET /v1/categories/{channel}/search?q={keyword}` endpoint
    - _Requirements: 6.10_

- [ ] 29. Implement per-channel category independence and re-validation
  - [ ] 29.1 Implement `POST /v1/products/{productId}/categories/{channel}` confirm endpoint
    - Store `categoryMappings[channelId]` in Product record; validate leaf-node; do not alter any other channel's mapping
    - _Requirements: 6.7_
  - [ ]* 29.2 Write property test for per-channel category mapping independence
    - **Property 13: Per-Channel Category Mapping Independence** — modifying a category for channel C must not alter the confirmed category for any other channel C'
    - **Validates: Requirements 6.7**
    - File: `services/category-mapping/__tests__/channel-independence.property.test.ts`
  - [ ] 29.3 Implement `category-revalidate-fn` Lambda
    - Triggered by `taxonomy.refresh_complete` EventBridge event; re-validate all products with affected taxonomy nodes
    - Flag products whose mapped category no longer exists in updated taxonomy
    - _Requirements: 6.6_

- [ ] 30. Checkpoint — Phase 5 category mapping
  - Deploy CategoryMappingStack to `dev`; trigger taxonomy refresh for all 6 channels; verify taxonomy JSON in S3 and leaf nodes indexed in OpenSearch; confirm a category for a product and verify other channel mappings unchanged
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 6.1–6.10_

---

## Phase 6: Compliance Validation Engine

- [ ] 31. Implement compliance rule storage and loader
  - [ ] 31.1 Create initial rule set JSON files in `config/compliance-rules/`
    - Write `takealot.json`, `amazon.json`, `makro.json`, `shopify.json`, `woocommerce.json` encoding all published listing requirements (title length, description length, image count, image dimensions, prohibited content, required attributes, pricing)
    - Include Takealot-specific: TSIN eligibility, barcode presence, lead time; Amazon-specific: ASIN/UPC, Browse Node, fulfilment method
    - _Requirements: 9.1, 9.7, 9.8, 9.9_
  - [ ] 31.2 Implement `compliance-rule-loader-fn` Lambda
    - Load rule set for a channel from DynamoDB (`ComplianceRules` table, PK `CHANNEL#<channelId>`, SK `RULESET#current`) and cache in Lambda memory with 5-minute TTL
    - Invalidate cache on `compliance.rules_updated` EventBridge event
    - _Requirements: 9.6_
  - [ ] 31.3 Create `PUT /v1/admin/compliance/rules/{channel}` and `GET /v1/admin/compliance/rules/{channel}` endpoints
    - PUT writes new rule set JSON to S3 + DynamoDB; emits `compliance.rules_updated` event; changes effective within 5 minutes
    - _Requirements: 9.6, 12.4_

- [ ] 32. Implement compliance validation Lambda and reporting
  - [ ] 32.1 Implement `compliance-validate-fn` Lambda
    - Load rule set for each channel via `compliance-rule-loader-fn`; evaluate Product Listing against all rules deterministically (no AI in pass/fail)
    - Produce `ComplianceReport` per channel: result (PASS/FAIL), violations with codes, remediation guidance
    - Must complete full validation across all 6 channels within 10 seconds
    - _Requirements: 9.2, 9.3, 9.5, 9.10_
  - [ ]* 32.2 Write property test for compliance validation covers all channels
    - **Property 18: Compliance Validation Covers All Channels** — for any product that undergoes validation, an independent report must exist for each of the 6 channels
    - **Validates: Requirements 9.2**
    - File: `services/compliance/validate/__tests__/allchannels.property.test.ts`
  - [ ]* 32.3 Write property test for compliance validation determinism
    - **Property 19: Compliance Validation Determinism** — for any product and rule set version, running validation multiple times with identical inputs must produce identical results
    - **Validates: Requirements 9.5**
    - File: `services/compliance/validate/__tests__/determinism.property.test.ts`
  - [ ] 32.4 Implement `compliance-report-fn` Lambda
    - Write validation report to DynamoDB Product record `complianceReports[channelId]`
    - Emit `compliance.passed` or `compliance.failed` EventBridge event per channel
    - Write audit log entry recording rule set version and all violation codes
    - _Requirements: 9.4, 9.11, 9.12_

- [ ] 33. Wire compliance into product lifecycle and API
  - [ ] 33.1 Add `POST /v1/products/{productId}/validate` and compliance read endpoints
    - Manual validation trigger; `GET /v1/products/{productId}/compliance` returns all channel reports; `GET /v1/products/{productId}/compliance/{channel}` returns single channel report
    - _Requirements: 9.2_
  - [ ] 33.2 Update lifecycle state machine to block EXPORT_READY advance when compliance FAILS for any requested channel
    - On `compliance.passed` for all channels: advance lifecycle to VALIDATED; block export if any channel FAILS
    - _Requirements: 9.4, 19.1_

- [ ] 34. Checkpoint — Phase 6 compliance engine
  - Deploy ComplianceStack to `dev`; run validation on a test Product; verify 6 channel reports generated; update rule set via admin endpoint and verify cache invalidation within 5 minutes
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 9.1–9.12_

---

## Phase 7: Marketplace Output Engine

- [ ] 35. Implement per-channel CSV generator Lambdas
  - [ ] 35.1 Implement `takealot-csv-fn` Lambda
    - Generate Takealot bulk upload CSV conforming to current Seller Portal template
    - Validate TSIN eligibility, barcode presence, lead time fields before generating
    - _Requirements: 7.2, 9.8_
  - [ ] 35.2 Implement `amazon-csv-fn` Lambda
    - Generate Amazon flat-file CSV for the product's category; validate ASIN/UPC, Browse Node, fulfilment method
    - _Requirements: 7.3, 9.9_
  - [ ] 35.3 Implement `makro-csv-fn`, `shopify-csv-fn`, `woocommerce-csv-fn` Lambdas
    - Makro: conform to current Makro Marketplace bulk upload template
    - Shopify: include all variant columns per Shopify product import template
    - WooCommerce: conform to WooCommerce product import format; include variant matrix
    - _Requirements: 7.4, 7.5, 7.6, 7.14_
  - [ ] 35.4 Implement `custom-json-fn` Lambda
    - Generate channel-agnostic JSON export; validate against JSON Schema before delivery
    - _Requirements: 7.7_
  - [ ] 35.5 Add JSON Schema files to `config/channel-schemas/` for all channels
    - Define JSON Schema for Takealot, Amazon, Makro, Shopify, WooCommerce CSV structures
    - _Requirements: 7.8_

- [ ] 36. Implement schema validation and export storage
  - [ ] 36.1 Implement `export-schema-validator-fn` Lambda
    - Load channel schema (JSON Schema); validate generated CSV/JSON; block export and return field-level error list on failure
    - _Requirements: 7.8, 7.9_
  - [ ]* 36.2 Write property test for CSV export passes channel schema validation
    - **Property 14: CSV Export Passes Channel Schema Validation** — for any product in EXPORT_READY state exported to any channel, the CSV must parse and pass channel JSON Schema validation without violations
    - **Validates: Requirements 7.8**
    - File: `services/output-engine/__tests__/csv-schema.property.test.ts`
  - [ ]* 36.3 Write property test for CSV export round-trip serialization
    - **Property 15: CSV Export Round-Trip Serialization** — parsing the CSV and re-serialising must produce a file where every field value is identical to the original
    - **Validates: Requirements 7.13**
    - File: `services/output-engine/__tests__/csv-roundtrip.property.test.ts`
  - [ ] 36.4 Implement `export-storage-fn` Lambda
    - Write validated exports to `s3://merch-os-exports/{tenantId}/{channel}/{productId}_{timestamp}.csv`
    - Set 90-day retention lifecycle rule; transition to Glacier after 90 days
    - Write `ExportRecord` to Product `exportHistory[]`; emit `product.exported` EventBridge event
    - _Requirements: 7.12_

- [ ] 37. Implement Shopify and WooCommerce direct publish
  - [ ] 37.1 Implement `shopify-publish-fn` Lambda
    - Use Shopify Admin API with stored OAuth access token to create/update products directly
    - Report publish result (success/partial/full failure) back to tenant within 30 seconds
    - Store OAuth tokens in Secrets Manager; implement circuit breaker for Shopify API calls
    - _Requirements: 7.10, 7.11, 16.9_
  - [ ] 37.2 Implement `woocommerce-publish-fn` Lambda
    - Use WooCommerce REST API with stored OAuth credentials to create/update products
    - Same result reporting and circuit breaker pattern as Shopify
    - _Requirements: 7.10, 7.11, 16.9_
  - [ ] 37.3 Implement OAuth flow Lambdas for Shopify and WooCommerce
    - `POST /v1/integrations/shopify/connect` initiates OAuth flow; callback handler exchanges code for token; stores in Secrets Manager under tenant scope
    - Same for WooCommerce
    - `DELETE /v1/integrations/{channel}` revokes and removes stored OAuth credentials
    - _Requirements: 7.10_

- [ ] 38. Implement Export orchestrator and Step Functions workflow
  - [ ] 38.1 Implement `export-orchestrator-fn` Lambda
    - Validate product is in EXPORT_READY lifecycle state; check all requested channels have confirmed categories; block export and list missing fields if required fields absent
    - _Requirements: 6.8, 7.9_
  - [ ] 38.2 Define `ExportWorkflow` state machine in `infrastructure/lib/output-engine-stack.ts`
    - States: `ValidateExportReadiness` → `GenerateChannelExports` (Parallel: each channel CSV → ValidateSchema, or direct publish if OAuth connected) → `StoreExports` → `UpdateProductLifecycle (PUBLISHED)` → `EmitExportComplete`
    - _Requirements: 7.1, 19.1_
  - [ ] 38.3 Wire export and integration API endpoints
    - `POST /v1/products/{productId}/export`; `GET /v1/exports/{exportId}`; `GET /v1/exports`
    - _Requirements: 13.1_

- [ ] 39. Checkpoint — Phase 7 marketplace output
  - Deploy OutputEngineStack to `dev`; export a test product to Takealot and Shopify CSV; verify schema validation passes; download export from S3; verify round-trip CSV equality
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 7.1–7.14_

---

## Phase 8: Inventory Management

- [ ] 40. Implement DynamoDB Inventory tables and core update Lambda
  - [ ] 40.1 Create Inventory and InventoryTransactions DynamoDB tables in `infrastructure/lib/inventory-stack.ts`
    - `Inventory` table: PK `TENANT#<tenantId>`, SK `SKU#<sku>#WH#<warehouseId>`; attributes: `onHand`, `reserved`, `available`; GSI1 by SKU
    - `InventoryTransactions` table: PK `TENANT#<tenantId>`, SK `TXN#<timestamp>#<txnId>`; immutable append-only; no TTL; archive to Glacier after 2 years via lifecycle rule
    - Enable DynamoDB Streams on both tables
    - _Requirements: 8.1, 8.9, 14.3_
  - [ ] 40.2 Implement `inventory-update-fn` Lambda
    - Process stock updates from all sources (manual, CSV, API, order, cancellation)
    - Atomic conditional write: `available = onHand - reserved`; reject if result would be negative (set to 0, notify tenant)
    - Append immutable transaction record to `InventoryTransactions`
    - _Requirements: 8.1, 8.3, 8.6, 8.9_
  - [ ]* 40.3 Write property test for inventory available quantity invariant
    - **Property 16: Inventory Available Quantity Invariant** — for any sequence of stock updates and reservations, `available = onHand - reserved` holds after every operation and `available ≥ 0`
    - **Validates: Requirements 8.1, 8.6**
    - File: `services/inventory/update/__tests__/invariant.property.test.ts`
  - [ ]* 40.4 Write property test for inventory transaction ledger completeness
    - **Property 17: Inventory Transaction Ledger Completeness** — for any stock update from any source, a transaction record exists with correct `actor`, `timestamp`, `source`, `previousQty`, `deltaQty`, `newQty`
    - **Validates: Requirements 8.9**
    - File: `services/inventory/__tests__/ledger.property.test.ts`

- [ ] 41. Implement channel sync, reservation, and stockout Lambdas
  - [ ] 41.1 Implement `inventory-channel-sync-fn` Lambda
    - Triggered by DynamoDB Streams on Inventory table; update channel availability for all connected channels when `available` qty changes
    - When `available = 0`: set all channel availability to out-of-stock; emit `inventory.stockout` event
    - When `available > 0` restored from zero: restore channel availability; emit `inventory.restocked` event
    - _Requirements: 8.3, 8.7, 8.8_
  - [ ] 41.2 Implement `inventory-reservation-fn` Lambda
    - Decrement `available` (decrement `reserved`) on order received; release reservation on order cancellation
    - Enforce non-negative constraint atomically
    - _Requirements: 8.12_
  - [ ] 41.3 Implement `inventory-alert-fn` Lambda
    - Detect `available = 0` transitions via DynamoDB Streams; emit `inventory.stockout` EventBridge event; send SES email to tenant
    - _Requirements: 8.7_

- [ ] 42. Implement supplier feed poller and reconciliation
  - [ ] 42.1 Implement `inventory-feed-poller-fn` Lambda
    - Invoked by EventBridge Scheduler at tenant-configured interval (minimum 15 minutes)
    - Fetch supplier feed URL (CSV or JSON); enqueue for reconciliation
    - _Requirements: 8.4_
  - [ ] 42.2 Implement `inventory-reconcile-fn` Lambda
    - Compare feed quantities against current on-hand; apply delta updates; generate reconciliation report stored in DynamoDB
    - _Requirements: 8.5_
  - [ ] 42.3 Implement `inventory-whatsapp-router-fn` Lambda
    - Receive routed Ingestion Pipeline result from WhatsApp image; extract SKU and qty using Textract/Bedrock output; forward to `inventory-update-fn`
    - _Requirements: 8.2, 8.11_

- [ ] 43. Wire inventory API endpoints
  - [ ] 43.1 Add inventory routes to ApiStack
    - `GET /v1/inventory`; `GET /v1/inventory/{sku}`; `PUT /v1/inventory/{sku}` (manual update); `POST /v1/inventory/import` (CSV bulk); `GET /v1/inventory/{sku}/transactions` (ledger)
    - `POST /v1/inventory/feeds`; `PUT /v1/inventory/feeds/{feedId}`; `GET /v1/inventory/feeds`
    - _Requirements: 8.2, 13.1_

- [ ] 44. Checkpoint — Phase 8 inventory management
  - Deploy InventoryStack to `dev`; manually set stock, verify channel sync, simulate a stockout and restock; run supplier feed ingestion; verify transaction ledger entries
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 8.1–8.12_

---

## Phase 9: Billing & Subscription

- [ ] 45. Implement Billing DynamoDB table and Stripe integration
  - [ ] 45.1 Create Billing DynamoDB table in `infrastructure/lib/billing-stack.ts`
    - PK `TENANT#<tenantId>`; SK variants: `SUBSCRIPTION#current`, `USAGE#<yyyyMM>`, `INVOICE#<invoiceId>`
    - Create `Plans` table with plan limits per plan tier (Starter / Growth / Professional / Enterprise)
    - _Requirements: 10.1_
  - [ ] 45.2 Implement `billing-stripe-webhook-fn` Lambda
    - Verify Stripe webhook signature (secret from Secrets Manager)
    - Handle: `invoice.payment_succeeded` → update DynamoDB, trigger PDF generation; `invoice.payment_failed` → schedule retry; `customer.subscription.updated` → update plan record
    - _Requirements: 10.5, 10.6_
  - [ ] 45.3 Implement `billing-plan-change-fn` Lambda
    - Handle upgrade: call Stripe API for prorated charge; immediately unlock new plan entitlements
    - Handle downgrade: apply new entitlements at start of next billing period; credit unused prepaid amounts proportionally
    - _Requirements: 10.12, 10.13_

- [ ] 46. Implement usage metering and plan enforcement
  - [ ] 46.1 Implement `billing-usage-meter-fn` Lambda
    - Triggered by EventBridge for every AI enrichment call, image processing call, CSV export
    - Atomically increment usage counters in DynamoDB `USAGE#<yyyyMM>` record, attributed to tenant and billing period
    - _Requirements: 10.4_
  - [ ]* 46.2 Write property test for usage events recorded for all metered operations
    - **Property 20: Usage Events Recorded for All Metered Operations** — for any metered operation, a usage event record must exist in the Billing table attributed to the correct tenant and billing period
    - **Validates: Requirements 10.4**
    - File: `services/billing/usage-meter/__tests__/usage.property.test.ts`
  - [ ] 46.3 Implement `billing-limit-enforcer-fn` Lambda
    - Invoked on each metered operation; reads current usage from DynamoDB; returns ALLOWED or BLOCKED
    - Block further consumption at 100% limit; present upgrade prompt to tenant
    - _Requirements: 10.3_
  - [ ] 46.4 Implement `billing-alert-fn` Lambda
    - Monitor usage thresholds at 80% and 100%; send SES email to Tenant Owner at each threshold crossing
    - _Requirements: 10.2, 10.3_

- [ ] 47. Implement payment retry, PDF invoices, and billing API
  - [ ] 47.1 Build `layers/pdfkit/` Lambda layer
    - Package PDFKit for Node.js as a Lambda layer
    - _Requirements: 10.11_
  - [ ] 47.2 Implement `billing-invoice-pdf-fn` Lambda
    - Triggered by `invoice.payment_succeeded`; generate PDF using PDFKit; store in `s3://merch-os-invoices/{tenantId}/{invoiceId}.pdf` with 3-year lifecycle policy
    - _Requirements: 10.11_
  - [ ] 47.3 Implement `billing-payment-retry-fn` Lambda
    - EventBridge Scheduler: retry Stripe charge on day+3 and day+7 after failure; send SES email on each attempt
    - On day+7 failure: downgrade tenant to read-only access; notify Tenant Owner
    - _Requirements: 10.6, 10.7_
  - [ ] 47.4 Wire billing API endpoints
    - `GET /v1/billing`; `POST /v1/billing/upgrade`; `POST /v1/billing/downgrade`; `GET /v1/billing/invoices`; `GET /v1/billing/invoices/{id}/pdf` (signed S3 URL)
    - `POST /v1/admin/billing/credits` (manual credit; records justification note in audit log)
    - _Requirements: 10.10, 12.9_

- [ ] 48. Checkpoint — Phase 9 billing
  - Deploy BillingStack to `dev` with Stripe test mode; simulate plan upgrade/downgrade; simulate payment failure and verify day+3 retry; verify PDF invoice in S3
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 10.1–10.13_

---

## Phase 10: Seller Dashboard

- [ ] 49. Initialise Seller Dashboard Next.js 14 application
  - [ ] 49.1 Scaffold `apps/seller-dashboard/` with Next.js 14 App Router
    - Configure TypeScript, Tailwind CSS, `@aws-amplify/ui-react`, AWS Amplify Gen 2, React Query
    - Set up Cognito auth flow (PKCE, `seller-dashboard` app client); redirect to login on unauthenticated access
    - Configure WCAG 2.1 AA: semantic HTML, ARIA labels, keyboard navigation, 4.5:1 colour contrast minimum
    - _Requirements: 11.1, 11.11_
  - [ ] 49.2 Create API client in `apps/seller-dashboard/src/lib/api-client.ts`
    - Wrap all `/v1/` API calls; attach JWT Bearer token from Cognito session; handle token refresh
    - _Requirements: 11.1_
  - [ ] 49.3 Implement layout and navigation components
    - Sidebar navigation: Dashboard, Products, Review Queue, Inventory, Exports, Settings, Billing
    - Notification badge component (unread count, WebSocket update via API Gateway WebSocket)
    - _Requirements: 11.1, 18.1_

- [ ] 50. Implement product catalogue and product detail pages
  - [ ] 50.1 Implement `/dashboard/products` page
    - Paginated product list backed by OpenSearch (`GET /v1/products`); search input with sub-500ms results for up to 100,000 products
    - Visual lifecycle state indicators (INGESTED, ENRICHED, REVIEW, VALIDATED, PUBLISHED, REJECTED)
    - Bulk action toolbar: approve, reject, export multiple products
    - Initial catalogue load < 3 seconds on broadband for up to 10,000 products
    - _Requirements: 11.2, 11.5, 11.8, 11.12_
  - [ ] 50.2 Implement `/dashboard/products/{id}` product detail page
    - Display AI-enriched attributes with confidence scores; inline approve/override controls
    - Per-channel compliance status badges; link to compliance violation details
    - Each approval change immediately POSTs to `POST /v1/products/{productId}/attributes/{key}/approve` and recorded in audit log
    - _Requirements: 11.3, 11.4, 11.9_
  - [ ] 50.3 Implement `/dashboard/review` review queue page
    - Prioritised queue list with flagged attributes and reason; count badge in navigation
    - Inline approve/reject controls per attribute; bulk review actions
    - _Requirements: 11.3_

- [ ] 51. Implement inventory, exports, billing, and settings pages
  - [ ] 51.1 Implement `/dashboard/inventory` page
    - SKU list with real-time stock levels per warehouse; manual adjustment modal calling `PUT /v1/inventory/{sku}`
    - _Requirements: 11.6_
  - [ ] 51.2 Implement `/dashboard/exports` page
    - Export history per channel: timestamp, file name, record count, status; download link generating signed S3 URL
    - _Requirements: 11.7_
  - [ ] 51.3 Implement `/dashboard/billing` page
    - Current plan usage meters (progress bars at 80%/100% thresholds); next invoice amount; payment history; invoice PDF download
    - Upgrade CTA shown when usage reaches 80% of any limit
    - _Requirements: 11.10, 10.10_
  - [ ] 51.4 Implement `/dashboard/settings` page
    - User management and RBAC assignment (Owner-only); Webhook configuration (create/edit/delete/test); channel OAuth connection flow (Shopify, WooCommerce); notification preferences
    - _Requirements: 11.10, 13.5_

- [ ] 52. Implement notification centre and in-app WebSocket updates
  - [ ] 52.1 Implement NotificationStack: `notification-dispatcher-fn`, `notification-email-fn`, `notification-in-app-fn`
    - `notification-dispatcher-fn` subscribes to all relevant EventBridge events; routes to email and/or in-app based on tenant preferences
    - `notification-email-fn` sends via SES; enforces 1 email per event type per tenant per hour
    - `notification-in-app-fn` stores notification record to DynamoDB `Tenants` table SK `NOTIFICATION#<timestamp>#<notifId>`
    - Add API Gateway WebSocket API for in-app real-time delivery
    - `GET /v1/notifications`; `PUT /v1/notifications/{id}/read`; `GET /v1/notifications/preferences`; `PUT /v1/notifications/preferences`
    - _Requirements: 18.1, 18.2, 18.4, 18.5, 18.7, 18.8_
  - [ ] 52.2 Implement notification history page in Seller Dashboard
    - Show all notifications from last 90 days; read/unread status; filter by event type
    - _Requirements: 18.8_

- [ ] 53. Deploy Seller Dashboard to Amplify
  - [ ] 53.1 Add Amplify app configuration to `infrastructure/lib/dashboard-stack.ts`
    - Create Amplify app pointing to `apps/seller-dashboard/` in the monorepo; configure branch-to-environment mapping (main → production, develop → staging)
    - Attach WAF to CloudFront distribution in front of Amplify
    - _Requirements: 11.1_
  - [ ]* 53.2 Write Vitest + React Testing Library unit tests for key Seller Dashboard components
    - Test product list renders lifecycle state indicators; test inline attribute approval submits correct API call; test bulk action toolbar
    - _Requirements: 11.2, 11.4, 11.5_

- [ ] 54. Checkpoint — Phase 10 Seller Dashboard
  - Deploy DashboardStack + NotificationStack to `dev`; log in as a seller, browse products, approve an attribute, view exports, adjust inventory; verify WebSocket notification arrives on job completion
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 11.1–11.12, 18.1–18.8_

---

## Phase 11: Admin Dashboard

- [ ] 55. Initialise Admin Dashboard Next.js 14 application
  - [ ] 55.1 Scaffold `apps/admin-dashboard/` with Next.js 14 App Router
    - Configure TypeScript, Tailwind CSS, Recharts, AWS Amplify Gen 2; use `merch-os-admin-pool` Cognito app client
    - All routes protected by `custom:role = operator` claim; redirect to login otherwise
    - MFA enforcement via Cognito advanced security settings
    - _Requirements: 12.1_
  - [ ] 55.2 Implement `/admin/health` platform health overview page
    - Display real-time Lambda invocation counts, Step Functions failure rates, SQS queue depths, DynamoDB capacity utilisation, active tenant count from `GET /v1/admin/metrics`
    - Alert banner for any Lambda error rate > 1% in last 5 minutes
    - _Requirements: 12.2, 12.10_

- [ ] 56. Implement tenant management and compliance rule editor
  - [ ] 56.1 Implement `/admin/tenants` page
    - Searchable tenant list (name, plan, status, MRR); actions: suspend, reactivate, delete with confirmation dialogs
    - _Requirements: 12.3_
  - [ ] 56.2 Implement `/admin/compliance/{channel}` compliance rule editor
    - JSON schema-driven form for editing rule set; save calls `PUT /v1/admin/compliance/rules/{channel}`; confirm changes take effect within 5 minutes
    - _Requirements: 12.4, 9.6_
  - [ ] 56.3 Implement `/admin/taxonomy` taxonomy management page
    - Per-channel taxonomy status (last refresh date, node count); trigger manual refresh button calling `POST /v1/admin/taxonomy/refresh/{channel}`
    - _Requirements: 12.5_

- [ ] 57. Implement audit log viewer, platform metrics, and billing oversight
  - [ ] 57.1 Implement `/admin/audit-log` page
    - Filterable audit log (by tenant, event type, actor, date range) backed by OpenSearch
    - Return results within 2 seconds for queries spanning up to 90 days
    - _Requirements: 12.6_
  - [ ] 57.2 Implement `/admin/billing` billing oversight page
    - Per-tenant view: current plan, MRR contribution, payment status, last invoice date
    - Manual credit/adjustment form that records justification note in audit log
    - _Requirements: 12.8, 12.9_
  - [ ] 57.3 Implement platform-wide usage metrics view
    - Charts (Recharts) for total products ingested, AI calls, image calls, CSV exports aggregated by day/week/month from `GET /v1/admin/metrics`
    - _Requirements: 12.7_

- [ ] 58. Deploy Admin Dashboard to Amplify
  - [ ] 58.1 Add Admin Amplify app to `infrastructure/lib/dashboard-stack.ts`
    - Separate Amplify app for `apps/admin-dashboard/`; separate CloudFront distribution; separate WAF rule set restricting to known operator IPs if desired
    - _Requirements: 12.1_
  - [ ]* 58.2 Write Vitest + React Testing Library unit tests for Admin Dashboard
    - Test tenant suspension flow; test compliance rule editor save triggers API call; test audit log filter renders correct results
    - _Requirements: 12.3, 12.4, 12.6_

- [ ] 59. Checkpoint — Phase 11 Admin Dashboard
  - Deploy Admin Dashboard to `dev`; log in as operator, view health metrics, suspend a test tenant, edit a compliance rule, trigger taxonomy refresh, query audit log
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 12.1–12.10_

---

## Phase 12: Observability, CI/CD & Hardening

- [ ] 60. Implement ObservabilityStack: CloudWatch dashboards and alarms
  - [ ] 60.1 Create `infrastructure/lib/observability-stack.ts`
    - Create one CloudWatch dashboard per subsystem (Ingestion, Enrichment, Image, Category, Output, Inventory, Compliance, Billing, Auth, API)
    - Each dashboard widget: Lambda Invocations, Errors, Duration p50/p95/p99, Throttles; Step Functions ExecutionsStarted/Failed/ExecutionTime; SQS queue depth; DynamoDB latency
    - _Requirements: 16.2_
  - [ ] 60.2 Add CloudWatch alarms for all critical metrics
    - Lambda error rate > 1% over 5 min → P2 SNS alert
    - SQS DLQ depth > 0 → P2 SNS alert
    - Step Functions failure rate > 5% over 15 min → P1 SNS alert
    - API Gateway 5xx rate > 0.1% over 5 min → P1 SNS alert
    - DynamoDB throttled requests > 0 → P3 SNS alert
    - All alarms route to SNS topic `merch-os-alarms-{env}`
    - _Requirements: 16.3, 12.10_

- [ ] 61. Implement X-Ray tracing and Lambda Powertools integration
  - [ ] 61.1 Enable X-Ray tracing on all Lambda functions, API Gateway, and Step Functions in all CDK stacks
    - Set `TracingConfig: Active` on all Lambda constructs; enable X-Ray on API Gateway; enable X-Ray on all Step Functions state machines
    - Define X-Ray groups per subsystem for filtered trace analysis
    - _Requirements: 16.4_
  - [ ] 61.2 Verify Lambda Powertools middleware is applied to all Lambda functions
    - Audit all Lambda handler files; confirm `withPowertools` middleware wrapper is present on every handler
    - Verify structured JSON logs include correlation IDs propagated from API Gateway
    - _Requirements: 16.7, 13.10_

- [ ] 62. Implement Webhook delivery and retry system
  - [ ] 62.1 Implement `webhook-delivery-fn` Lambda
    - Subscribe to all `merch-os-events` bus events; filter by tenant webhook subscription config (stored in DynamoDB)
    - Deliver via HTTPS POST; sign payload with `X-MerchOS-Signature: HMAC-SHA256(tenantWebhookSecret, rawPayloadBody)` using secret from Secrets Manager
    - Store delivery record in DynamoDB `Tenants` table SK `WEBHOOK_DELIVERY#<deliveryId>`
    - _Requirements: 13.5, 13.6_
  - [ ]* 62.2 Write property test for webhook signature correctness
    - **Property 21: Webhook Signature Correctness** — for any webhook payload delivered to a tenant endpoint, the `X-MerchOS-Signature` header must equal `HMAC-SHA256(tenantWebhookSecret, rawPayloadBody)`
    - **Validates: Requirements 13.6**
    - File: `services/webhooks/delivery/__tests__/signature.property.test.ts`
  - [ ] 62.3 Implement `webhook-retry-fn` Lambda
    - Exponential backoff retry schedule: 1 min, 5 min, 30 min, 2 hr, 8 hr, 24 hr
    - After 24 hours without successful delivery: mark webhook delivery as FAILED; emit notification to tenant
    - _Requirements: 13.7_
  - [ ] 62.4 Wire Webhook management API endpoints
    - `GET /v1/webhooks`; `POST /v1/webhooks`; `PUT /v1/webhooks/{webhookId}`; `DELETE /v1/webhooks/{webhookId}`; `GET /v1/webhooks/{webhookId}/deliveries`; `POST /v1/webhooks/{webhookId}/test`
    - _Requirements: 13.5_

- [ ] 63. Implement security hardening and monitoring
  - [ ] 63.1 Enable GuardDuty, Security Hub, AWS Config, and CloudTrail in `infrastructure/lib/observability-stack.ts`
    - GuardDuty: enabled in all regions
    - Security Hub: enabled; connect GuardDuty findings
    - AWS Config: enabled; add `required-tags` config rule (flags untagged resources within 1 hour)
    - CloudTrail: all management + data events; log integrity validation; store in `merch-os-cloudtrail` S3 bucket
    - HIGH/CRITICAL Security Hub findings → SNS `security-alerts` topic; target 15-minute notification
    - _Requirements: 15.4, 15.5, 15.6, 17.8_
  - [ ] 63.2 Implement WAF rules on API Gateway and CloudFront distributions
    - Attach AWS WAF v2 to API Gateway: `AWSManagedRulesCommonRuleSet`, `AWSManagedRulesAmazonIpReputationList`, rate limit 2,000 req/5 min/IP
    - Attach WAF to Amplify/CloudFront distributions
    - _Requirements: 15.1_
  - [ ] 63.3 Configure Secrets Manager rotation schedules
    - 90-day rotation for all secrets (Stripe API key, Shopify/WooCommerce OAuth, Cognito client secrets, webhook secrets)
    - _Requirements: 15.7_
  - [ ] 63.4 Implement DLQ handler Lambda for all SQS dead-letter queues
    - `dlq-handler-fn` logs failed message to CloudWatch; emits EventBridge event; sends SNS alert
    - Attach to all SQS DLQs across all stacks (`maxReceiveCount: 3`)
    - _Requirements: 16.6_
  - [ ] 63.5 Implement circuit breaker Lambda layer in `layers/circuit-breaker/`
    - State stored in DynamoDB `CircuitBreaker` table: OPEN after 5 consecutive failures; HALF-OPEN after 60 seconds; CLOSED on recovery
    - Apply to: Shopify API, WooCommerce API, Stripe API, external URL fetch calls
    - _Requirements: 16.9_

- [ ] 64. Implement GitHub Actions CI/CD pipeline
  - [ ] 64.1 Create `.github/workflows/ci.yml`
    - Trigger on push to `main` and pull requests
    - Jobs: `test` (Jest + PBT with `--runInBand`), `lint` (ESLint + `tsc --noEmit`), `security-scan` (Snyk; block on CRITICAL CVE), `cdk-synth` (`cdk synth --all`)
    - _Requirements: 17.4, 15.9_
  - [ ] 64.2 Create `.github/workflows/deploy-staging.yml`
    - Trigger on merge to `main`; run `cdk deploy --all` against staging account; run integration tests against staging after deploy
    - _Requirements: 17.3, 17.4_
  - [ ] 64.3 Create `.github/workflows/deploy-prod.yml`
    - Requires manual approval gate (GitHub environment protection rule) before `cdk deploy --all` to production account
    - _Requirements: 17.5_
  - [ ] 64.4 Implement CDK drift detection Lambda (`drift-detection-fn`)
    - Triggered daily by EventBridge Scheduler; runs `cdk diff` against all production stacks
    - On drift detected: store report in `s3://merch-os-ops/drift-reports/{date}.json`; send SNS alert to operator
    - _Requirements: 17.6_
  - [ ] 64.5 Write CDK snapshot tests for all remaining stacks
    - Add snapshot tests to `infrastructure/test/` for: EnrichmentStack, ImagePipelineStack, CategoryMappingStack, OutputEngineStack, InventoryStack, ComplianceStack, BillingStack, DashboardStack, ObservabilityStack, ApiStack
    - _Requirements: 17.1_

- [ ] 65. Implement OpenAPI documentation and data retention policies
  - [ ] 65.1 Generate `docs/openapi/merch-os-api-v1.yaml` OpenAPI 3.0 spec
    - Document all API routes from all phases; include request/response schemas, auth requirements, error codes
    - _Requirements: 13.1_
  - [ ] 65.2 Implement S3 lifecycle policies for data retention
    - Product records: archive to Glacier after 90 days post-tenant-deletion; retain 7 years
    - Export files: Glacier after 90 days
    - Invoice PDFs: 3-year retention
    - Audit logs: 3-year minimum retention; CloudTrail logs: 1-year retention
    - _Requirements: 14.11, 10.11, 3.8, 15.10_
  - [ ] 65.3 Enable DynamoDB point-in-time recovery on all tables
    - Enable PITR in CDK for: Products, Tenants, Inventory, InventoryTransactions, Billing, AuditLog, ComplianceRules, CircuitBreaker tables
    - _Requirements: 14.10_

- [ ] 66. Final checkpoint — full platform integration
  - Deploy all stacks to `staging` environment via CI/CD pipeline; run end-to-end integration test: upload PDF → ingestion → enrichment → category mapping → compliance → export → verify Product reaches PUBLISHED state
  - Run full PBT suite (100 iterations minimum per property); verify all 25 properties pass
  - Verify CloudWatch dashboards populated, alarms active, X-Ray traces visible, and GitHub Actions pipeline completes successfully
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 1.1–20.7, 16.1–16.10, 17.1–17.8_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP iteration; core platform functionality does not depend on them passing.
- All property-based tests use `fast-check` configured with `fc.configureGlobal({ numRuns: 100 })` at a minimum, as specified in the design document.
- Each PBT file carries the tag comment: `// Feature: merch-os-platform, Property N: <property text>`
- All Lambda functions are TypeScript, Node.js 20.x, `arm64` architecture, using the shared Middy + Powertools middleware stack defined in Phase 1.
- Infrastructure is CDK TypeScript. All stacks output ARNs and names to SSM Parameter Store; inter-stack references use SSM lookups (not CloudFormation cross-stack references) to avoid circular dependencies.
- Phases 1–3 must be deployed in order (Foundation → Auth → Ingestion → Enrichment). Phases 4–9 can be deployed in parallel once Phase 3 is live. Phases 10–11 depend on Phases 3–9. Phase 12 can be progressively applied starting from Phase 1.
- All 25 correctness properties are covered by property-based test sub-tasks distributed across Phases 1–12:
  - Phase 1: Properties 1, 2, 3, 4, 5, 22, 23
  - Phase 2: Property 6 (+ 2 from Phase 1)
  - Phase 3: Properties 7, 8, 9, 24, 25
  - Phase 4: Properties 10, 11
  - Phase 5: Properties 12, 13
  - Phase 6: Properties 18, 19
  - Phase 7: Properties 14, 15
  - Phase 8: Properties 16, 17
  - Phase 9: Property 20
  - Phase 12: Property 21


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["2.1", "2.2", "2.3"]
    },
    {
      "id": 1,
      "tasks": ["3.1", "4.1", "8.1", "8.3"]
    },
    {
      "id": 2,
      "tasks": ["3.2", "4.2", "4.3", "4.4", "8.2", "8.4"]
    },
    {
      "id": 3,
      "tasks": ["5.1", "5.3", "6.1", "6.3"]
    },
    {
      "id": 4,
      "tasks": ["5.2", "5.4", "6.2", "6.4", "6.5", "7.1", "7.2"]
    },
    {
      "id": 5,
      "tasks": ["10.1", "10.2", "11.1", "11.2"]
    },
    {
      "id": 6,
      "tasks": ["12.1", "12.2", "12.3", "13.1", "13.2"]
    },
    {
      "id": 7,
      "tasks": ["13.3", "14.1", "15.1"]
    },
    {
      "id": 8,
      "tasks": ["14.2", "14.3", "17.1", "17.2", "17.3"]
    },
    {
      "id": 9,
      "tasks": ["17.4", "18.1", "18.2", "18.3"]
    },
    {
      "id": 10,
      "tasks": ["18.4", "19.1", "22.1", "22.2"]
    },
    {
      "id": 11,
      "tasks": ["19.2", "19.3", "19.4", "20.1", "23.1", "23.2", "23.3"]
    },
    {
      "id": 12,
      "tasks": ["20.2", "20.3", "24.1", "24.4", "27.1", "40.1"]
    },
    {
      "id": 13,
      "tasks": ["24.2", "24.3", "25.1", "27.2", "27.3", "31.1", "31.2"]
    },
    {
      "id": 14,
      "tasks": ["25.2", "25.3", "28.1", "28.2", "31.3", "32.1", "40.2", "40.3"]
    },
    {
      "id": 15,
      "tasks": ["28.3", "28.4", "29.1", "32.2", "32.3", "32.4", "40.4", "41.1", "41.2", "41.3"]
    },
    {
      "id": 16,
      "tasks": ["29.2", "29.3", "33.1", "33.2", "35.1", "35.2", "35.3", "35.4", "35.5", "42.1", "42.2", "42.3"]
    },
    {
      "id": 17,
      "tasks": ["36.1", "36.4", "43.1", "45.1", "45.2", "45.3"]
    },
    {
      "id": 18,
      "tasks": ["36.2", "36.3", "37.1", "37.2", "37.3", "46.1", "46.3", "46.4", "47.1"]
    },
    {
      "id": 19,
      "tasks": ["38.1", "38.2", "38.3", "46.2", "47.2", "47.3", "47.4"]
    },
    {
      "id": 20,
      "tasks": ["49.1", "49.2", "55.1", "55.2", "60.1", "60.2", "61.1"]
    },
    {
      "id": 21,
      "tasks": ["49.3", "50.1", "50.2", "50.3", "56.1", "56.2", "56.3", "61.2", "62.1", "63.1"]
    },
    {
      "id": 22,
      "tasks": ["51.1", "51.2", "51.3", "51.4", "57.1", "57.2", "57.3", "62.2", "62.3", "62.4", "63.2", "63.3", "63.4"]
    },
    {
      "id": 23,
      "tasks": ["52.1", "52.2", "58.1", "63.5", "64.1", "64.2", "65.3"]
    },
    {
      "id": 24,
      "tasks": ["53.1", "53.2", "58.2", "64.3", "64.4", "64.5", "65.1", "65.2"]
    }
  ]
}
```
