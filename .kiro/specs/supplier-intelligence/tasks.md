# Implementation Plan: Supplier Intelligence Platform

## Overview

This plan implements the Supplier Intelligence Platform as a new `services/supplier-intelligence/` workspace with Lambda handlers, Step Functions orchestration, SQS queues, and a seller dashboard frontend for managing supplier profiles and processing multi-source product imports. Implementation uses TypeScript throughout, following existing MerchOS patterns (middy middleware, AWS Powertools, DynamoDB tenant isolation, CDK infrastructure).

## Tasks

- [x] 1. Set up service workspace and shared types
  - [x] 1.1 Create the `services/supplier-intelligence/` workspace structure
    - Create directory structure: `handlers/`, `processors/`, `schemas/`, `utils/`, `__tests__/properties/`, `__tests__/unit/`, `__tests__/integration/`
    - Create `package.json` with dependencies: `@middy/core`, `csv-parse`, `exceljs`, `pdf-parse`, `cheerio`, `robots-parser`, `zod`, `fast-check` (dev), `vitest` (dev)
    - Create `tsconfig.json` extending `../../tsconfig.base.json`
    - Create `vitest.config.ts` following the pattern from `services/auth/vitest.config.ts`
    - _Requirements: 11.1, 11.4_

  - [x] 1.2 Define TypeScript interfaces and types for the supplier-intelligence domain
    - Create `services/supplier-intelligence/types/supplier.types.ts` with `SupplierProfile`, `SupplierVersion`, `ImportJob`, `ImportMetadata`, `ImportJobStatus`, `SourceType`, `DuplicateStrategy` interfaces
    - Create `services/supplier-intelligence/types/validation.types.ts` with `ValidationResult`, `ValidatedRecord`, `FieldError`, `FieldCoercion` interfaces
    - Create `services/supplier-intelligence/types/crawl.types.ts` with `CrawlConfig`, `CrawlSession`, `CrawlStats`, `DuplicateCheckResult` interfaces
    - Create `services/supplier-intelligence/types/events.types.ts` with `SupplierProfileChangedEvent`, `ImportJobCompletedEvent`, `ImportJobFailedEvent` interfaces
    - _Requirements: 1.1, 2.1, 4.1, 5.5, 7.1, 8.1_

  - [x] 1.3 Create Zod request validation schemas
    - Create `services/supplier-intelligence/schemas/supplier.schema.ts` with `createSupplierSchema`, `updateSupplierSchema`
    - Create `services/supplier-intelligence/schemas/import.schema.ts` with `triggerFileImportSchema`, `triggerImageImportSchema`, `triggerUrlImportSchema`
    - Enforce max file size 50MB, valid content types, URL format, crawl depth 1-5
    - _Requirements: 1.6, 2.7, 4.3, 12.4_

- [x] 2. Implement Supplier Profile CRUD handlers
  - [x] 2.1 Implement `createSupplier` handler
    - Create `services/supplier-intelligence/handlers/create-supplier.ts`
    - Use middy pipeline with `withPowertools`, `tenantContextMiddleware`, `rbacMiddleware({ requiredPermission: 'supplier:manage' })`, `rateLimitMiddleware`, `inputValidationMiddleware`
    - Store in DynamoDB with PK `TENANT#{tenantId}`, SK `SUPPLIER#{supplierId}`, version=1
    - Emit `SupplierProfileChanged` event to EventBridge
    - Return 201 with created supplier record
    - _Requirements: 1.1, 1.5, 12.1, 12.2, 12.3, 12.4, 12.5_

  - [x] 2.2 Implement `listSuppliers` handler
    - Create `services/supplier-intelligence/handlers/list-suppliers.ts`
    - Query DynamoDB GSI1 with tenant-scoped PK, support pagination via `lastEvaluatedKey`
    - Return paginated supplier list scoped to JWT tenant
    - _Requirements: 1.4, 12.3_

  - [x] 2.3 Implement `getSupplier` and `updateSupplier` handlers
    - Create `services/supplier-intelligence/handlers/get-supplier.ts` with tenant-scoped get
    - Create `services/supplier-intelligence/handlers/update-supplier.ts` with version increment, snapshot of previous version stored as `SUPPLIER#{supplierId}#VERSION#{version}` SK
    - Emit `SupplierProfileChanged` event on update
    - _Requirements: 1.2, 1.3, 1.5, 12.3_

  - [x] 2.4 Implement `getSupplierVersions` handler
    - Create `services/supplier-intelligence/handlers/get-supplier-versions.ts`
    - Query version history items by PK+SK prefix `SUPPLIER#{supplierId}#VERSION#`
    - Return chronologically ordered version list
    - _Requirements: 1.2, 1.3_

  - [ ]* 2.5 Write property tests for supplier profile operations
    - **Property 1: Tenant isolation invariant** — verify all returned records match JWT tenantId
    - **Property 2: Supplier version history integrity** — verify N updates produce N+1 versions with monotonic version numbers
    - **Property 3: Invalid payload rejection** — verify invalid payloads return 400 with field-level errors
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.6, 12.3**

  - [ ]* 2.6 Write unit tests for supplier handlers
    - Test middleware pipeline wiring (RBAC, tenant context, rate limit)
    - Test EventBridge event emission on create/update
    - Test pagination cursor handling
    - _Requirements: 1.1, 1.2, 1.4, 1.5_

