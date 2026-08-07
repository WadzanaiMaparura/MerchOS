# Implementation Plan: Product Intelligence Engine

## Overview

This plan implements the Product Intelligence Engine as a new `services/product-intelligence/` workspace with Lambda handlers, Amazon Bedrock integration, DynamoDB storage, and seller dashboard frontend pages for AI-powered content generation, optimization, and validation. Implementation uses TypeScript throughout, following existing MerchOS patterns (middy middleware, AWS Powertools, DynamoDB tenant isolation, CDK infrastructure).

## Tasks

- [x] 1. Set up service workspace and shared types
  - [x] 1.1 Create the `services/product-intelligence/` workspace structure
    - Create directory structure: `handlers/`, `services/`, `schemas/`, `utils/`, `__tests__/properties/`, `__tests__/unit/`, `__tests__/integration/`
    - Create `package.json` with dependencies: `@middy/core`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-eventbridge`, `zod`, `fast-check` (dev), `vitest` (dev), `aws-sdk-client-mock` (dev)
    - Create `tsconfig.json` extending `../../tsconfig.base.json`
    - Create `vitest.config.ts` following the pattern from `services/supplier-intelligence/vitest.config.ts`
    - _Requirements: 16.1, 17.5_

  - [x] 1.2 Define TypeScript interfaces and shared types
    - Create `services/product-intelligence/types/generation.types.ts` with `GenerationType`, `GenerationRequest`, `GenerationResult`, `GeneratedContent`, `ProductData`, `MarketplaceId`, `BatchGenerationRequest`, `BatchGenerationResult`
    - Create `services/product-intelligence/types/prompt.types.ts` with `PromptTemplate`, `ABTestConfig`, `CreatePromptTemplateInput`
    - Create `services/product-intelligence/types/cache.types.ts` with `CacheKeyInput`, `CacheEntryItem`
    - Create `services/product-intelligence/types/usage.types.ts` with `TokenUsageRecord`, `TokenUsageSummary`, `ModelConfig`
    - Create `services/product-intelligence/types/dynamo.types.ts` with `GenerationResultItem`, `PromptTemplateItem`, `CacheEntryItem`, `TokenUsageItem` DynamoDB item schemas
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1, 15.1_

  - [x] 1.3 Create Zod request validation schemas
    - Create `services/product-intelligence/schemas/generate.schema.ts` with `generateRequestSchema` validating type enum, productData, marketplace, options
    - Create `services/product-intelligence/schemas/batch.schema.ts` with `batchGenerationRequestSchema` validating items array and concurrencyLimit
    - Create `services/product-intelligence/schemas/history.schema.ts` with `historyQuerySchema` validating limit, lastEvaluatedKey, type filter
    - Create `services/product-intelligence/schemas/usage.schema.ts` with `usageQuerySchema` validating period enum
    - _Requirements: 16.3, 16.6_

- [x] 2. Implement Bedrock Client with retry logic
  - [x] 2.1 Implement the Bedrock Client service
    - Create `services/product-intelligence/services/bedrock-client.ts`
    - Implement `invoke(params: BedrockInvocationParams): Promise<BedrockInvocationResult>` using `@aws-sdk/client-bedrock-runtime` InvokeModel command
    - Implement exponential backoff with full jitter: initial 1s, multiplier 2, max 10s, max 3 retries
    - Retry on `ThrottlingException`, `ServiceUnavailableException`, `InternalServerError`
    - Track input/output tokens and latency in the response
    - Emit `product-intelligence.bedrock-failure` EventBridge event after all retries exhausted
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 2.2 Implement model selection configuration
    - Create `services/product-intelligence/services/model-config.ts`
    - Define default model mapping per generation type (Haiku for title/bullets/category/brand/attributes/keywords, Sonnet for description/seo/compliance)
    - Expose `getModelConfig(generationType: GenerationType): ModelConfig`
    - _Requirements: 15.4, 15.6_

  - [ ]* 2.3 Write property tests for retry logic
    - **Property 7: Retry count never exceeds maximum** — verify total attempts never exceed 4 (1 initial + 3 retries) for any failure sequence
    - **Validates: Requirements 14.2, 19.3**

  - [ ]* 2.4 Write property tests for retry backoff
    - **Property 8: Retry backoff monotonic increase** — verify calculated backoff = min(1 * 2^n, 10) is monotonically non-decreasing
    - **Property 9: Retry jitter bounded** — verify actual wait time after jitter is in range [0, calculated_backoff]
    - **Validates: Requirements 14.1, 14.3, 14.4, 19.3**

- [x] 3. Implement Confidence Scorer and Response Cache
  - [x] 3.1 Implement the Confidence Scorer
    - Create `services/product-intelligence/services/confidence-scorer.ts`
    - Implement `calculate(params: ConfidenceInput): number` returning value clamped to [0.0, 1.0]
    - Formula combines model probability, input completeness, and historical accuracy with weighted average
    - Higher input completeness produces equal or higher confidence (monotonic)
    - _Requirements: 11.1, 11.2_

  - [x] 3.2 Implement the Response Cache
    - Create `services/product-intelligence/services/response-cache.ts`
    - Implement `computeKey(input: CacheKeyInput): string` using SHA-256 hash of normalized input, generation type, marketplace, and prompt version
    - Implement `get(cacheKey): Promise<GenerationResult | null>` querying DynamoDB with PK `CACHE#{cacheKey}`, SK `ENTRY`
    - Implement `set(cacheKey, result, ttlSeconds)` storing with DynamoDB TTL attribute, default 24 hours
    - Implement `invalidateByPromptVersion(generationType, oldVersion)` to remove stale cache entries
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 3.3 Write property tests for confidence scorer
    - **Property 1: Confidence score invariant** — verify score is always in [0.0, 1.0] for any valid inputs
    - **Property 2: Confidence score monotonicity** — verify higher input completeness produces equal or higher confidence (model probability and historical accuracy held constant)
    - **Property 3: Confidence review threshold** — verify score < 0.7 sets reviewRecommended=true, score >= 0.7 sets reviewRecommended=false
    - **Validates: Requirements 11.1, 11.2, 11.3, 19.4**

  - [ ]* 3.4 Write property tests for response cache
    - **Property 6: Cache key determinism and collision resistance** — verify same inputs produce same SHA-256 hash, different inputs produce different hashes
    - **Validates: Requirements 13.6, 19.2**

