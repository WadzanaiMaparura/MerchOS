# Requirements Document

## Introduction

MerchOS is a production-grade, multi-tenant SaaS platform designed to serve thousands of eCommerce sellers across multiple marketplacess. Sellers upload raw supplier information — images, PDFs, WhatsApp photos, catalog screenshots, URLs, and text — and MerchOS transforms that information into marketplace-ready product listings, compliant images, category mappings, inventory records, and channel-specific exports.

The platform operates across six sales channels: Takealot, Amazon, Makro Marketplace, Shopify, WooCommerce, and custom eCommerce websites. It is AWS-native, serverless-first, API-first, and built on event-driven architecture using AWS CDK for infrastructure as code.

MerchOS is not a demo or MVP. It is a long-term commercial platform intended to replace manual listing workflows that often require dedicated operational staff.

---

## Glossary

- **Tenant**: An individual seller or seller organisation with an isolated account on the platform.
- **Product**: A structured record representing a physical or digital item a seller intends to sell.
- **Variant**: A specific version of a Product differentiated by attributes such as size, colour, or material.
- **SKU**: Stock Keeping Unit — a unique identifier for a specific Product or Variant.
- **Ingestion Pipeline**: The set of services responsible for accepting raw supplier input and converting it into a structured Product record.
- **Enrichment Engine**: The AI-powered subsystem that extracts attributes, generates descriptions, recommends categories, and translates content.
- **Image Pipeline**: The subsystem responsible for processing, transforming, and validating product images to marketplace specifications.
- **Category Mapping Engine**: The subsystem that maps Products to the correct taxonomy node for each target marketplace.
- **Marketplace Output Engine**: The subsystem that generates channel-specific listing payloads (CSV, API calls) for each supported marketplace.
- **Compliance Engine**: The subsystem that validates Product data and images against the published rules of each marketplace.
- **Inventory Manager**: The subsystem that tracks stock levels, processes supplier feeds, and synchronises availability across channels.
- **Billing Engine**: The subsystem responsible for subscription management, usage metering, and payment processing.
- **Admin Dashboard**: The web interface used by MerchOS operators to manage tenants, monitor the platform, and configure global settings.
- **Seller Dashboard**: The web interface used by Tenants to manage their Products, review AI output, approve listings, and monitor their channels.
- **Channel**: A supported marketplace or storefront (Takealot, Amazon, Makro, Shopify, WooCommerce, Custom Website).
- **Listing**: A Channel-specific representation of a Product, including all required fields for that Channel.
- **Feed**: A structured file or API stream containing supplier stock or product data.
- **Hero Image**: The primary product image shown on a marketplace listing, typically on a white background.
- **Lifecycle State**: The current processing state of a Product or Listing (e.g., INGESTED, ENRICHED, VALIDATED, PUBLISHED, REJECTED).
- **Taxonomy**: The official category hierarchy published by a marketplace.
- **Compliance Rule**: A marketplace-defined constraint on listing content, image dimensions, title length, or other attributes.
- **Bedrock**: AWS Bedrock — the managed AI model service used for text generation, attribute extraction, and language tasks.
- **Textract**: AWS Textract — the managed OCR and document analysis service used to extract structured data from PDFs and images.
- **Rekognition**: AWS Rekognition — the managed image analysis service used for background removal, label detection, and moderation.
- **Step Functions**: AWS Step Functions — the managed workflow orchestration service used to coordinate multi-step processing pipelines.
- **EventBridge**: AWS EventBridge — the managed event bus used to decouple platform subsystems.
- **DynamoDB**: AWS DynamoDB — the primary NoSQL data store for Product, Tenant, Inventory, and Listing records.
- **OpenSearch**: AWS OpenSearch — the search and analytics service used for product catalogue search and audit log queries.
- **Cognito**: AWS Cognito — the managed identity service used for Tenant authentication and authorisation.
- **Amplify**: AWS Amplify — the managed front-end hosting and deployment service for the Seller and Admin Dashboards.
- **API Gateway**: AWS API Gateway — the managed API layer through which all client and integration traffic is routed.
- **Plan**: A named subscription tier (e.g., Starter, Growth, Professional, Enterprise) that defines feature entitlements and usage limits.
- **Webhook**: An HTTP callback sent to a Tenant-configured endpoint when a platform event occurs.
- **Audit Log**: An immutable record of every state-changing operation performed on the platform.

---

## Requirements

---

### Requirement 1: Multi-Tenant Foundation

**User Story:** As a MerchOS operator, I want every seller to operate in a fully isolated tenant environment, so that data, configuration, and processing never leaks between accounts.

#### Acceptance Criteria

1. THE Platform SHALL assign every Tenant a globally unique Tenant ID at registration time.
2. WHEN a Tenant is created, THE Platform SHALL provision isolated storage namespaces, IAM boundaries, and DynamoDB partition keys scoped to that Tenant ID.
3. WHILE processing any request, THE Platform SHALL enforce Tenant ID validation on every API call, storage operation, and event handler.
4. IF a request arrives without a valid Tenant ID, THEN THE API Gateway SHALL reject the request with HTTP 403 before it reaches any business logic.
5. THE Platform SHALL support a minimum of 10,000 concurrent Tenants without cross-tenant data exposure.
6. WHEN a Tenant account is suspended, THE Platform SHALL deny all API access for that Tenant within 60 seconds of suspension.
7. WHEN a Tenant account is deleted, THE Platform SHALL purge all Tenant data from all storage systems within 30 days and confirm purge completion via audit log entry.
8. THE Platform SHALL store Tenant configuration in DynamoDB with Tenant ID as the partition key and enforce row-level access policies.
9. THE Platform SHALL emit an EventBridge event for every Tenant lifecycle change (created, suspended, reactivated, deleted).
10. THE Audit Log SHALL record the actor, timestamp, action, and affected resource for every Tenant lifecycle event.