- [x] 3. Implement Import Job management and queue integration
  - [x] 3.1 Implement `triggerFileImport` handler
    - Create `services/supplier-intelligence/handlers/trigger-file-import.ts`
    - Accept multipart upload, store raw file in S3 at `suppliers/{tenantId}/{supplierId}/{filename}`
    - Create ImportJob record in DynamoDB with status QUEUED
    - Send SQS message to FIFO queue with MessageGroupId=tenantId
    - Return 202 Accepted with importJobId
    - _Requirements: 2.5, 5.1, 5.2_

  - [x] 3.2 Implement `triggerImageImport` and `triggerUrlImport` handlers
    - Create `services/supplier-intelligence/handlers/trigger-image-import.ts` for image batch uploads
    - Create `services/supplier-intelligence/handlers/trigger-url-import.ts` for URL-based imports
    - Both follow same pattern: store source, create ImportJob, enqueue to SQS
    - _Requirements: 3.1, 4.1, 5.1_

  - [x] 3.3 Implement `listImportJobs`, `getImportJob`, and `getSupplierImports` handlers
    - Create `services/supplier-intelligence/handlers/list-import-jobs.ts` with filtering by status, supplier, source type, date range using GSI2
    - Create `services/supplier-intelligence/handlers/get-import-job.ts` for single job details
    - Create `services/supplier-intelligence/handlers/get-supplier-imports.ts` using GSI1 for supplier-scoped history
    - All return paginated results sorted by createdAt descending
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 10.1, 10.3_

  - [ ]* 3.4 Write property tests for import job queries
    - **Property 18: Import job chronological ordering** — verify results are always sorted by createdAt descending with no duplicates across pages
    - **Property 19: Import job filtering correctness** — verify every returned job matches ALL active filter criteria
    - **Validates: Requirements 9.1, 9.5, 10.3**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement file parsing processors
  - [x] 5.1 Implement CSV/Excel file parser Lambda
    - Create `services/supplier-intelligence/processors/file-parser.ts`
    - Parse CSV using `csv-parse` with auto-detection of delimiters and headers
    - Parse Excel using `exceljs` iterating all worksheets
    - Map column headers to Product field names (title, sku, price, description, images, category, brand)
    - Return array of parsed records with source row indices
    - _Requirements: 2.1, 2.2_

  - [x] 5.2 Implement PDF parser Lambda
    - Create `services/supplier-intelligence/processors/pdf-parser.ts`
    - Use `pdf-parse` to extract text content and tabular data
    - Apply heuristics to identify product records from text blocks
    - _Requirements: 2.3_

  - [x] 5.3 Implement ZIP archive handler
    - Create `services/supplier-intelligence/processors/zip-handler.ts`
    - Extract files from ZIP archive, identify MIME type per entry
    - Route each file to the correct parser (CSV, Excel, PDF, or image processor)
    - Aggregate results from all sub-files into a single record set
    - _Requirements: 2.4_

  - [ ]* 5.4 Write property tests for file parsing
    - **Property 4: File parsing produces DRAFT products** — verify parsed records have `lifecycleState: DRAFT` and correct field mapping with record count matching source row count
    - **Property 5: ZIP archive routes files to correct parser** — verify each extracted file is dispatched to the parser matching its MIME type
    - **Property 6: Corrupted content marks job FAILED** — verify unparseable content transitions job to FAILED with no partial records
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.8**

