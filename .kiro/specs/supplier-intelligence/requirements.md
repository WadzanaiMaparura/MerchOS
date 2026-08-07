# Requirements Document

## Introduction

The Supplier Intelligence Platform extends MerchOS with end-to-end supplier data ingestion capabilities. Sellers can import product catalogues from multiple data sources (CSV, Excel, PDF, ZIP, images, WhatsApp, and website URLs), manage supplier profiles with full version history, and monitor imports through a real-time dashboard. The platform integrates with the existing MerchOS product lifecycle, leveraging the established EventBridge event bus, DynamoDB tenant isolation patterns, S3 storage buckets, and middy-based Lambda middleware. All imports feed into the existing Product ingestion pipeline, transitioning products from DRAFT to INGESTED state.

## Glossary

- **Import_Engine**: The backend subsystem responsible for orchestrating file parsing, data extraction, validation, and product record creation from supplier data sources
- **URL_Import_Engine**: A specialised component of the Import_Engine that crawls permitted supplier websites, extracts product data from publicly accessible pages, and downloads product images
- **Supplier_Profile**: A tenant-scoped record representing a supplier entity, including contact details, import configuration, and relationship metadata
- **Import_Job**: A single unit of work representing the ingestion of one data source (file, URL, or image batch) through the Import_Engine pipeline
- **Import_Queue**: An SQS-backed queue that holds pending Import_Jobs for background processing with concurrency control
- **Validation_Engine**: The component that applies schema validation, data quality checks, and business rules to extracted product data before persistence
- **Crawl_Session**: A single URL import execution comprising page discovery, data extraction, and image download within configured depth and rate limits
- **Seller_Dashboard**: The Next.js frontend application used by sellers to manage suppliers, trigger imports, and monitor import progress
- **Supplier_API**: The HTTP API Gateway endpoints exposing supplier management and import operations
- **Step_Function**: An AWS Step Functions state machine that orchestrates multi-step import workflows including parsing, validation, enrichment, and persistence
- **Product_Record**: A canonical product entity stored in DynamoDB following the existing MerchOS Product schema with tenant isolation (PK: TENANT#{tenantId})
- **Duplicate_Detector**: The component that identifies potential duplicate products using SKU matching, title similarity, and image fingerprinting
- **Import_Dashboard**: The frontend view providing real-time visibility into import job status, statistics, and error details

## Requirements

### Requirement 1: Supplier Profile Management

**User Story:** As a seller, I want to create and manage supplier profiles, so that I can organise my product sources and track import history per supplier.

#### Acceptance Criteria

1. WHEN a seller submits a valid supplier profile payload, THE Supplier_API SHALL create a new Supplier_Profile record scoped to the seller's tenant
2. WHEN a seller updates an existing Supplier_Profile, THE Supplier_API SHALL create a new version of the profile and retain the previous version in version history
3. THE Supplier_API SHALL return the complete version history for a Supplier_Profile when requested
4. WHEN a seller requests a list of suppliers, THE Supplier_API SHALL return a paginated list of Supplier_Profiles scoped to the seller's tenant
5. WHEN a Supplier_Profile is created or updated, THE Import_Engine SHALL emit a domain event to the EventBridge bus with source "merch-os.supplier-intelligence" and detail-type "SupplierProfileChanged"
6. IF a supplier profile payload fails schema validation, THEN THE Supplier_API SHALL return a 400 response with field-level error details

### Requirement 2: File-Based Data Import

**User Story:** As a seller, I want to import supplier product data from CSV, Excel, PDF, and ZIP files, so that I can onboard product catalogues without manual data entry.

#### Acceptance Criteria

1. WHEN a seller uploads a CSV file, THE Import_Engine SHALL parse the file, map columns to Product_Record fields, and create Product_Records in DRAFT state
2. WHEN a seller uploads an Excel (.xlsx) file, THE Import_Engine SHALL parse all sheets, map columns to Product_Record fields, and create Product_Records in DRAFT state
3. WHEN a seller uploads a PDF catalogue, THE Import_Engine SHALL extract text and tabular data using document processing, map extracted fields to Product_Record fields, and create Product_Records in DRAFT state
4. WHEN a seller uploads a ZIP archive, THE Import_Engine SHALL extract all supported files (CSV, Excel, PDF, images) and process each file according to its type
5. WHEN a file upload is received, THE Import_Engine SHALL store the raw file in the existing raw-uploads S3 bucket with the key prefix "suppliers/{tenantId}/{supplierId}/"
6. WHEN file parsing produces extractable product images, THE Import_Engine SHALL store images in the existing assets S3 bucket and link them to the corresponding Product_Record
7. IF a file exceeds 50MB in size, THEN THE Supplier_API SHALL reject the upload with a 413 response and a descriptive error message
8. IF a file contains unparseable or corrupted content, THEN THE Import_Engine SHALL mark the Import_Job as FAILED, log the error details, and notify the seller

### Requirement 3: Image-Based Import

**User Story:** As a seller, I want to import products from product images and WhatsApp image uploads, so that I can capture product data from visual sources.

#### Acceptance Criteria

1. WHEN a seller uploads one or more product images, THE Import_Engine SHALL extract visible text (product name, price, SKU) using optical character recognition and create Product_Records in DRAFT state
2. WHEN a seller forwards product images via WhatsApp integration, THE Import_Engine SHALL receive the images through the configured webhook, process them identically to direct image uploads, and create Product_Records in DRAFT state
3. WHEN image-based extraction completes, THE Import_Engine SHALL store the original images in the assets S3 bucket and associate them as the hero image on the corresponding Product_Record
4. IF optical character recognition confidence is below 0.70 for an extracted field, THEN THE Import_Engine SHALL flag the field for manual review on the Product_Record

### Requirement 4: URL-Based Import

**User Story:** As a seller, I want to import products from a supplier's website by providing a URL, so that I can onboard catalogues from online sources without manual data entry.

#### Acceptance Criteria

1. WHEN a seller submits a supplier website URL, THE URL_Import_Engine SHALL fetch and parse the site's robots.txt file to determine crawling permissions before accessing any pages
2. IF robots.txt disallows crawling of the target URL path, THEN THE URL_Import_Engine SHALL reject the import request and return a clear message explaining that the website does not permit automated data collection
3. WHEN crawling is permitted, THE URL_Import_Engine SHALL respect the configured crawl depth limit (default: 3 levels) and stop traversal beyond that depth
4. WHEN the URL_Import_Engine encounters a product listing page, THE URL_Import_Engine SHALL extract: product name, description, SKU, brand, category, price, stock availability, product images, variations, and specifications where available on the page
5. WHEN product images are found on crawled pages, THE URL_Import_Engine SHALL download the images and store them in the assets S3 bucket linked to the corresponding Product_Record
6. WHEN a crawled page contains pagination controls, THE URL_Import_Engine SHALL follow pagination links within the configured depth to discover additional product pages
7. THE URL_Import_Engine SHALL detect duplicate products within the same Crawl_Session using SKU and title matching, and skip already-extracted products
8. THE URL_Import_Engine SHALL enforce rate limiting of a maximum of 1 request per second per target domain to avoid overloading supplier websites
9. IF a page returns an HTTP error status (4xx or 5xx), THEN THE URL_Import_Engine SHALL log the inaccessible URL, skip the page, and continue crawling remaining pages
10. WHEN a Crawl_Session is interrupted (timeout or transient failure), THE URL_Import_Engine SHALL persist progress state to allow resumption from the last successfully processed page
11. WHEN a Crawl_Session completes, THE URL_Import_Engine SHALL record crawl statistics including: pages crawled, pages skipped, products extracted, images downloaded, errors encountered, and total duration
12. THE URL_Import_Engine SHALL support incremental imports by comparing extracted products against existing Product_Records for the same supplier and updating only changed fields
13. THE URL_Import_Engine SHALL NOT attempt to bypass anti-bot protections, authentication walls, CAPTCHAs, or access restrictions on supplier websites

### Requirement 5: Import Queue and Background Processing

**User Story:** As a seller, I want my imports to be processed reliably in the background, so that I can continue working while large catalogues are being ingested.

#### Acceptance Criteria

1. WHEN a seller initiates an import, THE Import_Engine SHALL enqueue the Import_Job onto the Import_Queue and return an Import_Job identifier immediately
2. THE Step_Function SHALL process Import_Jobs from the Import_Queue in FIFO order within a tenant scope, executing parsing, validation, and persistence steps sequentially
3. IF an Import_Job step fails with a transient error, THEN THE Step_Function SHALL retry the failed step up to 3 times with exponential backoff (base delay: 2 seconds)
4. IF an Import_Job fails after all retries are exhausted, THEN THE Step_Function SHALL mark the Import_Job as FAILED and emit a "ImportJobFailed" event to the EventBridge bus
5. WHILE an Import_Job is processing, THE Import_Engine SHALL update the Import_Job status (QUEUED, PROCESSING, VALIDATING, PERSISTING, COMPLETED, FAILED) in real time
6. THE Import_Queue SHALL apply a tenant-level concurrency limit of 5 simultaneous Import_Jobs to prevent resource exhaustion

### Requirement 6: Data Validation

**User Story:** As a seller, I want imported product data to be validated automatically, so that only quality data enters my product catalogue.

#### Acceptance Criteria

1. WHEN product data is extracted from any source, THE Validation_Engine SHALL validate each Product_Record against the required field schema (title, SKU, and at least one image or description are mandatory)
2. WHEN the Validation_Engine encounters a field that violates type constraints (numeric price stored as text, invalid date format), THE Validation_Engine SHALL attempt automatic type coercion and flag the field for review if coercion fails
3. THE Validation_Engine SHALL normalise product prices to a consistent numeric format, stripping currency symbols and thousand separators
4. IF a Product_Record fails validation, THEN THE Validation_Engine SHALL mark the record with validation errors and include the record in the Import_Job results with status VALIDATION_FAILED
5. WHEN validation completes for an Import_Job, THE Validation_Engine SHALL produce a validation summary containing: total records processed, records passed, records failed, and per-field error counts

### Requirement 7: Duplicate Detection

**User Story:** As a seller, I want the system to detect duplicate products during import, so that I avoid creating redundant catalogue entries.

#### Acceptance Criteria

1. WHEN a new Product_Record is extracted, THE Duplicate_Detector SHALL check for existing products within the same tenant using exact SKU match as the primary key
2. WHEN no exact SKU match is found, THE Duplicate_Detector SHALL perform title similarity comparison (threshold: 0.85 normalised score) against existing products for the same supplier
3. WHEN a potential duplicate is detected, THE Duplicate_Detector SHALL flag the Product_Record as a suspected duplicate and include the matching existing product identifier in the Import_Job results
4. THE Duplicate_Detector SHALL allow sellers to configure duplicate handling strategy per supplier: SKIP duplicates, MERGE with existing record, or CREATE as new record with duplicate flag

### Requirement 8: Notification and Feedback

**User Story:** As a seller, I want to receive notifications about import progress and completion, so that I stay informed without constantly checking the dashboard.

#### Acceptance Criteria

1. WHEN an Import_Job transitions to COMPLETED state, THE Import_Engine SHALL emit an "ImportJobCompleted" event to the EventBridge bus containing the job identifier, product count, and summary statistics
2. WHEN an Import_Job transitions to FAILED state, THE Import_Engine SHALL emit an "ImportJobFailed" event to the EventBridge bus containing the job identifier and error details
3. WHEN a URL import is rejected because the website does not permit crawling, THE URL_Import_Engine SHALL return a user-facing message explaining that the website's robots.txt or terms prohibit automated access
4. WHILE an Import_Job is processing, THE Import_Dashboard SHALL display real-time progress including percentage complete, current processing step, and estimated time remaining

### Requirement 9: Import Dashboard

**User Story:** As a seller, I want a dashboard to view all my imports, their status, and detailed results, so that I can monitor and troubleshoot my supplier data ingestion.

#### Acceptance Criteria

1. THE Import_Dashboard SHALL display a paginated list of Import_Jobs for the seller's tenant, sorted by creation date (most recent first)
2. WHEN a seller selects an Import_Job, THE Import_Dashboard SHALL display detailed results including: source file or URL, supplier name, total products extracted, products created, products updated, duplicates detected, validation failures, and processing duration
3. THE Import_Dashboard SHALL display the current status of each Import_Job using the status values: QUEUED, PROCESSING, VALIDATING, PERSISTING, COMPLETED, FAILED
4. WHEN an Import_Job has validation errors, THE Import_Dashboard SHALL display a downloadable error report listing each failed record with field-level error details
5. THE Import_Dashboard SHALL provide a filter interface allowing sellers to filter Import_Jobs by status, supplier, source type, and date range

### Requirement 10: Import History and Auditability

**User Story:** As a seller, I want a complete history of all imports per supplier, so that I can audit data provenance and track changes over time.

#### Acceptance Criteria

1. THE Import_Engine SHALL retain a complete Import_Job history for each Supplier_Profile, including job metadata, source reference, result summary, and timestamp
2. WHEN a Product_Record is created or updated via import, THE Import_Engine SHALL record the source Import_Job identifier and source supplier on the Product_Record metadata
3. THE Supplier_API SHALL return the import history for a Supplier_Profile as a paginated, chronologically ordered list
4. THE Import_Engine SHALL retain import history records for a minimum of 365 days

### Requirement 11: Infrastructure and Deployment

**User Story:** As a platform operator, I want the Supplier Intelligence Platform deployed using CDK infrastructure-as-code, so that the infrastructure is reproducible, auditable, and consistent with MerchOS standards.

#### Acceptance Criteria

1. THE Supplier_Intelligence_Stack SHALL define all infrastructure resources (DynamoDB tables, Lambda functions, API Gateway, Step Functions, SQS queues, IAM roles) using AWS CDK in TypeScript
2. THE Supplier_Intelligence_Stack SHALL integrate with the existing Foundation Stack by importing the platform KMS key, EventBridge bus, and S3 bucket references via SSM parameters
3. THE Supplier_Intelligence_Stack SHALL apply IAM least-privilege policies to all Lambda functions, granting only the specific DynamoDB, S3, SQS, and EventBridge permissions required per function
4. THE Supplier_Intelligence_Stack SHALL configure all Lambda functions with Node.js 20 runtime, AWS Powertools for structured logging and tracing, and middy middleware pipeline
5. THE Supplier_Intelligence_Stack SHALL apply tenant-scope isolation on all DynamoDB tables using the existing partition key pattern (PK: TENANT#{tenantId})
6. THE Supplier_Intelligence_Stack SHALL configure CloudWatch alarms for: Import_Job failure rate exceeding 10% over 5 minutes, Import_Queue depth exceeding 100 messages, and Lambda error rate exceeding 5%

### Requirement 12: API Design and Security

**User Story:** As a platform operator, I want the Supplier Intelligence APIs to follow MerchOS security standards, so that tenant data is protected and access is properly controlled.

#### Acceptance Criteria

1. THE Supplier_API SHALL require a valid Cognito JWT token on all endpoints, validated by the HTTP API Gateway JWT authorizer
2. THE Supplier_API SHALL enforce RBAC using the existing rbacMiddleware, restricting supplier management operations to users with the "supplier:manage" permission
3. THE Supplier_API SHALL enforce tenant isolation by extracting tenantId from the JWT token context and scoping all database queries to that tenant
4. THE Supplier_API SHALL validate all request payloads using Zod schemas via the existing inputValidationMiddleware
5. THE Supplier_API SHALL enforce rate limiting using the existing rateLimitMiddleware with a limit of 100 requests per minute per tenant for standard endpoints and 10 requests per minute per tenant for import-triggering endpoints
6. IF an unauthenticated or unauthorized request is received, THEN THE Supplier_API SHALL return the appropriate HTTP error code (401 or 403) with a standard error response body

### Requirement 13: Monitoring and Observability

**User Story:** As a platform operator, I want comprehensive monitoring of the Supplier Intelligence Platform, so that I can detect issues, analyse performance, and ensure reliability.

#### Acceptance Criteria

1. THE Import_Engine SHALL emit structured logs using AWS Powertools Logger with correlation identifiers (tenantId, importJobId, supplierId) on every log entry
2. THE Import_Engine SHALL emit custom CloudWatch metrics for: imports initiated (counter), imports completed (counter), imports failed (counter), import duration (histogram), and products extracted (counter), dimensioned by tenant and source type
3. THE Import_Engine SHALL propagate X-Ray traces across all Lambda invocations, Step Function executions, and SQS message processing within an import workflow
4. WHEN a Crawl_Session completes, THE URL_Import_Engine SHALL log crawl statistics as structured data including pages crawled, pages blocked, extraction success rate, and total bytes downloaded

### Requirement 14: Error Handling and Resilience

**User Story:** As a platform operator, I want the import pipeline to handle errors gracefully, so that transient failures do not result in data loss or require manual intervention.

#### Acceptance Criteria

1. IF an S3 upload fails during file storage, THEN THE Import_Engine SHALL retry the upload up to 3 times with exponential backoff before marking the Import_Job step as failed
2. IF a DynamoDB write fails with a throttling exception, THEN THE Import_Engine SHALL retry with exponential backoff and jitter (maximum 5 retries, base delay 1 second)
3. WHEN an Import_Job fails, THE Import_Engine SHALL preserve all successfully processed records up to the point of failure, allowing partial results to be retained
4. IF the Import_Queue receives a message that fails processing after the configured retry count, THEN the message SHALL be moved to a dead-letter queue for manual investigation
5. THE Import_Engine SHALL implement circuit-breaker logic for external HTTP calls during URL imports: after 5 consecutive failures to the same domain within 60 seconds, THE URL_Import_Engine SHALL pause crawling for that domain for 120 seconds before retrying