---

### Requirement 2: Authentication and Authorisation

**User Story:** As a seller, I want to securely log in and manage my team's access, so that only authorised users can view or modify my account.

#### Acceptance Criteria

1. THE Platform SHALL use AWS Cognito as the sole identity provider for all Tenant and Admin user authentication.
2. WHEN a user registers, THE Platform SHALL require email verification before granting access to any Tenant resources.
3. THE Platform SHALL enforce multi-factor authentication for all Admin Dashboard users.
4. WHERE a Tenant enables MFA for their organisation, THE Platform SHALL require MFA for all users within that Tenant.
5. THE Platform SHALL support role-based access control with at minimum the following roles: Owner, Admin, Editor, and Viewer.
6. WHEN a user attempts an action outside their assigned role, THE Platform SHALL deny the action and return HTTP 403.
7. THE Platform SHALL issue short-lived JWT access tokens with a maximum validity of 60 minutes and refresh tokens with a maximum validity of 30 days.
8. WHEN a refresh token expires or is revoked, THE Platform SHALL require the user to re-authenticate.
9. THE Platform SHALL support SAML 2.0 federation for Enterprise Plan Tenants.
10. THE Audit Log SHALL record every authentication event including login, logout, failed login, token refresh, and MFA verification.
11. IF a user account records five consecutive failed login attempts within a 10-minute window, THEN THE Platform SHALL lock the account and notify the Tenant Owner by email.

---

### Requirement 3: Product Data Ingestion Pipeline

**User Story:** As a seller, I want to upload supplier information in any format I receive it — images, PDFs, URLs, text, or catalogs — and have the platform extract structured product data automatically, so that I do not spend hours on manual data entry.

#### Acceptance Criteria

1. THE Ingestion Pipeline SHALL accept the following input formats: JPEG, PNG, WEBP, HEIC image files; PDF documents; plain text; URLs pointing to supplier websites or existing marketplace listings; and ZIP archives containing any combination of the above.
2. WHEN a file is uploaded, THE Ingestion Pipeline SHALL validate the file type, scan for malware, and reject any file that fails either check before processing begins.
3. THE Ingestion Pipeline SHALL support individual file uploads up to 50 MB and batch ZIP uploads up to 500 MB.
4. WHEN a URL is submitted, THE Ingestion Pipeline SHALL fetch the page content, extract structured product data, and store the extraction result within 120 seconds.
5. WHEN a PDF is submitted, THE Ingestion Pipeline SHALL use Textract to extract all text, tables, and key-value pairs from the document.
6. WHEN an image is submitted, THE Ingestion Pipeline SHALL use Rekognition to identify product labels and attributes and Bedrock to generate a structured attribute set.
7. THE Ingestion Pipeline SHALL assign each ingestion job a unique Job ID and expose job status via the API with the following states: QUEUED, PROCESSING, COMPLETED, FAILED.
8. WHEN an ingestion job fails, THE Ingestion Pipeline SHALL record the failure reason, retain the original input file for 7 days, and notify the Tenant via EventBridge event.
9. THE Ingestion Pipeline SHALL process a single product ingestion job to COMPLETED or FAILED state within 5 minutes under normal load.
10. WHEN multiple source files are uploaded together, THE Ingestion Pipeline SHALL merge extracted attributes from all sources into a single candidate Product record, with conflict resolution preferring the most recently uploaded source.
11. THE Ingestion Pipeline SHALL support ingestion of existing marketplace listings by accepting Takealot, Amazon, Makro, Shopify, and WooCommerce listing URLs and extracting all available product attributes.
12. FOR ALL ingestion inputs, THE Ingestion Pipeline SHALL produce a structured output conforming to the canonical Product schema before passing the record to the Enrichment Engine.

---

### Requirement 4: AI Enrichment Engine

**User Story:** As a seller, I want the platform to automatically generate product titles, descriptions, attributes, and category recommendations from my raw supplier data, so that I get marketplace-ready content without writing it myself.

#### Acceptance Criteria

1. WHEN a Product record enters the Enrichment Engine, THE Enrichment Engine SHALL extract product attributes including name, brand, model, dimensions, weight, colour, material, and any marketplace-specific attributes present in the source data.
2. THE Enrichment Engine SHALL generate a marketplace-optimised product title for each target Channel, respecting the character limits and keyword conventions of that Channel.
3. THE Enrichment Engine SHALL generate a product description of at least 100 words and no more than 2,000 characters for each target Channel, using the Channel's preferred formatting (bullet points for Amazon, prose for Shopify, etc.).
4. THE Enrichment Engine SHALL generate a set of five to ten search keywords relevant to the product for each target Channel.
5. WHERE a product description source is in a language other than the target Channel's primary language, THE Enrichment Engine SHALL translate the description using Bedrock before generating the Channel listing content.
6. THE Enrichment Engine SHALL produce a confidence score between 0 and 1 for each extracted or generated attribute, reflecting the model's certainty.
7. WHEN an attribute confidence score is below 0.70, THE Enrichment Engine SHALL flag the attribute for Tenant review before the Product advances to the Compliance Engine.
8. THE Enrichment Engine SHALL use AWS Bedrock exclusively for all generative AI and large language model tasks.
9. THE Enrichment Engine SHALL use AWS Rekognition for all image classification, label detection, and content moderation tasks.
10. THE Enrichment Engine SHALL preserve all original Tenant-supplied attribute values and store AI-generated values as a separate enrichment layer, never overwriting Tenant-supplied data without explicit Tenant approval.
11. WHEN a Tenant approves an AI-generated attribute, THE Platform SHALL record the approval actor, timestamp, and previous value in the Audit Log.
12. THE Enrichment Engine SHALL complete enrichment of a single Product record within 60 seconds under normal load.
13. FOR ALL enrichment outputs, parsing the enrichment JSON and serialising it back to JSON SHALL produce an equivalent object (round-trip property).

