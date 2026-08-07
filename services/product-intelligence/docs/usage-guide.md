# Product Intelligence Engine — Usage Guide

## Overview

The Product Intelligence Engine provides AI-powered content generation for marketplace product listings. It uses Amazon Bedrock (Claude models) to generate titles, descriptions, bullet points, SEO analysis, category predictions, brand detection, attribute extraction, keywords, and compliance validation.

---

## Authentication

All API calls require a valid JWT token issued by the MerchOS auth platform. The token must include tenant claims that identify the requesting organization.

```bash
curl -X POST /intelligence/generate \
  -H "Authorization: Bearer <your-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{ "type": "title", "productData": { "name": "Wireless Earbuds" } }'
```

### Tenant Isolation

Every operation is scoped to the authenticated tenant. DynamoDB keys are prefixed with `TENANT#{tenantId}` so tenants cannot access each other's data. Cross-tenant access attempts return HTTP 403.

### Required Permissions

The RBAC middleware enforces permissions on the `intelligence` resource:

| Endpoint | Required Permission |
|----------|-------------------|
| POST /intelligence/generate | `intelligence:write` |
| POST /intelligence/batch | `intelligence:write` |
| GET /intelligence/results/{id} | `intelligence:read` |
| GET /intelligence/history | `intelligence:read` |
| GET /intelligence/usage | `intelligence:read` |

---

## Rate Limits

All generation endpoints enforce a rate limit of **60 requests per minute per tenant**.

When the limit is exceeded, the API returns:

```json
HTTP 429 Too Many Requests
Retry-After: <seconds>

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Try again after the Retry-After interval."
  }
}
```

**Best practices:**
- Use batch processing for bulk operations instead of individual calls
- Implement exponential backoff on 429 responses
- Monitor your request rate via the usage endpoint

---

## Batch Processing

The batch endpoint processes up to 50 items in a single call with configurable concurrency.

### Basic Usage

```json
POST /intelligence/batch
{
  "items": [
    { "type": "title", "productData": { "name": "Product A", "category": "Electronics" } },
    { "type": "title", "productData": { "name": "Product B", "category": "Home" } },
    { "type": "description", "productData": { "name": "Product A" }, "marketplace": "amazon" }
  ],
  "concurrencyLimit": 5
}
```

### Concurrency Control

The `concurrencyLimit` field controls how many Bedrock API calls run in parallel:

| Value | Use Case |
|-------|----------|
| 1–3 | Conservative. Less Bedrock pressure but slower overall. |
| 5 (default) | Balanced throughput and resource usage. |
| 10–20 | Aggressive. Faster but may trigger Bedrock throttling. |

### Partial Failures

Batch results include a summary with success/failure counts. Individual items that fail do not block others:

```json
{
  "results": [ ... ],
  "summary": {
    "total": 10,
    "succeeded": 8,
    "failed": 2,
    "totalTokens": 2400
  }
}
```

Failed items include an error object in their result. Processing stops early if the tenant's budget is exceeded.

---

## Cost Management

### Token Tracking

Every Bedrock invocation tracks input and output tokens. Usage accumulates per tenant at daily and monthly granularity.

Check your current usage:

```bash
GET /intelligence/usage?period=monthly
```