- [x] 6. Implement image OCR processor
  - [x] 6.1 Implement image processor Lambda with Textract integration
    - Create `services/supplier-intelligence/processors/image-processor.ts`
    - Call AWS Textract `detectDocumentText` for each image
    - Extract product name, price, SKU from OCR response with confidence scores
    - Store original images in assets S3 bucket, link as hero image on Product_Record
    - Flag fields with confidence < 0.70 for manual review
    - _Requirements: 3.1, 3.3, 3.4_

  - [x] 6.2 Implement WhatsApp webhook handler
    - Create `services/supplier-intelligence/handlers/whatsapp-webhook.ts`
    - Validate HMAC signature on incoming webhook payload
    - Extract image URLs from WhatsApp message payload
    - Download images and enqueue for processing via same image pipeline
    - _Requirements: 3.2_

  - [ ]* 6.3 Write property test for OCR confidence thresholding
    - **Property 7: OCR confidence thresholding** — verify fields below 0.70 are flagged for review and fields at/above 0.70 are not
    - **Validates: Requirements 3.4**

- [x] 7. Implement URL crawler and web import engine
  - [x] 7.1 Implement robots.txt parser and URL import entry point
    - Create `services/supplier-intelligence/processors/url-crawler.ts`
    - Fetch and parse robots.txt using `robots-parser` library
    - Reject crawl if target path is disallowed, return 422 with user-friendly message
    - _Requirements: 4.1, 4.2, 4.13_

  - [x] 7.2 Implement BFS page crawler with depth limit and rate limiting
    - Add BFS traversal logic in `url-crawler.ts` respecting configurable depth limit
    - Enforce 1 request/second/domain rate limiting
    - Follow pagination links within depth budget
    - Persist crawl progress state for resumability (pages visited, queue remaining)
    - _Requirements: 4.3, 4.6, 4.8, 4.10_

  - [x] 7.3 Implement product data extraction from HTML
    - Create `services/supplier-intelligence/processors/html-extractor.ts`
    - Use `cheerio` to parse HTML and extract product data (name, description, SKU, brand, category, price, stock, images, variations, specs)
    - Download product images and store in assets S3 bucket
    - _Requirements: 4.4, 4.5_

  - [x] 7.4 Implement circuit breaker for external HTTP calls
    - Create `services/supplier-intelligence/utils/circuit-breaker.ts`
    - Track consecutive failures per domain (threshold: 5 within 60s)
    - Transition CLOSED → OPEN after threshold, pause 120s, then HALF_OPEN with probe request
    - _Requirements: 14.5_

  - [x] 7.5 Implement crawl statistics recording and session completion
    - Record crawl stats: pages crawled, pages skipped, products extracted, images downloaded, errors, duration
    - Support incremental import by comparing extracted products against existing records, updating only changed fields
    - _Requirements: 4.7, 4.11, 4.12_

  - [ ]* 7.6 Write property tests for URL crawler components
    - **Property 8: robots.txt compliance** — verify allow/disallow directives are correctly parsed and enforced
    - **Property 9: Crawl depth limit enforcement** — verify no page beyond depth D is visited regardless of link structure
    - **Property 21: Circuit breaker state transitions** — verify CLOSED→OPEN after 5 failures, 120s pause, then HALF_OPEN
    - **Property 22: Crawl session resumability** — verify resumed sessions don't reprocess completed pages
    - **Property 23: Incremental import** — verify only changed fields are updated
    - **Validates: Requirements 4.2, 4.3, 4.10, 4.11, 4.12, 14.5**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement validation engine and duplicate detector
  - [x] 9.1 Implement validation engine Lambda
    - Create `services/supplier-intelligence/processors/validation-engine.ts`
    - Validate required fields: title (non-empty), sku (non-empty), and at least one of (images[0] or description)
    - Implement price normalisation: strip currency symbols ($, €, £, ¥), remove thousand separators, parse to float
    - Implement type coercion: string → number for price fields, string → date for date fields
    - Produce `ValidationResult` with totalRecords, passed, failed, per-field error counts
    - Mark failed records as VALIDATION_FAILED with field-level error details
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 9.2 Implement duplicate detector Lambda
    - Create `services/supplier-intelligence/processors/duplicate-detector.ts`
    - Primary check: exact SKU match via DynamoDB GSI query within tenant scope
    - Secondary check: normalised Levenshtein distance on title (threshold 0.85)
    - Apply supplier's configured `duplicateStrategy`: SKIP (no record), MERGE (update existing), CREATE_FLAGGED (new record with `duplicateOf` flag)
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 9.3 Write property tests for validation engine
    - **Property 12: Required field validation** — verify VALID iff title + sku + (image or description) present
    - **Property 13: Price normalisation** — verify correct numeric output and idempotency
    - **Property 14: Type coercion correctness** — verify valid numbers coerce correctly, invalid strings are flagged
    - **Property 15: Validation summary consistency** — verify totalRecords == passed + failed, field error count consistency
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

  - [ ]* 9.4 Write property tests for duplicate detector
    - **Property 10: Duplicate detection** — verify SKU exact match detection and title similarity threshold 0.85
    - **Property 11: Duplicate strategy dispatch** — verify SKIP produces no record, MERGE updates existing, CREATE_FLAGGED creates with flag
    - **Validates: Requirements 7.1, 7.2, 7.4**