- [x] 4. Implement Prompt Manager
  - [x] 4.1 Implement the Prompt Manager service
    - Create `services/product-intelligence/services/prompt-manager.ts`
    - Implement `getActiveTemplate(generationType, abConfig?)` querying DynamoDB for active templates, selecting variant based on traffic percentages for A/B testing
    - Implement `createVersion(template)` assigning monotonically increasing version numbers
    - Implement `deactivateVersion(templateId, version)` marking template inactive
    - Implement `interpolate(template, variables)` replacing `{{variable_name}}` placeholders with values
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ]* 4.2 Write property tests for prompt manager
    - **Property 5: Prompt template interpolation round-trip** — verify interpolation replaces all `{{variable}}` placeholders with no remaining double-brace tokens
    - **Property 17: Prompt version monotonically increasing** — verify each new version is strictly greater than all previous versions for same generation type
    - **Property 19: A/B traffic distribution** — verify over 1000+ requests the observed distribution is within 10 percentage points of configured percentages
    - **Validates: Requirements 12.2, 12.3, 12.6, 19.1**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Token Tracker and Budget Enforcement
  - [x] 6.1 Implement the Token Tracker service
    - Create `services/product-intelligence/services/token-tracker.ts`
    - Implement `record(usage: TokenUsageRecord)` updating daily and monthly aggregates in DynamoDB using atomic ADD operations
    - Implement `getTenantUsage(tenantId, period)` returning `TokenUsageSummary` with breakdown by generation type
    - Implement `checkBudget(tenantId)` comparing accumulated usage against configured budget limit
    - Emit `product-intelligence.budget-exceeded` EventBridge event when budget is exceeded
    - _Requirements: 15.1, 15.2, 15.3_

  - [ ]* 6.2 Write property tests for token tracker
    - **Property 10: Token usage aggregation invariant** — verify aggregated total equals sum of all individual recordings within a period
    - **Property 11: Budget enforcement threshold** — verify requests are rejected with BUDGET_EXCEEDED when usage meets or exceeds budget limit
    - **Validates: Requirements 15.1, 15.2, 15.3**