---

### Requirement 5: Image Processing Pipeline

**User Story:** As a seller, I want my product images automatically processed to meet marketplace specifications — white backgrounds, correct dimensions, and proper formatting — so that I do not need image editing skills or external tools.

#### Acceptance Criteria

1. THE Image Pipeline SHALL accept JPEG, PNG, WEBP, and HEIC source images and produce output images in JPEG and PNG formats.
2. WHEN a source image is submitted, THE Image Pipeline SHALL generate a Hero Image with a pure white background (RGB 255, 255, 255) by removing the original background using Rekognition.
3. THE Image Pipeline SHALL resize and crop output images to meet the exact pixel dimensions required by each target Channel without distorting the product aspect ratio.
4. THE Image Pipeline SHALL enforce the following minimum resolutions: Takealot 1000×1000px, Amazon 1600×1600px, Makro 800×800px, Shopify 2048×2048px, WooCommerce 800×800px.
5. WHEN a source image does not meet the minimum resolution for a Channel, THE Image Pipeline SHALL upscale the image using a bicubic interpolation algorithm and flag the output as upscaled in the Product record.
6. THE Image Pipeline SHALL generate a watermark-free, marketplace-compliant image set for each target Channel from a single source upload.
7. WHERE a Tenant provides multiple source images, THE Image Pipeline SHALL designate the first image as the Hero Image and process remaining images as secondary gallery images.
8. THE Image Pipeline SHALL apply content moderation using Rekognition and reject any image containing nudity, violence, or other content that violates marketplace policies.
9. WHEN an image is rejected by content moderation, THE Image Pipeline SHALL notify the Tenant with the rejection reason and retain the rejected image in quarantine storage for 30 days.
10. THE Image Pipeline SHALL store all processed images in S3 with Tenant-scoped key prefixes and serve them via CloudFront with signed URLs.
11. THE Image Pipeline SHALL complete processing of a single image to all Channel specifications within 30 seconds under normal load.
12. THE Image Pipeline SHALL preserve the original source image in S3 and never delete or overwrite it.

---

### Requirement 6: Category Mapping Engine

**User Story:** As a seller, I want the platform to automatically recommend and validate the correct product category for each marketplace, so that my listings appear in the right place and pass marketplace validation.

#### Acceptance Criteria

1. THE Category Mapping Engine SHALL maintain a local copy of the published Taxonomy for each supported Channel, refreshed on a schedule no less frequent than weekly.
2. WHEN a Product enters the Category Mapping Engine, THE Category Mapping Engine SHALL use Bedrock to recommend the three most likely Taxonomy nodes for each target Channel, ranked by confidence score.
3. THE Category Mapping Engine SHALL present the top category recommendation to the Tenant for review when the highest confidence score is below 0.85.
4. WHEN a Tenant selects or confirms a category for a Channel, THE Category Mapping Engine SHALL validate the selection against the current Channel Taxonomy and reject selections that are not leaf nodes in the Taxonomy tree.
5. THE Category Mapping Engine SHALL map a single Product to all six target Channels in parallel, completing all recommendations within 30 seconds.
6. WHEN a Channel Taxonomy is updated, THE Category Mapping Engine SHALL re-validate all existing Products mapped to affected Taxonomy nodes and flag Products whose mapped category no longer exists.
7. THE Category Mapping Engine SHALL store category mappings per Product per Channel, allowing different categories for the same Product across different Channels.
8. IF a Product has no confirmed category for a Channel, THEN THE Marketplace Output Engine SHALL block export for that Channel until a category is confirmed.
9. FOR ALL category mapping operations, the Category Mapping Engine SHALL apply deterministic validation rules from the Channel Taxonomy after AI recommendation; AI SHALL NOT override Taxonomy constraints.
10. THE Category Mapping Engine SHALL expose a category search API allowing Tenants to search Taxonomy nodes by keyword with results returned within 500 milliseconds.

---

### Requirement 7: Marketplace Output Engine

**User Story:** As a seller, I want to export my validated product listings to each marketplace in the exact format those marketplaces require, so that I can publish without manual reformatting or rework.

#### Acceptance Criteria

