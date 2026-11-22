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

/**
 * Version 2 of the writing prompts (Nov 2026). Changes from v1:
 * - the supplier's own details ({{product_description}}) are included; v1 never
 *   sent them, so features like boil-dry protection and warranty were lost;
 * - benefits and expected results are encouraged, invented specifications are not;
 * - plain text only (marketplaces show ** literally), South African English;
 * - written for the target marketplace ({{marketplace}}).
 * The newest active version is used; v1 stays active as a rollback (deactivate v2).
 */
const PRODUCT_BLOCK =
  'Product name: {{product_name}}\n' +
  'Brand: {{brand}}\n' +
  'Category: {{category}}\n' +
  'Specifications: {{attributes}}\n' +
  'Supplier details: {{product_description}}';

const V2_VARS = ['product_name', 'brand', 'category', 'attributes', 'product_description', 'marketplace'];

const TEMPLATES_V2 = {
  title: {
    variables: V2_VARS,
    content:
      'You write product titles for {{marketplace}} listings for South African shoppers.\n' +
      'Write ONE title in this order: brand, what the product is, then its most important ' +
      'specifications (for example size, capacity, power, colour or pack size).\n\n' +
      'Rules:\n' +
      '- Use only the facts below. Never invent a specification, model number or size.\n' +
      '- Between 60 and 120 characters.\n' +
      '- No emojis, no quotation marks, no ALL CAPS words.\n' +
      '- Plain text only.\n\n' +
      PRODUCT_BLOCK +
      '\n\nReturn only the title.',
  },
  description: {
    variables: V2_VARS,
    content:
      'You write product descriptions for {{marketplace}} listings for South African shoppers.\n' +
      'Write 2 to 4 short paragraphs, 120 to 220 words in total, in South African English ' +
      '(for example "colour", "litre").\n\n' +
      'Rules:\n' +
      '- Start with what the product is and who it suits.\n' +
      '- Cover every feature and specification in the details below and say what each one ' +
      'means for the buyer. Benefits and expected results are welcome, for example quicker ' +
      'boiling, easier cleaning or more cups at once.\n' +
      '- Never invent specifications, parts, materials, certifications or included items. ' +
      'If something is not in the details, leave it out.\n' +
      '- Include the warranty or guarantee when it is given.\n' +
      '- Plain text only: no headings, no lists, no bold, no emojis.\n\n' +
      PRODUCT_BLOCK +
      '\n\nReturn only the description.',
  },
  bullets: {
    variables: [...V2_VARS, 'bullet_count'],
    content:
      'Write exactly {{bullet_count}} feature bullets for a {{marketplace}} listing for ' +
      'South African shoppers, in South African English.\n\n' +
      'Rules:\n' +
      '- Each bullet names one feature from the details, then its benefit to the buyer, ' +
      'in one sentence of 10 to 25 words.\n' +
      '- Most important first. Include safety features and the warranty when they are given.\n' +
      '- Benefits and expected results are welcome; never invent a specification.\n' +
      '- Plain text only: no bold, no numbers or symbols at the start. One bullet per line.\n\n' +
      PRODUCT_BLOCK +
      '\n\nReturn only the bullets, one per line.',
  },
};

async function hasVersion(generationType, version) {
  const res = await doc.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: {
        ':pk': `PROMPT#${generationType}`,
        ':sk': `VERSION#${String(version).padStart(10, '0')}`,
      },
    })
  );
  return (res.Items ?? []).length > 0;
}

async function seedVersion(generationType, version, def) {
  if (await hasVersion(generationType, version)) {
    console.log(`  = ${generationType}: v${version} already exists, skipping`);
    return false;
  }
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `PROMPT#${generationType}`,
        SK: `VERSION#${String(version).padStart(10, '0')}`,
        templateId: randomUUID(),
        generationType,
        version,
        content: def.content,
        variables: def.variables,
        active: true,
        createdAt: new Date().toISOString(),
        createdBy: 'seed-script',
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    })
  );
  console.log(`  + ${generationType}: seeded v${version}`);
  return true;
}

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
  for (const [type, def] of Object.entries(TEMPLATES_V2)) {
    if (await seedVersion(type, 2, def)) seeded++;
  }
  console.log(`\nDone. Seeded ${seeded} new template(s); ${Object.keys(TEMPLATES).length - seeded} already present.`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