- [x] 10. Implement product persister and import status state machine
  - [x] 10.1 Implement product persister Lambda
    - Create `services/supplier-intelligence/processors/product-persister.ts`
    - Batch write Product records to DynamoDB in DRAFT state
    - Attach `importMetadata` (sourceImportJobId, sourceSupplierId, sourceType, importedAt, ocrConfidence, flaggedForReview, duplicateOf)
    - Update ImportJob status to COMPLETED with result summary
    - Implement partial failure preservation: commit batches as they succeed, preserve records before failure point
    - _Requirements: 2.1, 10.2, 14.3_

  - [x] 10.2 Implement import job status update utility
    - Create `services/supplier-intelligence/utils/import-job-status.ts`
    - Enforce valid status transitions: QUEUED → PROCESSING → VALIDATING → PERSISTING → COMPLETED, or any active → FAILED
    - Reject invalid transitions, no regression to previous active state
    - Update progress metadata (percentage, currentStep, estimatedTimeRemaining)
    - _Requirements: 5.5, 8.4_

  - [x] 10.3 Implement EventBridge event emission utilities
    - Create `services/supplier-intelligence/utils/event-emitter.ts`
    - Emit `ImportJobCompleted` event with job ID, product count, and summary statistics
    - Emit `ImportJobFailed` event with job ID and error details
    - Source: `merch-os.supplier-intelligence`
    - _Requirements: 8.1, 8.2_

  - [ ]* 10.4 Write property tests for persister and status machine
    - **Property 16: Import job status state machine** — verify only valid transitions occur, no regression
    - **Property 17: Import provenance metadata** — verify Product records have correct importMetadata and S3 key pattern
    - **Property 20: Partial failure preservation** — verify records before failure point are retained
    - **Validates: Requirements 5.5, 10.2, 14.3**

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement CDK infrastructure stack
  - [x] 12.1 Create the `SupplierIntelligenceStack` CDK stack
    - Create `infrastructure/lib/supplier-intelligence-stack.ts`
    - Define DynamoDB tables (Suppliers, Import Jobs) with PK `TENANT#{tenantId}` pattern, GSIs for queries
    - Define SQS FIFO queue with DLQ (14-day retention), message group ID for tenant-scoped FIFO ordering
    - Import Foundation Stack resources via SSM parameters (KMS key, EventBridge bus, S3 buckets)
    - _Requirements: 11.1, 11.2, 11.5_

  - [x] 12.2 Define Lambda functions and Step Functions state machine in CDK
    - Define all Lambda functions with Node.js 20 runtime, AWS Powertools layers, X-Ray tracing enabled
    - Define Step Functions Express state machine with the import workflow (DetermineSourceType → Parse → Validate → Deduplicate → Persist)
    - Configure retry policies: transient errors (3x, 2s base), DynamoDB throttling (5x, 1s base with jitter), S3 failures (3x)
    - _Requirements: 11.1, 11.4, 5.2, 5.3_

  - [x] 12.3 Define API Gateway routes and IAM policies in CDK
    - Define HTTP API Gateway routes matching the Supplier API table (all endpoints with JWT authorizer)
    - Apply IAM least-privilege per Lambda: only specific DynamoDB table/index, S3 bucket, SQS queue, and EventBridge permissions
    - Configure rate limiting at API Gateway level
    - _Requirements: 11.3, 12.1, 12.5_

  - [x] 12.4 Define CloudWatch alarms and monitoring in CDK
    - Alarm: Import_Job failure rate > 10% over 5 minutes
    - Alarm: Import_Queue depth > 100 messages
    - Alarm: Lambda error rate > 5%
    - Alarm: DLQ depth > 0 messages
    - _Requirements: 11.6, 13.1, 13.2, 13.3_

  - [ ]* 12.5 Write CDK infrastructure tests
    - Snapshot test for the full stack
    - Assert all Lambda functions use Node.js 20 runtime
    - Assert IAM roles have no wildcard actions
    - Assert DynamoDB tables use `TENANT#{tenantId}` partition key
    - Assert SQS FIFO queue has DLQ configured
    - Assert CloudWatch alarms are defined
    - Assert all routes have JWT authorizer
    - _Requirements: 11.1, 11.3, 11.4, 11.5, 11.6_