1. THE Marketplace Output Engine SHALL generate a channel-specific Listing payload for each of the six supported Channels from a single enriched and validated Product record.
2. THE Marketplace Output Engine SHALL produce a Takealot-compatible CSV export conforming to the current Takealot Seller Portal bulk upload template.
3. THE Marketplace Output Engine SHALL produce an Amazon-compatible CSV export conforming to the current Amazon Seller Central flat-file template for the relevant product category.
4. THE Marketplace Output Engine SHALL produce a Makro-compatible CSV export conforming to the current Makro Marketplace bulk upload template.
5. THE Marketplace Output Engine SHALL produce a Shopify-compatible CSV export conforming to the Shopify product import template, including all variant columns.
6. THE Marketplace Output Engine SHALL produce a WooCommerce-compatible CSV export conforming to the WooCommerce product import format.
7. THE Marketplace Output Engine SHALL produce a channel-agnostic JSON export suitable for import into custom eCommerce websites via API.
8. WHEN a CSV export is generated, THE Marketplace Output Engine SHALL validate the generated file against the Channel schema before delivering it to the Tenant, rejecting any export that fails validation.
9. IF a required field for a Channel is missing from the Product record, THEN THE Marketplace Output Engine SHALL block the export for that Channel, list all missing fields, and present them to the Tenant for resolution.
10. THE Marketplace Output Engine SHALL support direct API publishing to Shopify and WooCommerce stores where a Tenant has connected a store via OAuth.
11. WHEN a direct API publish is attempted, THE Marketplace Output Engine SHALL report the publish result (success, partial failure, or full failure) back to the Tenant within 30 seconds.
12. THE Marketplace Output Engine SHALL store all generated exports in S3 with Tenant-scoped key prefixes and retain them for 90 days.
13. FOR ALL CSV exports, parsing and re-serialising the exported CSV SHALL produce a file with identical field values (round-trip property).
14. THE Marketplace Output Engine SHALL generate a variant matrix for products with multiple Variants, mapping each Variant to the correct Channel-specific variation attribute schema.

---

### Requirement 8: Inventory Management

**User Story:** As a seller, I want to track my stock levels across all channels in one place and have the platform automatically synchronise availability so that I never oversell or publish out-of-stock products.

#### Acceptance Criteria

1. THE Inventory Manager SHALL maintain a stock level record for each SKU per Tenant, storing on-hand quantity, reserved quantity, and available quantity.
2. THE Inventory Manager SHALL accept stock updates via the following input methods: manual entry through the Seller Dashboard, CSV file upload, REST API, and WhatsApp image submission routed through the Ingestion Pipeline.
3. WHEN a stock update is received, THE Inventory Manager SHALL apply the update to the relevant SKU record within 10 seconds and propagate the updated availability to all connected Channels within 60 seconds.
4. THE Inventory Manager SHALL support supplier Feed ingestion via scheduled HTTP polling of supplier-provided URLs at intervals configured by the Tenant, with a minimum polling interval of 15 minutes.
5. WHEN a supplier Feed is ingested, THE Inventory Manager SHALL reconcile the Feed quantities against current on-hand records and create a reconciliation report available to the Tenant.
6. IF a stock update would result in available quantity below zero, THEN THE Inventory Manager SHALL reject the update, set available quantity to zero, and notify the Tenant.
7. THE Inventory Manager SHALL automatically set a SKU's Channel availability to out-of-stock across all Channels when the available quantity reaches zero.
8. WHEN available quantity is restored above zero for a SKU that was out-of-stock, THE Inventory Manager SHALL automatically restore Channel availability for all Channels where the SKU has an active Listing.
9. THE Inventory Manager SHALL maintain a complete inventory transaction ledger for each SKU, recording every quantity change with actor, timestamp, source, and quantity delta.
10. THE Inventory Manager SHALL support multi-warehouse inventory tracking, allowing stock to be allocated to named warehouse locations per Tenant.
11. WHEN a WhatsApp image containing stock information is processed, THE Ingestion Pipeline SHALL extract SKU and quantity data using Textract and Bedrock and route the result to THE Inventory Manager for reconciliation.
12. THE Inventory Manager SHALL support inventory reservations, decrementing available quantity when an order is received and releasing the reservation if the order is cancelled.

---

### Requirement 9: Compliance Validation Engine

**User Story:** As a seller, I want the platform to automatically check my listings against each marketplace's rules before I export or publish, so that my listings are not rejected by the marketplace.

#### Acceptance Criteria

1. THE Compliance Engine SHALL maintain a rule set for each supported Channel, encoding all published listing requirements including title length, description length, image count, image dimensions, prohibited content, required attributes, and pricing constraints.
2. WHEN a Product advances to the validation stage, THE Compliance Engine SHALL evaluate the Product's Listing data against the full rule set for each target Channel independently.
3. THE Compliance Engine SHALL produce a validation report per Channel per Product containing a pass or fail result, a list of all violations with violation codes, and remediation guidance for each violation.
4. IF a Listing fails compliance validation for a Channel, THEN THE Marketplace Output Engine SHALL block export for that Channel until the Listing passes validation.
5. THE Compliance Engine SHALL apply ALL compliance rules using deterministic logic; AI SHALL NOT make compliance pass or fail decisions.
6. WHEN a Channel publishes updated listing requirements, THE Platform operator SHALL be able to update the Compliance Engine rule set for that Channel without a code deployment, using a configuration-driven rule definition format.
7. THE Compliance Engine SHALL validate the following for every Channel: title character count, description character count, minimum image count, maximum image count, Hero Image dimensions, prohibited keywords in titles and descriptions, required attribute completeness, and price range validity.
8. THE Compliance Engine SHALL validate Takealot-specific requirements including TSIN assignment eligibility, barcode presence, and lead time declaration.
9. THE Compliance Engine SHALL validate Amazon-specific requirements including ASIN/UPC presence, Browse Node assignment, and fulfilment method declaration.
10. THE Compliance Engine SHALL complete a full compliance validation pass for a single Product across all six Channels within 10 seconds.
11. THE Compliance Engine SHALL emit an EventBridge event when a Product transitions from failing to passing compliance for a Channel, triggering downstream export readiness notifications.
12. THE Audit Log SHALL record every compliance evaluation result, including the rule set version applied and all violation codes detected.

