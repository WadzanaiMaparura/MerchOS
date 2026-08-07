# Product Intelligence Engine — Prompt Authoring Guide

## Overview

The Product Intelligence Engine uses versioned prompt templates to construct prompts for Amazon Bedrock (Claude) model invocations. Templates support variable interpolation, A/B testing, and version management. This guide explains how to author, manage, and test prompt templates.

---

## Template Syntax

### Variable Placeholders

Templates use **double-brace syntax** for variable interpolation:

```
Generate a product title for {{product_name}} in the {{category}} category.
The brand is {{brand}}. Key features: {{features}}.
```

Rules:
- Variable names must be word characters only: `[a-zA-Z0-9_]`
- Placeholders are replaced at invocation time with corresponding values
- Unknown variables (not in the variables map) are replaced with an empty string
- After interpolation, no `{{...}}` placeholders remain in the final prompt

### Variable Naming Conventions

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `product_name` | Product name/title | "Wireless Noise-Cancelling Headphones" |
| `brand` | Brand name | "Sony" |
| `category` | Product category | "Electronics > Audio > Headphones" |
| `features` | Key features list | "Bluetooth 5.0, 30hr battery, ANC" |
| `description` | Raw product description | Full product text |
| `marketplace` | Target marketplace | "amazon" |
| `tone` | Writing style | "professional" |
| `existing_content` | Content to optimize | Existing listing text |
| `competitor_keywords` | Competitor terms | "wireless, bluetooth, noise cancel" |
| `word_count_min` | Min word count | "100" |
| `word_count_max` | Max word count | "200" |

### Example Template

```
You are a product listing expert for {{marketplace}}.

Generate a compelling product title for:
- Product: {{product_name}}
- Brand: {{brand}}
- Category: {{category}}
- Key Features: {{features}}

Requirements:
- Maximum 200 characters
- Include brand name at the start
- Include 2-3 primary keywords
- Follow {{marketplace}} title formatting guidelines

Output only the title text, nothing else.
```

---

## Template Data Model

Each prompt template is stored in DynamoDB with the following structure:

```typescript
interface PromptTemplate {
  templateId: string;         // UUID assigned on creation
  generationType: GenerationType; // title, description, bullets, etc.
  version: number;            // Monotonically increasing per generation type
  content: string;            // Template text with {{variables}}
  variables: string[];        // Declared variable names
  active: boolean;            // Whether this version receives traffic
  createdAt: string;          // ISO 8601 timestamp
  trafficPercentage?: number; // For A/B testing (0-100)
}
```

### Generation Types

Each template targets exactly one generation type:

| Type | Purpose |
|------|---------|
| `title` | Product title generation |
| `description` | Product description writing |
| `bullets` | Bullet point creation |
| `seo` | SEO analysis and optimization |
| `category` | Category classification |
| `brand` | Brand detection |
| `attributes` | Attribute extraction |
| `keywords` | Keyword generation |
| `compliance` | Content compliance checking |

---

## Version Management

### How Versioning Works

- Each generation type maintains its own independent version sequence
- Version numbers are **monotonically increasing** — each new version is strictly greater than all previous versions for that type
- Old versions are never deleted, only deactivated
- The system always routes to the most recent active version (unless A/B testing is configured)

### Creating a New Version

```typescript
import { promptManager } from '../services/prompt-manager';

const newTemplate = await promptManager.createVersion({
  generationType: 'title',
  content: 'Generate a title for {{product_name}} by {{brand}} in {{category}}...',
  variables: ['product_name', 'brand', 'category'],
  active: true,
  createdBy: 'admin-user-id',
});

console.log(newTemplate.version); // e.g., 4 (auto-assigned)
```

### Deactivating a Version

When a template version is deactivated:
1. It stops receiving new requests
2. The system falls back to the most recent remaining active version
3. Cached responses generated with the deactivated version remain valid until TTL expires

```typescript
await promptManager.deactivateVersion(templateId, versionNumber);
```

### Version in Results

Every generation result records which prompt version was used:

```json
{
  "metadata": {
    "promptVersion": 3,
    "promptTemplateId": "abc-123-uuid"
  }
}
```

This enables:
- Tracing which prompt produced each output
- Comparing quality across versions
- Cache invalidation when versions change

---

## Variable Interpolation

### How It Works

The `interpolate` method replaces all `{{variable_name}}` tokens in the template string:

```typescript
const result = promptManager.interpolate(
  'Hello {{name}}, your product {{product}} is in {{category}}.',
  { name: 'Alice', product: 'Widget Pro', category: 'Tools' }
);
// → "Hello Alice, your product Widget Pro is in Tools."
```