- [x] 7. Implement Content Generation services
  - [x] 7.1 Implement the Content Generator service
    - Create `services/product-intelligence/services/content-generator.ts`
    - Implement `generateTitle(request)`, `generateDescription(request)`, `generateBullets(request)`
    - Orchestrate: resolve prompt template → check cache → invoke Bedrock → score confidence → apply marketplace rules → cache result → return
    - Handle description tone (professional, casual, luxury) and word count range with 10% tolerance
    - Handle bullet count (default 5, configurable 1-20)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 7.2 Implement the SEO Optimizer service
    - Create `services/product-intelligence/services/seo-optimizer.ts`
    - Implement `analyze(request: SEOAnalysisInput): Promise<SEOAnalysisResult>`
    - Calculate keyword density as percentage of total word count per keyword
    - Flag keyword stuffing when density exceeds 3% for a single keyword
    - Generate meta description of 155 characters or fewer
    - Apply marketplace-specific SEO guidelines
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 7.3 Implement the Category Predictor service
    - Create `services/product-intelligence/services/category-predictor.ts`
    - Implement `predict(request): Promise<CategoryPredictionResult>`
    - Return at least 3 candidate categories sorted by confidence descending
    - Include full category path breadcrumbs
    - Flag for manual classification when all scores < 0.3
    - Map to marketplace taxonomy when marketplace specified
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.4 Implement the Brand Detector service
    - Create `services/product-intelligence/services/brand-detector.ts`
    - Implement `detect(request): Promise<BrandDetectionResult>`
    - Differentiate primary brand vs sub-brands
    - Validate against known brand registry when available
    - Flag unidentified when no brand scores > 0.5
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.5 Implement the Attribute Extractor service
    - Create `services/product-intelligence/services/attribute-extractor.ts`
    - Implement `extract(request): Promise<AttributeExtractionResult>`
    - Extract standard attributes (size, color, material, weight, dimensions)
    - Map to marketplace attribute schema when marketplace specified
    - Return raw value with normalization_failed flag when normalization fails
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 7.6 Implement the Keyword Generator service
    - Create `services/product-intelligence/services/keyword-generator.ts`
    - Implement `generate(request): Promise<KeywordGenerationResult>`
    - Produce 10-50 keywords categorized as primary, secondary, long-tail
    - Identify gap keywords when competitor keywords provided
    - Tailor to marketplace search algorithm when marketplace specified
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 7.7 Implement the Compliance Validator service
    - Create `services/product-intelligence/services/compliance-validator.ts`
    - Implement `validate(request): Promise<ComplianceValidationResult>`
    - Check for restricted terms, prohibited claims, policy-violating language
    - Check for trademark violations against known protected terms
    - Return violations with type, severity, offending text span, and suggested fix
    - Provide corrected content when status is 'fail'
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 7.8 Implement the Marketplace Adapter service
    - Create `services/product-intelligence/services/marketplace-adapter.ts`
    - Implement `apply(content, marketplace, contentType): MarketplaceAdaptedContent`
    - Enforce character limits per marketplace (Amazon, Shopify, eBay) and content type
    - Apply formatting rules (allowed HTML tags, restricted characters, required fields)
    - Structure output for A+ content / enhanced brand content when applicable
    - Return compliance status (compliant, warnings, non_compliant) and applied rules
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 7.9 Write property tests for content generation
    - **Property 16: Bullet count matches specification** — verify specified count N produces exactly N bullets, default produces 5
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 7.10 Write property tests for SEO optimizer
    - **Property 13: Keyword stuffing detection threshold** — verify keywords > 3% density are flagged, keywords <= 3% are not
    - **Property 14: Meta description length constraint** — verify meta description is always 155 characters or fewer
    - **Validates: Requirements 4.4, 4.6**

  - [ ]* 7.11 Write property tests for category predictor
    - **Property 15: Category predictions sorted by confidence descending** — verify predictions array is sorted descending and contains at least 3 entries
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 7.12 Write property tests for marketplace adapter
    - **Property 4: Marketplace character limit enforcement** — verify output never exceeds configured max character limit for marketplace and content type
    - **Validates: Requirements 1.2, 2.5, 8.2**

  - [ ]* 7.13 Write property tests for compliance validator
    - **Property 18: Compliance violation structure completeness** — verify each violation includes all required fields (type, severity, offendingText, span with start < end, suggestedFix)
    - **Validates: Requirements 10.3**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement Lambda Handlers
  - [x] 9.1 Implement `POST /intelligence/generate` handler
    - Create `services/product-intelligence/handlers/generate.ts`
    - Use middy pipeline: `tenantContextMiddleware`, `rbacMiddleware({ resource: 'intelligence', action: 'write' })`, `rateLimitMiddleware`, `inputValidationMiddleware`
    - Route request to appropriate service based on generation type
    - Check budget before invoking Bedrock
    - Record token usage after generation
    - Store result in DynamoDB with tenant-scoped PK
    - Emit low-confidence EventBridge event when score < 0.5
    - Return Generation_Result with all metadata
    - _Requirements: 1.1, 1.5, 11.1, 11.3, 11.4, 13.5, 15.1, 16.1, 16.2, 16.3, 16.5_

  - [x] 9.2 Implement `POST /intelligence/batch` handler
    - Create `services/product-intelligence/handlers/batch.ts`
    - Use middy pipeline with same middleware stack
    - Process items concurrently up to configured concurrency limit (default 5)
    - Aggregate results with summary (total, succeeded, failed, totalTokens)
    - Check budget before each item, stop on budget exceeded
    - _Requirements: 15.5, 16.4_

  - [x] 9.3 Implement `GET /intelligence/results/{resultId}` handler
    - Create `services/product-intelligence/handlers/get-result.ts`
    - Use middy pipeline with read-only middleware
    - Query DynamoDB with tenant-scoped PK and RESULT#{resultId} SK
    - Return 404 if not found
    - _Requirements: 16.4_

  - [x] 9.4 Implement `GET /intelligence/history` handler
    - Create `services/product-intelligence/handlers/history.ts`
    - Use middy pipeline with read-only middleware
    - Query GSI1 for chronological results, support type filter
    - Support pagination via lastEvaluatedKey
    - _Requirements: 16.4_

  - [x] 9.5 Implement `GET /intelligence/usage` handler
    - Create `services/product-intelligence/handlers/usage.ts`
    - Use middy pipeline with read-only middleware
    - Query token usage for daily or monthly period
    - Return TokenUsageSummary with breakdown by generation type
    - _Requirements: 16.4_

  - [ ]* 9.6 Write property tests for input validation
    - **Property 12: Input validation rejects malformed requests** — verify requests not conforming to Zod schema return HTTP 400 with structured error containing field path and validation message
    - **Validates: Requirements 16.3, 16.6**

  - [ ]* 9.7 Write unit tests for handlers
    - Test generate handler middleware pipeline wiring
    - Test tenant isolation (cross-tenant access returns 403)
    - Test rate limiting (> 60 req/min returns 429)
    - Test budget exceeded flow (returns 402)
    - Test batch handler concurrency limiting and partial failure
    - Test error responses for all error codes
    - _Requirements: 16.1, 16.2, 16.3, 16.5, 16.6, 19.5_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement CDK Infrastructure Stack
  - [x] 11.1 Create the `ProductIntelligenceStack` CDK stack
    - Create `infrastructure/lib/product-intelligence-stack.ts`
    - Define DynamoDB single table `product-intelligence-{env}` with PK/SK, GSI1, GSI2 as per design access patterns
    - Enable KMS encryption and point-in-time recovery
    - Import Foundation Stack resources via SSM parameters (KMS key, EventBridge bus)
    - _Requirements: 17.1, 17.2_

  - [x] 11.2 Define Lambda functions and API Gateway routes in CDK
    - Define all Lambda functions (generate, batch, get-result, history, usage) with Node.js 20 runtime, X-Ray tracing, AWS Powertools layer
    - Define API Gateway HTTP API with JWT authorizer
    - Configure routes: POST /intelligence/generate, POST /intelligence/batch, GET /intelligence/results/{resultId}, GET /intelligence/history, GET /intelligence/usage
    - _Requirements: 17.4, 17.5_

  - [x] 11.3 Define IAM roles and security policies in CDK
    - Configure least-privilege IAM roles per Lambda: DynamoDB table/index access, Bedrock InvokeModel for specified model ARNs only, EventBridge PutEvents
    - Export resource ARNs via SSM parameters following `/merch-os/{env}/` naming convention
    - _Requirements: 17.3, 17.6_

  - [ ]* 11.4 Write CDK infrastructure tests
    - Snapshot test for the full stack
    - Assert all Lambda functions use Node.js 20 runtime
    - Assert IAM roles grant Bedrock InvokeModel only for specified model ARNs
    - Assert DynamoDB table has KMS encryption and PITR enabled
    - Assert all API routes have JWT authorizer
    - Assert EventBridge integration is configured
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_