---

### Requirement 10: Billing and Subscription Management

**User Story:** As a MerchOS operator, I want a robust billing system that meters usage, enforces plan limits, and processes payments reliably, so that the business generates sustainable revenue and Tenants understand what they are paying for.

#### Acceptance Criteria

1. THE Billing Engine SHALL support the following subscription Plans: Starter, Growth, Professional, and Enterprise, each with defined entitlements for product count, channel count, user count, AI enrichment calls per month, and image processing calls per month.
2. WHEN a Tenant's usage of a metered resource reaches 80% of their Plan limit, THE Billing Engine SHALL notify the Tenant Owner by email.
3. WHEN a Tenant's usage of a metered resource reaches 100% of their Plan limit, THE Billing Engine SHALL block further consumption of that resource and present the Tenant with an upgrade prompt.
4. THE Billing Engine SHALL record a usage event for every AI enrichment call, image processing call, and CSV export generated, attributing each event to the Tenant and the Plan period.
5. THE Billing Engine SHALL integrate with Stripe as the payment processor for subscription billing, handling plan creation, subscription creation, invoice generation, and payment collection.
6. WHEN a payment fails, THE Billing Engine SHALL retry the payment on day 3 and day 7 after the initial failure, notifying the Tenant Owner by email on each attempt.
7. IF payment has not been collected by day 7 after initial failure, THEN THE Billing Engine SHALL downgrade the Tenant to read-only access and notify the Tenant Owner.
8. THE Billing Engine SHALL support monthly and annual billing cycles, with annual billing providing a discount defined by the MerchOS operator.
9. WHERE a Tenant is on the Enterprise Plan, THE Billing Engine SHALL support custom contract pricing and invoicing outside of the standard Stripe subscription flow.
10. THE Billing Engine SHALL provide Tenants with a billing dashboard displaying current period usage, next invoice amount, payment history, and current plan entitlements.
11. THE Billing Engine SHALL generate and store PDF invoices for every billing period and make them available for download by the Tenant for a minimum of 3 years.
12. WHEN a Tenant upgrades their Plan, THE Billing Engine SHALL apply prorated charges for the remainder of the current billing period and immediately unlock the new Plan's entitlements.
13. WHEN a Tenant downgrades their Plan, THE Billing Engine SHALL apply the new Plan's entitlements at the start of the next billing period and credit unused prepaid amounts proportionally.

---

### Requirement 11: Seller Dashboard

**User Story:** As a seller, I want a clear, efficient web interface where I can manage my product catalogue, review AI-generated content, approve listings, monitor channel status, and track inventory, so that I have full visibility and control over my operations.

#### Acceptance Criteria

1. THE Seller Dashboard SHALL be a web application hosted on AWS Amplify and served via CloudFront, accessible from any modern browser without installing additional software.
2. THE Seller Dashboard SHALL display the current Lifecycle State of every Product in the Tenant's catalogue with visual indicators distinguishing INGESTED, ENRICHED, VALIDATED, PUBLISHED, and REJECTED states.
3. WHEN a Product requires Tenant review (flagged attributes, low-confidence categories, compliance failures), THE Seller Dashboard SHALL surface a prioritised review queue with the count of items awaiting action.
4. THE Seller Dashboard SHALL allow Tenants to approve or override individual AI-generated attributes inline, with each change immediately saved and recorded in the Audit Log.
5. THE Seller Dashboard SHALL provide a bulk action interface allowing Tenants to approve, reject, or export multiple Products in a single operation.
6. THE Seller Dashboard SHALL display real-time inventory levels per SKU and provide an interface for manual stock adjustments.
7. THE Seller Dashboard SHALL display channel-specific export history including export timestamp, file name, record count, and export status for each Channel.
8. THE Seller Dashboard SHALL provide a product search interface backed by OpenSearch, returning results within 500 milliseconds for catalogues of up to 100,000 products.
9. THE Seller Dashboard SHALL display per-Channel compliance status for each Product, showing pass/fail and linking to the compliance violation detail for any failing Channel.
10. THE Seller Dashboard SHALL provide an account settings section where Tenant Owners can manage users, assign roles, configure Webhooks, and connect Channel integrations (Shopify, WooCommerce OAuth).
11. THE Seller Dashboard SHALL be accessible according to WCAG 2.1 Level AA guidelines.
12. THE Seller Dashboard SHALL load the initial product catalogue view within 3 seconds on a broadband connection for catalogues of up to 10,000 products.

---

### Requirement 12: Admin Dashboard

**User Story:** As a MerchOS operator, I want an administrative interface where I can monitor platform health, manage tenants, configure compliance rules, update marketplace taxonomies, and respond to support issues, so that I can operate the platform effectively.

#### Acceptance Criteria