- [x] 13. Implement Import Dashboard frontend
  - [x] 13.1 Create import job list page with filters
    - Create `apps/seller-dashboard/app/(dashboard)/imports/page.tsx`
    - Create `apps/seller-dashboard/app/(dashboard)/imports/components/ImportFilters.tsx` with filter controls (status, supplier, source type, date range)
    - Implement paginated job list using `@tanstack/react-query` for data fetching
    - Display job status, supplier name, source type, creation date, result summary
    - _Requirements: 9.1, 9.3, 9.5_

  - [x] 13.2 Create import job detail page
    - Create `apps/seller-dashboard/app/(dashboard)/imports/[importJobId]/page.tsx`
    - Display full import details: source file/URL, supplier name, total extracted, created, updated, duplicates, validation failures, duration
    - Create `apps/seller-dashboard/app/(dashboard)/imports/components/ImportProgress.tsx` with real-time progress bar (polling)
    - Create `apps/seller-dashboard/app/(dashboard)/imports/components/ValidationErrorReport.tsx` for downloadable error report table
    - _Requirements: 9.2, 9.4, 8.4_

  - [x] 13.3 Create supplier management pages
    - Create `apps/seller-dashboard/app/(dashboard)/suppliers/page.tsx` for supplier list
    - Create `apps/seller-dashboard/app/(dashboard)/suppliers/[supplierId]/page.tsx` for supplier detail with import history and version history
    - Create import trigger UI (file upload, image upload, URL input) on supplier detail page
    - Use Radix UI primitives for accessible form controls
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 10.3_

  - [ ]* 13.4 Write unit tests for dashboard components
    - Test ImportFilters component renders filter controls and emits correct filter state
    - Test ImportProgress component displays correct progress bar states
    - Test ValidationErrorReport renders error table and download functionality
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [x] 14. Wire end-to-end flow and integration
  - [x] 14.1 Connect SQS consumer to Step Functions trigger
    - Create `services/supplier-intelligence/handlers/import-queue-consumer.ts`
    - Parse SQS message, start Step Functions execution with import job parameters
    - Handle DLQ routing for messages that fail after max retries
    - _Requirements: 5.2, 14.4_

  - [x] 14.2 Implement tenant concurrency limiter
    - Create `services/supplier-intelligence/utils/concurrency-limiter.ts`
    - Query active import jobs per tenant before starting new execution
    - Enforce limit of 5 simultaneous Import_Jobs per tenant
    - Return message to queue if limit reached (visibility timeout)
    - _Requirements: 5.6_

  - [x] 14.3 Wire observability: structured logging and X-Ray tracing
    - Add AWS Powertools Logger with correlation IDs (tenantId, importJobId, supplierId) to all handlers and processors
    - Configure X-Ray tracing across Lambda → Step Functions → SQS message processing chain
    - Emit custom CloudWatch metrics: imports initiated/completed/failed (counters), import duration (histogram), products extracted (counter) dimensioned by tenant and source type
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 14.4 Write integration tests for end-to-end import flow
    - Test file upload → SQS enqueue → Step Functions → DynamoDB product creation
    - Test tenant isolation in import job queries
    - Test DLQ routing after max retries
    - Test partial failure preservation
    - _Requirements: 5.1, 5.2, 12.3, 14.3, 14.4_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing MerchOS codebase patterns
- All Lambda handlers follow the established middy middleware pipeline with AWS Powertools
- DynamoDB access patterns use the existing `TENANT#{tenantId}` partition key pattern for tenant isolation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.3", "2.4", "3.1", "3.2"] },
    { "id": 3, "tasks": ["2.5", "2.6", "3.3"] },
    { "id": 4, "tasks": ["3.4"] },
    { "id": 5, "tasks": ["5.1", "5.2", "5.3", "6.1", "6.2", "7.1"] },
    { "id": 6, "tasks": ["5.4", "6.3", "7.2", "7.3", "7.4"] },
    { "id": 7, "tasks": ["7.5", "7.6"] },
    { "id": 8, "tasks": ["9.1", "9.2"] },
    { "id": 9, "tasks": ["9.3", "9.4", "10.1", "10.2", "10.3"] },
    { "id": 10, "tasks": ["10.4"] },
    { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["12.2", "12.3", "12.4"] },
    { "id": 13, "tasks": ["12.5", "13.1", "13.3"] },
    { "id": 14, "tasks": ["13.2", "13.4"] },
    { "id": 15, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 16, "tasks": ["14.4"] }
  ]
}
```
