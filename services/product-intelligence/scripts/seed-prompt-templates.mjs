/**
 * Seed active prompt templates for the Product Intelligence Engine.
 *
 * The generate/batch endpoints call PromptManager.getActiveTemplate(type) for
 * EVERY generation type (for version tracking + A/B selection), so every type
 * needs at least one `active` template or generation fails with
 * "No active prompt template found for generation type: <type>".
 *
 * Content-generator types (title/description/bullets) interpolate the stored
 * `content` with {{variables}} and send it to Bedrock. The remaining types
 * (seo/category/brand/attributes/keywords/compliance) build their own prompts
 * inside their services and only need an active template to exist for
 * traceability — a minimal content string is sufficient and harmless.
 *
 * This mirrors PromptManager.createVersion's item shape exactly (PK/SK padded
 * version, templateId, active, etc.) and is idempotent: it will not re-seed a
 * type that already has an active template.
 *
 * Usage:
 *   node scripts/seed-prompt-templates.mjs
 * Env:
 *   PRODUCT_INTELLIGENCE_TABLE (default: product-intelligence-dev)
 *   AWS_REGION (default: eu-west-1)
 *   AWS_PROFILE (e.g. merchos-admin)
 */

import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.PRODUCT_INTELLIGENCE_TABLE ?? 'product-intelligence-dev';
const REGION = process.env.AWS_REGION ?? 'eu-west-1';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// Variables available for interpolation (see content-generator.buildPromptVariables):
//   product_name, product_description, category, brand, attributes, price, existing_content
const CONTENT_VARS = ['product_name', 'brand', 'category', 'attributes'];

/**
 * Template definitions per generation type.
 * - title/description/bullets: real interpolated prompts used verbatim by Bedrock.
 * - others: minimal active placeholder (their service builds the real prompt).
 */
const TEMPLATES = {
  title: {
    variables: CONTENT_VARS,
    content:
      'You are an expert e-commerce copywriter. Write a single, concise, keyword-rich ' +
      'product title for the following product. Return ONLY the title text, no quotes or ' +
      'explanation.\n\n' +
      'Product name: {{product_name}}\n' +
      'Brand: {{brand}}\n' +
      'Category: {{category}}\n' +
      'Key attributes: {{attributes}}',
  },
  description: {
    variables: CONTENT_VARS,
    content:
      'You are an expert e-commerce copywriter. Write a clear, persuasive product ' +
      'description for the following product. Use short paragraphs and highlight the key ' +
      'benefits. Return ONLY the description text.\n\n' +
      'Product name: {{product_name}}\n' +
      'Brand: {{brand}}\n' +
      'Category: {{category}}\n' +
      'Key attributes: {{attributes}}',
  },
  bullets: {
    variables: CONTENT_VARS,
    content:
      'You are an expert e-commerce copywriter. Write concise product feature bullet ' +
      'points for the following product. Each bullet should highlight one distinct ' +
      'benefit or feature. Return ONLY the bullets, one per line.\n\n' +
      'Product name: {{product_name}}\n' +
      'Brand: {{brand}}\n' +
      'Category: {{category}}\n' +
      'Key attributes: {{attributes}}',
  },
  // Service-built-prompt types: an active template must exist, but the content
  // is not the authoritative prompt (the service composes its own).
  seo: { variables: [], content: 'SEO optimisation handled by SeoOptimizer service. Product: {{product_name}}.' },
  category: { variables: [], content: 'Category prediction handled by CategoryPredictor service. Product: {{product_name}}.' },
  brand: { variables: [], content: 'Brand detection handled by BrandDetector service. Product: {{product_name}}.' },
  attributes: { variables: [], content: 'Attribute extraction handled by the attributes service. Product: {{product_name}}.' },
  keywords: { variables: [], content: 'Keyword generation handled by KeywordGenerator service. Product: {{product_name}}.' },
  compliance: { variables: [], content: 'Compliance validation handled by ComplianceValidator service. Content: {{existing_content}}.' },
};

async function hasActiveTemplate(generationType) {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'active = :active',
      ExpressionAttributeValues: {
        ':pk': `PROMPT#${generationType}`,
        ':skPrefix': 'VERSION#',
        ':active': true,
      },
      Limit: 1,
    })
  );
  return (res.Items ?? []).length > 0;
}

async function seedOne(generationType, def) {
  if (await hasActiveTemplate(generationType)) {
    console.log(`  = ${generationType}: active template already exists, skipping`);
    return false;
  }
  const version = 1;
  const paddedVersion = String(version).padStart(10, '0');
  const item = {
    PK: `PROMPT#${generationType}`,
    SK: `VERSION#${paddedVersion}`,
    templateId: randomUUID(),
    generationType,
    version,
    content: def.content,
    variables: def.variables,
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: 'seed-script',
  };
  await doc.send(new PutCommand({ TableName: TABLE, Item: item }));
  console.log(`  + ${generationType}: seeded v1 (${item.templateId})`);
  return true;
}

async function main() {
  console.log(`Seeding prompt templates into ${TABLE} (${REGION})`);
  let seeded = 0;
  for (const [type, def] of Object.entries(TEMPLATES)) {
    if (await seedOne(type, def)) seeded++;
  }
  console.log(`\nDone. Seeded ${seeded} new template(s); ${Object.keys(TEMPLATES).length - seeded} already present.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