1. THE Admin Dashboard SHALL be accessible only to users assigned the MerchOS operator role, enforced by a dedicated Cognito user pool separate from Tenant user pools.
2. THE Admin Dashboard SHALL display a real-time platform health overview including Lambda invocation counts, Step Functions execution failure rates, SQS queue depths, DynamoDB read/write capacity utilisation, and active Tenant count.
3. THE Admin Dashboard SHALL provide a Tenant management interface allowing operators to view, search, suspend, reactivate, and delete Tenant accounts.
4. THE Admin Dashboard SHALL allow operators to update compliance rule sets for any Channel without a code deployment, with changes taking effect within 5 minutes of saving.
5. THE Admin Dashboard SHALL allow operators to trigger a Taxonomy refresh for any Channel on demand, in addition to the scheduled weekly refresh.
6. THE Admin Dashboard SHALL provide access to the Audit Log with filtering by Tenant, event type, actor, and date range, returning results within 2 seconds for queries spanning up to 90 days.
7. THE Admin Dashboard SHALL display platform-wide usage metrics including total products ingested, total AI enrichment calls, total image processing calls, and total CSV exports, aggregated by day, week, and month.
8. THE Admin Dashboard SHALL provide a billing oversight view showing each Tenant's current Plan, monthly recurring revenue contribution, payment status, and last invoice date.
9. THE Admin Dashboard SHALL allow operators to apply manual billing credits or adjustments to any Tenant account with a required justification note recorded in the Audit Log.
10. WHEN any Lambda function has an error rate above 1% over a 5-minute window, THE Admin Dashboard SHALL display a visible alert and record the anomaly in the platform event log.

---

### Requirement 13: Event-Driven Architecture and API

**User Story:** As a developer integrating with MerchOS, I want a well-defined API and event system so that I can build integrations, automate workflows, and receive real-time notifications about platform activity.

#### Acceptance Criteria

1. THE Platform SHALL expose all Tenant-facing functionality through a versioned REST API served via API Gateway, with all endpoints documented in OpenAPI 3.0 format.
2. THE Platform SHALL version all API endpoints using a URL path prefix (e.g., /v1/) and maintain backward compatibility within a major version.
3. WHEN a breaking API change is introduced, THE Platform SHALL provide at minimum 90 days of dual-version support before retiring the older version.
4. THE Platform SHALL use EventBridge as the internal event bus, with all platform services communicating through events for all asynchronous operations.
5. THE Platform SHALL support Tenant-configured Webhooks for the following event types: product.ingested, product.enriched, product.validated, product.exported, inventory.updated, compliance.passed, compliance.failed, and listing.published.
6. WHEN a Webhook event is triggered, THE Platform SHALL deliver the event payload to the Tenant's configured endpoint within 30 seconds using HTTPS POST with a signed payload header for authenticity verification.
7. IF a Webhook delivery fails, THEN THE Platform SHALL retry with exponential backoff for up to 24 hours before marking the Webhook as failed and notifying the Tenant.
8. THE Platform SHALL enforce API rate limits per Tenant based on their Plan, returning HTTP 429 with a Retry-After header when limits are exceeded.
9. THE Platform SHALL authenticate all API requests using JWT bearer tokens issued by Cognito, rejecting requests with expired or invalid tokens with HTTP 401.
10. THE Platform SHALL log every API request and response metadata (excluding request bodies containing PII) to CloudWatch with a correlation ID linking request to response.
11. THE Platform SHALL support long-running operation status polling via a job status endpoint, returning the current state and progress percentage for any asynchronous operation.

---

### Requirement 14: Data Model and Storage

**User Story:** As a platform architect, I want a well-defined, consistent data model so that all subsystems share a single source of truth for product, inventory, tenant, and listing data.

#### Acceptance Criteria

1. THE Platform SHALL define a canonical Product schema that includes at minimum: ProductID, TenantID, SKU, title, description, brand, attributes (key-value map), images (ordered list of S3 references), variants (list of Variant records), lifecycle state, enrichment layer (AI-generated attributes with confidence scores), and creation and modification timestamps.
2. THE Platform SHALL define a canonical Listing schema that extends the Product schema with: ChannelID, channel-specific field mappings, compliance status, export history, and channel-specific pricing.
3. THE Platform SHALL store all Product and Listing records in DynamoDB with TenantID as the partition key and ProductID as the sort key.
4. THE Platform SHALL store all binary assets (source images, processed images, PDFs, exports) in S3 with Tenant-scoped key prefixes following the pattern: `{tenantId}/{assetType}/{assetId}`.
5. THE Platform SHALL index Product records in OpenSearch to support full-text search across title, description, brand, SKU, and attributes.
6. WHEN a Product record is updated, THE Platform SHALL propagate the update to the OpenSearch index within 30 seconds.
7. THE Platform SHALL use DynamoDB Streams to trigger downstream processing on all Product record state changes.
8. THE Platform SHALL encrypt all data at rest using AWS KMS with Tenant-specific Customer Managed Keys for Enterprise Plan Tenants.
9. THE Platform SHALL encrypt all data in transit using TLS 1.2 or higher.
10. THE Platform SHALL implement DynamoDB point-in-time recovery for all tables and S3 versioning for all asset buckets.
11. THE Platform SHALL retain Product records for a minimum of 7 years after Tenant account deletion to satisfy potential legal and audit requirements, stored in S3 Glacier after 90 days.

---

### Requirement 15: Security and Compliance

**User Story:** As a MerchOS operator, I want the platform to be secure by design so that Tenant data is protected, the platform meets relevant data protection standards, and security incidents are detected and responded to promptly.