### Behavior Details

| Scenario | Behavior |
|----------|----------|
| Variable in map | Replaced with the value |
| Variable NOT in map | Replaced with empty string `""` |
| No placeholders in template | Template returned unchanged |
| Nested braces `{{{var}}}` | Outer pair matched, inner brace remains in output |
| Non-word characters in braces `{{foo-bar}}` | NOT matched (only `\w+` matches) |

### Interpolation Guarantee (Property 5)

After interpolation completes:
- Every `{{variable}}` placeholder has been replaced
- No double-brace tokens remain in the output
- The output length may differ from the template length

---

## A/B Testing

### Concept

A/B testing allows you to route traffic between multiple prompt template versions to compare their effectiveness. Each variant receives a configured percentage of requests.

### Configuration

```typescript
const abConfig: ABTestConfig = {
  enabled: true,
  variants: [
    { templateId: 'tmpl-a', version: 3, trafficPercentage: 70 },
    { templateId: 'tmpl-b', version: 4, trafficPercentage: 30 },
  ],
};
```

Rules:
- Traffic percentages across all variants **must sum to 100**
- Each variant references a specific template ID and version
- The system uses cumulative probability distribution to select variants

### How Variant Selection Works

1. A random number between 0 and 100 is generated per request
2. The system walks through variants, accumulating traffic percentages
3. The first variant whose cumulative percentage exceeds the random number is selected
4. If the selected variant's template cannot be found in DynamoDB, it falls back to the most recent active template

### Example: 70/30 Split

```
Random: 0–69   → Variant A (version 3) selected
Random: 70–99  → Variant B (version 4) selected
```

### Statistical Guarantee (Property 19)

Over 1000+ requests, the observed distribution is within ±10 percentage points of configured percentages.

### Using A/B Testing

```typescript
const template = await promptManager.getActiveTemplate('title', abConfig);
// Returns either version 3 or version 4 based on traffic percentages
```

### Measuring Results

Since every result records `promptVersion` and `promptTemplateId`, you can:

1. Query generation history filtered by prompt version
2. Compare average confidence scores between versions
3. Track user approval rates per version
4. Make data-driven decisions about which prompt to promote

---

## Best Practices

### Writing Effective Prompts

1. **Be specific about output format** — Tell the model exactly what format to return (just text, JSON, list, etc.)
2. **Include constraints** — Character limits, word counts, formatting rules
3. **Provide context** — Marketplace, category, and brand context improve output quality
4. **Use examples** — Include few-shot examples in the template for consistent formatting
5. **Specify what to avoid** — Explicitly list what not to include (competitor mentions, restricted terms)

### Template Organization

```
# Good: Clear sections with explicit instructions
You are a {{marketplace}} product listing expert.

## Input
Product: {{product_name}}
Brand: {{brand}}
Category: {{category}}

## Instructions
1. Generate exactly {{bullet_count}} bullet points
2. Each bullet should highlight a distinct feature
3. Start each bullet with a benefit, then support with a feature
4. Keep each bullet under 500 characters

## Output Format
Return only the bullet points, one per line, prefixed with "• ".
```

### Version Transition Strategy

1. Create the new version with `active: true`
2. Optionally set up A/B testing (e.g., 90/10 split) to validate
3. Monitor confidence scores and user approval rates
4. Once satisfied, deactivate the old version
5. Cache is automatically invalidated for the old prompt version

### Variables Checklist

When creating a template, declare all variables in the `variables` array:

```typescript
{
  content: 'Generate for {{product_name}} by {{brand}}...',
  variables: ['product_name', 'brand'], // Must list all {{...}} vars
}
```

This serves as documentation and enables validation tooling to warn about mismatches between declared and used variables.

---

## Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Empty output for a variable | Variable name not in the provided map | Ensure the caller passes all required variables |
| Placeholder not replaced | Variable name contains non-word chars (hyphens, dots) | Use only `[a-zA-Z0-9_]` in variable names |
| Low confidence after version change | New prompt may need tuning | A/B test before full rollout |
| Cache still serving old version | TTL hasn't expired | Cache invalidation runs when prompt version changes; wait for propagation |

### Debugging Template Issues

1. Check the `promptVersion` in generation results to confirm which version was used
2. Query history filtered by version to compare outputs
3. Use the usage endpoint to verify traffic is being distributed as expected
4. Review EventBridge events for low-confidence patterns after template changes
