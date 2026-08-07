# Product Intelligence Engine — API Reference

## Base URL

```
https://{api-gateway-id}.execute-api.{region}.amazonaws.com
```

All endpoints are prefixed under `/intelligence`.

---

## Authentication

All requests require a valid JWT in the `Authorization` header:

```
Authorization: Bearer <jwt-token>
```

The JWT must contain tenant claims. The `tenantContextMiddleware` extracts the `tenantId` from the authorizer context and scopes all operations to that tenant.

---

## Endpoints

### POST /intelligence/generate

Submits a single AI content generation request.

**Middleware:** tenantContext → RBAC (`intelligence:write`) → rateLimit (60/min) → inputValidation

#### Request Body

```json
{
  "type": "title" | "description" | "bullets" | "seo" | "category" | "brand" | "attributes" | "keywords" | "compliance",
  "productData": {
    "name": "string (optional, max 500)",
    "description": "string (optional, max 10000)",
    "category": "string (optional, max 500)",
    "brand": "string (optional, max 200)",
    "attributes": { "key": "value" },
    "images": ["https://..."],
    "price": { "amount": 29.99, "currency": "USD" },
    "existingContent": "string (optional, max 50000)"
  },
  "marketplace": "amazon" | "shopify" | "ebay",
  "options": {}
}
```

**Required fields:** `type`, `productData`

**Type-specific options:**

| Type | Options |
|------|---------|
| `description` | `tone`: `"professional"` \| `"casual"` \| `"luxury"`, `wordCountRange`: `{ min, max }` |
| `bullets` | `count`: number (1–20, default 5) |
| `keywords` | `count`: number, `competitorKeywords`: string[] |

#### Response — 200 OK

```json
{
  "resultId": "uuid",
  "type": "title",
  "status": "completed" | "failed",
  "content": { "type": "title", "title": "Generated Title" },
  "confidenceScore": 0.85,
  "reviewRecommended": false,
  "metadata": {
    "promptVersion": 3,
    "promptTemplateId": "uuid",
    "tokenUsage": { "inputTokens": 150, "outputTokens": 42 },
    "cached": false,
    "modelId": "anthropic.claude-3-haiku-20240307-v1:0",
    "latencyMs": 1200,
    "marketplace": "amazon",
    "marketplaceCompliance": "compliant"
  },
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

#### Content Shapes by Type

| Type | Content Shape |
|------|--------------|
| `title` | `{ type: "title", title: string }` |
| `description` | `{ type: "description", description: string, truncated: boolean }` |
| `bullets` | `{ type: "bullets", bullets: string[] }` |
| `seo` | `{ type: "seo", analysis: SEOAnalysisResult }` |
| `category` | `{ type: "category", predictions: CategoryPredictionResult }` |
| `brand` | `{ type: "brand", detection: BrandDetectionResult }` |
| `attributes` | `{ type: "attributes", extraction: AttributeExtractionResult }` |
| `keywords` | `{ type: "keywords", keywords: KeywordGenerationResult }` |
| `compliance` | `{ type: "compliance", validation: ComplianceValidationResult }` |

---

### POST /intelligence/batch

Submits multiple generation requests in a single call.

**Middleware:** tenantContext → RBAC (`intelligence:write`) → rateLimit → inputValidation

#### Request Body

```json
{
  "items": [
    { "type": "title", "productData": { ... } },
    { "type": "description", "productData": { ... }, "marketplace": "amazon" }
  ],
  "concurrencyLimit": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `items` | array | 1–50 generation request objects |
| `concurrencyLimit` | number | Max parallel Bedrock calls (1–20, default 5) |

#### Response — 200 OK

```json
{
  "results": [ /* GenerationResult[] */ ],
  "summary": {
    "total": 10,
    "succeeded": 9,
    "failed": 1,
    "totalTokens": 3200
  }
}
```

Processing stops early if a tenant's budget is exceeded mid-batch.

---

### GET /intelligence/results/{resultId}

Retrieves a single generation result by ID.

**Middleware:** tenantContext → RBAC (`intelligence:read`) → rateLimit

#### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `resultId` | string | UUID of the generation result |

#### Response — 200 OK

Returns a `GenerationResult` object (same shape as generate response).

#### Response — 404 Not Found

```json
{
  "error": { "code": "NOT_FOUND", "message": "Result not found" }
}
```

---

### GET /intelligence/history

Lists past generation results with pagination and filtering.

**Middleware:** tenantContext → RBAC (`intelligence:read`) → rateLimit

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 20 | Page size (1–100) |
| `lastEvaluatedKey` | string | — | Pagination cursor from previous response |
| `type` | enum | — | Filter by generation type |

#### Response — 200 OK

```json
{
  "results": [ /* GenerationResult[] */ ],
  "lastEvaluatedKey": "encoded-cursor-string"
}
```

---

### GET /intelligence/usage

Returns token usage statistics for the current tenant.

**Middleware:** tenantContext → RBAC (`intelligence:read`) → rateLimit

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | `"daily"` \| `"monthly"` | `"monthly"` | Aggregation period |

#### Response — 200 OK

```json
{
  "tenantId": "tenant-123",
  "period": "monthly",
  "totalInputTokens": 150000,
  "totalOutputTokens": 45000,
  "totalCost": 12.50,
  "budgetLimit": 100.00,
  "budgetRemaining": 87.50,
  "breakdown": {
    "title": { "inputTokens": 30000, "outputTokens": 8000 },
    "description": { "inputTokens": 60000, "outputTokens": 20000 }
  }
}
```

---

## Error Codes

All errors follow a standard envelope:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "field": "path.to.field"
  }
}
```

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body fails Zod schema validation. `field` contains the path. |
| `MISSING_TENANT` | 401 | JWT missing tenant context claims. |
| `TENANT_MISMATCH` | 403 | Cross-tenant resource access attempt. |
| `FORBIDDEN` | 403 | Insufficient RBAC permissions for the resource/action. |
| `RATE_LIMIT_EXCEEDED` | 429 | Exceeded 60 requests/minute. `Retry-After` header included. |
| `BUDGET_EXCEEDED` | 402 | Monthly token budget exhausted. |
| `GENERATION_FAILED` | 502 | Bedrock invocation failed after all retries. |
| `BEDROCK_UNAVAILABLE` | 503 | Bedrock service unavailable after retries. |
| `INTERNAL_ERROR` | 500 | Unexpected server error. |
| `NOT_FOUND` | 404 | Requested resource does not exist. |

---

## Model Selection

The engine selects models based on task complexity:

| Generation Type | Model | Rationale |
|----------------|-------|-----------|
| title, bullets, category, brand, attributes, keywords | Claude 3 Haiku | Low complexity, fast, cost-effective |
| description, seo, compliance | Claude 3 Sonnet | Requires deeper reasoning |

---

## Marketplace Character Limits

| Marketplace | Title | Description | Bullets (each) | Keywords |
|-------------|-------|-------------|----------------|----------|
| Amazon | 200 | 2000 | 500 | 250 |
| Shopify | 255 | 5000 | unlimited | unlimited |
| eBay | 80 | 4000 | 1000 | 1000 |

Content exceeding these limits is truncated at the nearest sentence boundary with `truncated: true` in metadata.

---

## EventBridge Events

The engine emits events to the shared EventBridge bus:

| Detail Type | Trigger |
|-------------|---------|
| `product-intelligence.low-confidence` | Confidence score < 0.5 |
| `product-intelligence.budget-exceeded` | Tenant exceeds monthly budget |
| `product-intelligence.bedrock-failure` | All retry attempts exhausted |

Event source: `merch-os.product-intelligence`