#### Acceptance Criteria

1. THE Platform SHALL implement the AWS Well-Architected Framework Security Pillar as the baseline security standard for all infrastructure and application design decisions.
2. THE Platform SHALL enforce the principle of least privilege for all IAM roles, granting each Lambda function and service only the permissions required for its specific tasks.
3. THE Platform SHALL scan all uploaded files for malware using an antivirus Lambda layer before any processing begins, quarantining and rejecting infected files.
4. THE Platform SHALL enable AWS GuardDuty, AWS Security Hub, and AWS Config across all accounts and regions used by the platform.
5. THE Platform SHALL enable AWS CloudTrail in all accounts with log integrity validation enabled, storing logs in a dedicated, access-restricted S3 bucket.
6. IF GuardDuty or Security Hub generates a HIGH or CRITICAL severity finding, THEN THE Platform SHALL notify the MerchOS security contact within 15 minutes via SNS alert.
7. THE Platform SHALL rotate all secrets and API keys stored in AWS Secrets Manager on a schedule no less frequent than 90 days.
8. THE Platform SHALL not store Tenant payment card data; all payment processing SHALL be delegated entirely to Stripe.
9. THE Platform SHALL conduct dependency vulnerability scanning on all Lambda deployment packages as part of the CI/CD pipeline, blocking deployments with CRITICAL severity CVEs.
10. THE Platform SHALL log all S3 data access events (GET, PUT, DELETE) to CloudTrail and retain access logs for 1 year.
11. WHEN a Tenant requests a data export of all their personal data, THE Platform SHALL generate and deliver the export within 30 days in compliance with applicable data protection regulations.

---

### Requirement 16: Observability and Reliability

**User Story:** As a MerchOS operator, I want comprehensive monitoring, alerting, and reliability mechanisms so that the platform meets its availability targets and issues are detected and resolved quickly.

#### Acceptance Criteria

1. THE Platform SHALL target 99.9% monthly availability for all Tenant-facing API endpoints, measured as the percentage of minutes in a calendar month during which the API returns non-5xx responses.
2. THE Platform SHALL implement AWS CloudWatch dashboards for each major subsystem displaying key metrics including invocation count, error rate, p50/p95/p99 latency, and queue depth.
3. THE Platform SHALL configure CloudWatch alarms for all metrics with thresholds defined in the system's operational runbook, with alarms routing to an SNS topic connected to the on-call notification system.
4. THE Platform SHALL implement AWS X-Ray distributed tracing across all Lambda functions, API Gateway endpoints, and Step Functions executions.
5. THE Platform SHALL implement exponential backoff with jitter on all Lambda functions that call downstream services or external APIs.
6. THE Platform SHALL use SQS dead-letter queues for all asynchronous processing queues, routing failed messages after three processing attempts to a dead-letter queue for operator review.
7. THE Platform SHALL implement AWS Lambda Powertools for structured logging, metrics, and tracing in all Lambda functions.
8. WHEN a Step Functions execution fails, THE Platform SHALL send an EventBridge event including the execution ARN, failed state name, and error cause.
9. THE Platform SHALL implement circuit breaker logic for all outbound calls to external marketplace APIs, opening the circuit after five consecutive failures and attempting recovery every 60 seconds.
10. THE Platform SHALL use multi-AZ deployment for all DynamoDB tables, S3 buckets, and API Gateway deployments to eliminate single points of failure within a region.

---

### Requirement 17: Infrastructure as Code and CI/CD

**User Story:** As a platform engineer, I want all infrastructure defined as code and deployed through a consistent CI/CD pipeline, so that environments are reproducible, deployments are safe, and drift is prevented.

#### Acceptance Criteria

1. THE Platform SHALL define all AWS infrastructure using AWS CDK (TypeScript) as the sole infrastructure-as-code tool.
2. THE Platform SHALL maintain separate CDK stacks for each major subsystem (Ingestion, Enrichment, Image Pipeline, Category Mapping, Output Engine, Inventory, Compliance, Billing, Dashboards, Core Infrastructure) to enable independent deployment.
3. THE Platform SHALL maintain at minimum three environments: development, staging, and production, each deployed from the same CDK definitions with environment-specific configuration injected via CDK context or AWS Systems Manager Parameter Store.
4. THE Platform SHALL use a CI/CD pipeline (implemented in AWS CodePipeline or GitHub Actions) that runs automated tests, CDK synthesis, security scanning, and staged deployment for every merge to the main branch.
5. WHEN a deployment to production is triggered, THE CI/CD pipeline SHALL require a manual approval gate from an authorised MerchOS operator before applying infrastructure changes.
6. THE Platform SHALL implement CDK drift detection on a daily schedule and alert the MerchOS operator if drift is detected between the deployed state and the CDK-defined state.
7. THE Platform SHALL tag all AWS resources with at minimum the following tags: Environment, Subsystem, TenantScope, CostCenter, and ManagedBy (value: cdk).
8. THE Platform SHALL enforce resource tagging compliance using AWS Config rules, flagging untagged resources within 1 hour of creation.

---

### Requirement 18: Notification and Communication

**User Story:** As a seller, I want to receive timely notifications about important events in my account — completed ingestion jobs, compliance failures, inventory alerts, and billing notices — so that I can act quickly without constantly checking the dashboard.

#### Acceptance Criteria