- [x] 12. Implement Seller Dashboard Frontend Pages
  - [x] 12.1 Create content generation page
    - Create `apps/seller-dashboard/app/(dashboard)/intelligence/page.tsx`
    - Implement product selection, generation type selection (title, description, bullets, seo, category, brand, attributes, keywords, compliance)
    - Implement marketplace selector and generation options form
    - Submit generation requests via API and display loading state
    - _Requirements: 18.1_

  - [x] 12.2 Create generation results display component
    - Create `apps/seller-dashboard/app/(dashboard)/intelligence/components/GenerationResult.tsx`
    - Display generated content with confidence score, token usage, and marketplace compliance status
    - Show amber badge for review-recommended results (confidence < 0.7)
    - Show side-by-side comparison view for multiple alternatives
    - Allow inline editing and approval of generated content
    - _Requirements: 18.2, 18.3, 18.4, 18.6_

  - [x] 12.3 Create generation history page
    - Create `apps/seller-dashboard/app/(dashboard)/intelligence/history/page.tsx`
    - Display paginated list of past generation requests with status, cost, and approval state
    - Support filtering by generation type and date range
    - Use `@tanstack/react-query` for data fetching with pagination
    - _Requirements: 18.5_

  - [ ]* 12.4 Write unit tests for dashboard components
    - Test generation form renders all generation types and marketplace options
    - Test result display shows confidence badge states correctly
    - Test comparison view renders side-by-side content
    - Test history page pagination and filtering
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