Response:

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
    "description": { "inputTokens": 60000, "outputTokens": 20000 },
    "seo": { "inputTokens": 40000, "outputTokens": 12000 },
    "keywords": { "inputTokens": 20000, "outputTokens": 5000 }
  }
}
```

### Budget Enforcement

Each tenant has a configured monthly token budget. When the budget is exhausted:

1. The API returns HTTP 402 with `BUDGET_EXCEEDED` error code
2. A `product-intelligence.budget-exceeded` event is emitted to EventBridge
3. No further generation requests are processed until the next billing cycle

```json
{
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "Monthly token budget exceeded"
  }
}
```

### Cost Optimization Tips

- **Use caching:** Identical requests (same product data, type, marketplace, prompt version) return cached results at no additional cost
- **Choose the right type:** Simple tasks (title, keywords) use Haiku (cheaper). Complex tasks (description, SEO, compliance) use Sonnet
- **Batch smartly:** Group similar requests. Set `concurrencyLimit` based on your urgency vs. cost tolerance
- **Provide complete data:** Higher input completeness produces higher confidence scores, reducing the need for regeneration

---

## Response Caching

The engine caches responses to reduce cost and latency for repeated requests.

### How Caching Works

1. A SHA-256 hash is computed from: normalized product data + generation type + marketplace + prompt version
2. If a cache entry exists and has not expired, it's returned immediately without calling Bedrock
3. The `cached: true` flag in result metadata indicates a cache hit

### Cache Key Composition

These fields determine the cache key — changing any of them produces a cache miss:

- Product data (all fields, normalized and sorted)
- Generation type
- Target marketplace
- Active prompt template version

### Cache TTL

Default TTL is **24 hours**. Cache entries are automatically invalidated when:

- The TTL expires (DynamoDB TTL)
- A prompt template version changes for that generation type

### Identifying Cached Results

```json
{
  "metadata": {
    "cached": true,
    "latencyMs": 15
  }
}
```

Cached responses have significantly lower latency (typically < 50ms vs. 1–3s for Bedrock calls).

---

## Confidence Scores

Every generation result includes a confidence score between 0.0 and 1.0.

### Interpretation

| Score Range | Meaning |
|-------------|---------|
| 0.8–1.0 | High confidence. Content is ready for use. |
| 0.7–0.79 | Good confidence. Usable without review. |
| 0.5–0.69 | Moderate. `reviewRecommended: true` — manual review suggested. |
| 0.0–0.49 | Low confidence. EventBridge event emitted. Manual review required. |

### Factors

Confidence is calculated from:

1. **Model probability** — How confident the LLM is in its output
2. **Input completeness** — How much product data was provided (more data → higher confidence)
3. **Historical accuracy** — Past accuracy for this generation type

### Using Confidence in Your Workflow

- Filter results by `reviewRecommended: true` in your history to find items needing attention
- Set up EventBridge rules to trigger notifications when low-confidence results are generated
- Provide more complete product data to increase confidence scores

---

## Marketplace Targeting

Specify a `marketplace` field to tailor content for specific platforms.

### Supported Marketplaces

| ID | Platform | Special Handling |
|----|----------|-----------------|
| `amazon` | Amazon | A+ content structuring, strict character limits, trademark-restricted characters removed |
| `shopify` | Shopify | Rich HTML allowed, generous limits |
| `ebay` | eBay | Short titles (80 char), restricted HTML |

### What Marketplace Targeting Does

1. **Character limits enforced** — Content truncated at sentence boundaries when over limit
2. **HTML filtering** — Disallowed HTML tags stripped per platform rules
3. **Restricted characters removed** — Platform-specific banned characters sanitized
4. **A+ content** — Amazon descriptions structured for enhanced brand content modules
5. **Compliance status** — Result includes `marketplaceCompliance: "compliant" | "warnings" | "non_compliant"`

### Example

```json
{
  "type": "description",
  "productData": { "name": "Luxury Watch", "brand": "Zenith" },
  "marketplace": "amazon",
  "options": { "tone": "luxury" }
}
```

---

## Error Handling

### Retry Strategy for Clients

When the API returns transient errors (429, 502, 503), implement client-side retry with backoff:

```typescript
async function generateWithRetry(request, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch('/intelligence/generate', { ... });

    if (response.ok) return response.json();

    if (response.status === 429 || response.status >= 500) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
      await sleep(delay + Math.random() * delay);
      continue;
    }

    // Non-retryable error (400, 401, 402, 403)
    throw new Error(await response.text());
  }
  throw new Error('Max retries exceeded');
}
```

### Server-Side Retries (Bedrock)

The engine internally retries failed Bedrock calls with:
- Max 3 retries (4 total attempts)
- Exponential backoff: 2s → 4s → 8s (with full jitter)
- Retryable errors: `ThrottlingException`, `ServiceUnavailableException`, `InternalServerError`

If all retries fail, you receive a `GENERATION_FAILED` (502) or `BEDROCK_UNAVAILABLE` (503) error.

---

## Generation Types Quick Reference

| Type | Description | Input Focus |
|------|-------------|-------------|
| `title` | SEO-optimized product title | `name`, `brand`, `category`, `attributes` |
| `description` | Full product description | `name`, `description`, `brand`, `attributes` |
| `bullets` | Feature bullet points | `name`, `attributes`, `description` |
| `seo` | Keyword density + optimization | `existingContent` or `description` |
| `category` | Taxonomy classification | `name`, `category`, `description` |
| `brand` | Brand identification | `name`, `description`, `existingContent` |
| `attributes` | Structured attribute extraction | `description`, `existingContent` |
| `keywords` | Search keyword generation | `name`, `description`, `category` |
| `compliance` | Policy validation | `existingContent` or `description` |