1. THE Platform SHALL deliver in-app notifications to the Seller Dashboard for all Product lifecycle state changes, compliance validation results, and inventory threshold breaches.
2. THE Platform SHALL deliver email notifications to the Tenant Owner for all billing events, payment failures, plan limit warnings, and account security events.
3. WHEN an ingestion job completes or fails, THE Platform SHALL deliver an in-app and email notification to the user who submitted the job within 5 minutes of job completion.
4. THE Platform SHALL support Tenant-configurable notification preferences, allowing each Tenant to enable or disable specific notification types and choose delivery channels (in-app, email, Webhook) per event type.
5. THE Platform SHALL use Amazon SES for all outbound email delivery and maintain email delivery logs for 90 days.
6. IF an email delivery fails, THEN THE Platform SHALL retry delivery up to three times over 24 hours before recording a permanent delivery failure in the notification log.
7. THE Platform SHALL not send more than one email per event type per Tenant per hour to prevent notification flooding.
8. THE Platform SHALL provide a notification history view in the Seller Dashboard showing all notifications sent to the Tenant in the last 90 days, with read/unread status.

---

### Requirement 19: Product Lifecycle Management

**User Story:** As a seller, I want a clear product lifecycle that tracks where each product is in the process — from raw ingestion through enrichment, validation, and publishing — so that I always know what needs my attention and what is ready to go.

#### Acceptance Criteria

1. THE Platform SHALL define and enforce the following Product Lifecycle States in order: DRAFT → INGESTED → ENRICHED → REVIEW → VALIDATED → EXPORT_READY → PUBLISHED → ARCHIVED.
2. WHEN a Product transitions between Lifecycle States, THE Platform SHALL record the transition in the Audit Log with the actor (system or user), timestamp, previous state, and new state.
3. THE Platform SHALL allow a Product to move backward in the lifecycle to REVIEW state when a Tenant edits a previously validated attribute, requiring re-validation before re-export.
4. WHEN a Product is in REVIEW state, THE Seller Dashboard SHALL display all attributes flagged for review and the reason each attribute was flagged.
5. THE Platform SHALL support bulk lifecycle transitions allowing a Tenant to advance multiple Products from ENRICHED to REVIEW or from VALIDATED to EXPORT_READY in a single operation.
6. WHEN a Product is ARCHIVED, THE Marketplace Output Engine SHALL remove the Product from all Channel export queues and THE Inventory Manager SHALL set all associated SKU Channel availability to inactive.
7. THE Platform SHALL prevent deletion of Products that have active Listings on any Channel; the Tenant SHALL archive the Product first.
8. THE Platform SHALL expose the full lifecycle history for each Product via the API, returning all state transitions in chronological order.

---

### Requirement 20: Internationalisation and Multi-Language Support

**User Story:** As a seller targeting multiple markets, I want to manage product content in multiple languages so that my listings are localised for each marketplace's primary language.

#### Acceptance Criteria

1. THE Platform SHALL support product content (titles, descriptions, keywords) in multiple languages per Product, storing each language version independently.
2. THE Enrichment Engine SHALL detect the language of source content using Bedrock and record the detected language code on the Product record.
3. WHEN a Tenant requests a translation into a specific language, THE Enrichment Engine SHALL use Bedrock to generate the translation and store it as a separate language version of the Product content.
4. THE Platform SHALL support at minimum the following languages: English, Afrikaans, French, German, Spanish, Portuguese, Mandarin Chinese, and Arabic.
5. WHEN a Channel Listing is generated for a Channel whose primary language differs from the default Product language, THE Marketplace Output Engine SHALL use the Channel's primary language version of the content if available, and fall back to Bedrock translation if no pre-translated version exists.
6. THE Seller Dashboard SHALL allow Tenants to view and edit product content in any language version side-by-side.
7. THE Platform SHALL preserve all language versions of product content independently; editing one language version SHALL NOT affect other language versions.

---

## Non-Functional Requirements Summary

The following non-functional requirements apply platform-wide across all subsystems.

### Performance

- API p95 response time: ≤ 500ms for all synchronous read endpoints under normal load.
- API p95 response time: ≤ 2,000ms for all synchronous write endpoints under normal load.
- Ingestion pipeline end-to-end: ≤ 5 minutes per product under normal load.
- Image processing per image per Channel: ≤ 30 seconds under normal load.
- Enrichment per Product: ≤ 60 seconds under normal load.
- CSV export generation: ≤ 60 seconds for exports of up to 1,000 Products.
- Search result latency: ≤ 500ms for catalogues up to 100,000 Products.

### Scalability

- The Platform SHALL scale to support 10,000 concurrent Tenants.
- The Platform SHALL scale to support catalogues of 1,000,000 Products per Tenant.
- The Platform SHALL scale Lambda concurrency automatically to handle peak ingestion loads of 10,000 concurrent jobs.

### Availability

- Target: 99.9% monthly uptime for all Tenant-facing APIs.
- Planned maintenance windows SHALL not exceed 30 minutes per month and SHALL be communicated to Tenants with at least 48 hours' notice.

### Security

- All data encrypted in transit (TLS 1.2+) and at rest (AES-256 via KMS).
- Zero cross-tenant data access permitted under any circumstances.
- All secrets managed via AWS Secrets Manager; no secrets in code or environment variables.

### Compliance

- THE Platform SHALL be designed to support GDPR and POPIA (Protection of Personal Information Act, South Africa) data subject rights including right of access, right to erasure, and data portability.
- THE Platform SHALL maintain audit logs for a minimum of 3 years.