- [x] 13. Implement Documentation
  - [x] 13.1 Create API reference and usage documentation
    - Create `services/product-intelligence/docs/api-reference.md` listing all endpoints, request/response schemas, error codes
    - Create `services/product-intelligence/docs/usage-guide.md` covering authentication, rate limits, batch processing, cost management
    - Create `services/product-intelligence/docs/prompt-authoring.md` explaining template syntax, variable interpolation, A/B testing, version management
    - Add inline JSDoc comments on all exported functions and types
    - _Requirements: 20.1, 20.2, 20.3, 20.4_

- [x] 14. Wire end-to-end integration and final validation
  - [x] 14.1 Wire content generation orchestration flow
    - Ensure generate handler correctly routes to all 9 generation services based on type
    - Wire cache check before Bedrock invocation and cache set after successful generation
    - Wire prompt template resolution with A/B variant selection in the generation flow
    - Wire marketplace adapter post-processing for marketplace-targeted requests
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 12.3, 12.4, 13.1_

  - [x] 14.2 Wire observability: structured logging, X-Ray tracing, and EventBridge events
    - Add AWS Powertools Logger with correlation IDs (tenantId, resultId, generationType) to all handlers and services
    - Configure X-Ray tracing across Lambda handlers
    - Emit EventBridge events: `product-intelligence.low-confidence` (score < 0.5), `product-intelligence.budget-exceeded`, `product-intelligence.bedrock-failure`
    - _Requirements: 11.4, 14.5, 15.3_

  - [ ]* 14.3 Write integration tests for end-to-end generation flow
    - Test full generation flow: request → cache check → Bedrock invocation → confidence scoring → DynamoDB storage → response
    - Test cache hit path: same request returns cached result without Bedrock call
    - Test cache invalidation on prompt version change
    - Test budget enforcement: usage accumulation and rejection
    - Test tenant isolation in all query operations
    - _Requirements: 13.1, 13.4, 15.3, 16.2, 19.5_

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (19 properties total)
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing MerchOS codebase patterns
- All Lambda handlers follow the established middy middleware pipeline with AWS Powertools
- DynamoDB access patterns use the existing `TENANT#{tenantId}` partition key pattern for tenant isolation
- Amazon Bedrock integration uses `@aws-sdk/client-bedrock-runtime` with dedicated Bedrock Client service layer
- Model selection defaults: Haiku for low-complexity tasks, Sonnet for complex reasoning tasks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "3.1", "3.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "3.3", "3.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "6.1"] },
    { "id": 5, "tasks": ["6.2", "7.1", "7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 6, "tasks": ["7.9", "7.10", "7.11", "7.12", "7.13"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 8, "tasks": ["9.6", "9.7"] },
    { "id": 9, "tasks": ["11.1"] },
    { "id": 10, "tasks": ["11.2", "11.3"] },
    { "id": 11, "tasks": ["11.4", "12.1", "12.3"] },
    { "id": 12, "tasks": ["12.2", "12.4", "13.1"] },
    { "id": 13, "tasks": ["14.1", "14.2"] },
    { "id": 14, "tasks": ["14.3"] }
  ]
}
```
