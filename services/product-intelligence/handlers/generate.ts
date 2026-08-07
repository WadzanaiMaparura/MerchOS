/**
 * Generate Lambda handler for POST /intelligence/generate.
 *
 * Orchestrates AI content generation by validating the request, checking budget,
 * routing to the appropriate service based on generation type, recording token
 * usage, storing results in DynamoDB, and emitting events for low-confidence results.
 *
 * Requirements: 1.1, 1.5, 11.1, 11.3, 11.4, 13.5, 15.1, 16.1, 16.2, 16.3, 16.5
 */

import { randomUUID } from 'crypto';

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';

import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger, tracer } from '../../shared/middleware/powertools';

import { generateRequestSchema } from '../schemas/generate.schema';
import type { GenerateRequestInput } from '../schemas/generate.schema';
import type { GenerationResult, GenerationType } from '../types/generation.types';

import { tokenTracker } from '../services/token-tracker';
import { contentGenerator } from '../services/content-generator';
import { seoOptimizer } from '../services/seo-optimizer';
import { categoryPredictor } from '../services/category-predictor';
import { brandDetector } from '../services/brand-detector';
import { attributeExtractor } from '../services/attribute-extractor';
import { keywordGenerator } from '../services/keyword-generator';
import { complianceValidator } from '../services/compliance-validator';
import { responseCache } from '../services/response-cache';
import { promptManager } from '../services/prompt-manager';
import { marketplaceAdapter } from '../services/marketplace-adapter';
import type { CacheKeyInput } from '../types/cache.types';
import type { MarketplaceId } from '../types/generation.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** DynamoDB table name from environment */
const TABLE_NAME = process.env['PRODUCT_INTELLIGENCE_TABLE'] ?? 'product-intelligence';

/** EventBridge source identifier */
const EVENT_SOURCE = 'merch-os.product-intelligence';

/** Low-confidence threshold for EventBridge event emission */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// DynamoDB Client Setup
// ---------------------------------------------------------------------------

let ddbDocClient: DynamoDBDocumentClient | null = null;

function getDynamoDocClient(): DynamoDBDocumentClient {
  if (!ddbDocClient) {
    const client = new DynamoDBClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
    ddbDocClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return ddbDocClient;
}

/** Override the DynamoDB Document Client (used for testing). */
export function setDynamoDocClient(client: DynamoDBDocumentClient): void {
  ddbDocClient = client;
}

// ---------------------------------------------------------------------------
// EventBridge Client Setup
// ---------------------------------------------------------------------------

let eventBridgeClient: EventBridgeClient | null = null;

function getEventBridgeClient(): EventBridgeClient {
  if (!eventBridgeClient) {
    eventBridgeClient = new EventBridgeClient({
      region: process.env['AWS_REGION'] ?? 'af-south-1',
    });
  }
  return eventBridgeClient;
}

/** Override the EventBridge Client (used for testing). */
export function setEventBridgeClient(client: EventBridgeClient): void {
  eventBridgeClient = client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts tenantId from the authorizer context attached by the tenant middleware.
 */
function extractTenantId(event: Record<string, unknown>): string | undefined {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const authorizer = requestContext?.['authorizer'] as Record<string, unknown> | undefined;
  const tenantContext = authorizer?.['tenantContext'] as Record<string, unknown> | undefined;
  return tenantContext?.['tenantId'] as string | undefined;
}

/**
 * Emits a low-confidence EventBridge event when the confidence score is below 0.5.
 *
 * @see Requirement 11.4
 */
async function emitLowConfidenceEvent(
  tenantId: string,
  resultId: string,
  generationType: GenerationType,
  confidenceScore: number,
): Promise<void> {
  const eventBusName = process.env['EVENT_BUS_NAME'];
  if (!eventBusName) {
    return;
  }

  const client = getEventBridgeClient();
  await client.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: EVENT_SOURCE,
          DetailType: 'product-intelligence.low-confidence',
          Detail: JSON.stringify({
            tenantId,
            resultId,
            generationType,
            confidenceScore,
            timestamp: new Date().toISOString(),
          }),
          EventBusName: eventBusName,
          Time: new Date(),
        },
      ],
    }),
  );
}

/**
 * Stores a generation result in DynamoDB with tenant-scoped PK.
 *
 * @see Requirement 16.2
 */
async function storeResult(
  tenantId: string,
  result: GenerationResult,
): Promise<void> {
  const client = getDynamoDocClient();
  const now = result.createdAt;

  await client.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `RESULT#${result.resultId}`,
        GSI1PK: `TENANT#${tenantId}`,
        GSI1SK: `RESULT#CREATED#${now}`,
        GSI2PK: `TENANT#${tenantId}#CONFIDENCE`,
        GSI2SK: `SCORE#${result.confidenceScore.toFixed(4)}#CREATED#${now}`,
        resultId: result.resultId,
        tenantId,
        generationType: result.type,
        status: result.status,
        result: result.content,
        confidenceScore: result.confidenceScore,
        reviewRecommended: result.reviewRecommended,
        tokenUsage: result.metadata.tokenUsage,
        promptVersion: result.metadata.promptVersion,
        promptTemplateId: result.metadata.promptTemplateId,
        marketplace: result.metadata.marketplace,
        marketplaceCompliance: result.metadata.marketplaceCompliance,
        cached: result.metadata.cached,
        createdAt: now,
      },
    }),
  );
}

/**
 * Routes the generation request to the appropriate service based on type.
 *
 * For content-generator types (title, description, bullets), the contentGenerator
 * internally handles cache, prompt resolution (with A/B variant selection), and marketplace rules.
 *
 * For non-content-generator types (seo, category, brand, attributes, keywords, compliance),
 * this function applies:
 * 1. Prompt template resolution (for traceability/versioning in metadata)
 * 2. Response cache check before service invocation
 * 3. The appropriate service invocation
 * 4. Marketplace adapter post-processing (when marketplace is specified)
 * 5. Response cache set after successful generation
 */
async function routeToService(request: GenerateRequestInput): Promise<GenerationResult> {
  const { type, productData, marketplace, options } = request;

  // Content-generator types: full orchestration is internal
  switch (type) {
    case 'title':
      return contentGenerator.generateTitle({
        productData,
        marketplace,
        attributes: options as Record<string, string> | undefined,
      });

    case 'description':
      return contentGenerator.generateDescription({
        productData,
        marketplace,
        tone: (options?.['tone'] as 'professional' | 'casual' | 'luxury') ?? undefined,
        wordCountRange: options?.['wordCountRange'] as
          | { min: number; max: number }
          | undefined,
      });

    case 'bullets':
      return contentGenerator.generateBullets({
        productData,
        marketplace,
        count: (options?.['count'] as number) ?? undefined,
        attributes: options?.['attributes'] as Record<string, string> | undefined,
      });

    default:
      // Non-content-generator types: wire cache + marketplace adapter at the handler level
      return routeNonContentGeneratorService(type, productData, marketplace, options);
  }
}

/**
 * Normalizes request data into a deterministic string for cache key computation.
 */
function normalizeRequestInput(request: GenerateRequestInput): string {
  const { type, productData, marketplace, options } = request;
  const payload = {
    type,
    productData: {
      name: productData.name ?? null,
      description: productData.description ?? null,
      category: productData.category ?? null,
      brand: productData.brand ?? null,
      attributes: productData.attributes ?? null,
      images: productData.images ?? null,
      price: productData.price ?? null,
      existingContent: productData.existingContent ?? null,
    },
    marketplace: marketplace ?? null,
    options: options ?? null,
  };
  return JSON.stringify(payload, Object.keys(payload).sort());
}

/**
 * Handles routing, cache, prompt resolution, and marketplace adaptation for
 * non-content-generator service types (seo, category, brand, attributes, keywords, compliance).
 *
 * Flow:
 * 1. Resolve active prompt template (for version tracking and A/B variant selection)
 * 2. Check response cache
 * 3. On cache miss: invoke the appropriate service
 * 4. Apply marketplace adapter when marketplace is specified
 * 5. Cache the result
 * 6. Return the GenerationResult
 *
 * @see Requirements 12.3, 12.4, 13.1, 8.1
 */
async function routeNonContentGeneratorService(
  type: GenerationType,
  productData: GenerateRequestInput['productData'],
  marketplace: MarketplaceId | undefined,
  options: Record<string, unknown> | undefined,
): Promise<GenerationResult> {
  // 1. Resolve active prompt template for version tracking and A/B selection
  const template = await promptManager.getActiveTemplate(type);

  // 2. Check response cache
  const normalizedInput = normalizeRequestInput({ type, productData, marketplace, options });
  const cacheKeyInput: CacheKeyInput = {
    normalizedInput,
    generationType: type,
    ...(marketplace ? { marketplace } : {}),
    promptVersion: template.version,
  };
  const cacheKey = responseCache.computeKey(cacheKeyInput);
  const cached = await responseCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  // 3. Invoke the appropriate service
  let result: GenerationResult;

  switch (type) {
    case 'seo': {
      const seoResult = await seoOptimizer.analyze({
        content: productData.existingContent ?? productData.description ?? '',
        productData,
        marketplace,
      });
      result = buildGenerationResult('seo', { type: 'seo', analysis: seoResult }, seoResult.confidenceScore);
      break;
    }

    case 'category': {
      const categoryResult = await categoryPredictor.predict({
        productData,
        marketplace,
      });
      const categoryConfidence =
        categoryResult.predictions.length > 0
          ? categoryResult.predictions[0]!.confidenceScore
          : 0;
      result = buildGenerationResult('category', { type: 'category', predictions: categoryResult }, categoryConfidence);
      break;
    }

    case 'brand': {
      const brandResult = await brandDetector.detect({
        text: productData.existingContent ?? productData.description ?? productData.name ?? '',
        productData,
      });
      const brandConfidence =
        brandResult.brands.length > 0 ? brandResult.brands[0]!.confidenceScore : 0;
      result = buildGenerationResult('brand', { type: 'brand', detection: brandResult }, brandConfidence);
      break;
    }

    case 'attributes': {
      const attrResult = await attributeExtractor.extract({
        text: productData.existingContent ?? productData.description ?? '',
        productData,
        marketplace,
      });
      const attrConfidence =
        attrResult.attributes.length > 0
          ? attrResult.attributes.reduce((sum, a) => sum + a.confidenceScore, 0) /
            attrResult.attributes.length
          : 0;
      result = buildGenerationResult('attributes', { type: 'attributes', extraction: attrResult }, attrConfidence);
      break;
    }

    case 'keywords': {
      const kwResult = await keywordGenerator.generate({
        productData,
        marketplace,
        count: (options?.['count'] as number) ?? undefined,
        competitorKeywords: options?.['competitorKeywords'] as string[] | undefined,
      });
      result = buildGenerationResult('keywords', { type: 'keywords', keywords: kwResult }, kwResult.overallQualityScore);
      break;
    }

    case 'compliance': {
      const compResult = await complianceValidator.validate({
        content: productData.existingContent ?? productData.description ?? '',
        marketplace: marketplace ?? 'amazon',
        productData,
      });
      result = buildGenerationResult('compliance', { type: 'compliance', validation: compResult }, compResult.complianceScore);
      break;
    }

    default:
      throw new Error(`Unsupported generation type: ${type as string}`);
  }

  // Update result metadata with prompt template info for traceability (Requirement 12.4)
  result = {
    ...result,
    metadata: {
      ...result.metadata,
      promptVersion: template.version,
      promptTemplateId: template.templateId,
    },
  };

  // 4. Apply marketplace adapter for marketplace-targeted requests (Requirement 8.1)
  if (marketplace && result.status === 'completed') {
    result = applyMarketplaceAdapterToResult(result, marketplace, type);
  }

  // 5. Cache the result
  await responseCache.set(cacheKey, result);

  return result;
}

/**
 * Applies the marketplace adapter to a GenerationResult for non-content-generator types.
 *
 * Extracts displayable text content from the result, applies marketplace rules,
 * and updates the result metadata with marketplace compliance status.
 *
 * @param result - The generation result to adapt
 * @param marketplace - The target marketplace
 * @param type - The generation type
 * @returns The result with marketplace compliance metadata applied
 */
function applyMarketplaceAdapterToResult(
  result: GenerationResult,
  marketplace: MarketplaceId,
  type: GenerationType,
): GenerationResult {
  // Extract the text content that can be marketplace-adapted
  const textContent = extractTextContentForAdaptation(result);

  if (!textContent) {
    // No adaptable text content — just add marketplace metadata
    return {
      ...result,
      metadata: {
        ...result.metadata,
        marketplace,
        marketplaceCompliance: 'compliant',
      },
    };
  }

  const adapted = marketplaceAdapter.apply(textContent, marketplace, type);

  return {
    ...result,
    metadata: {
      ...result.metadata,
      marketplace,
      marketplaceCompliance: adapted.complianceStatus,
    },
  };
}

/**
 * Extracts displayable text content from a GenerationResult for marketplace adaptation.
 * Returns null for result types that don't produce adaptable text (e.g., structured data).
 */
function extractTextContentForAdaptation(result: GenerationResult): string | null {
  const content = result.content;
  switch (content.type) {
    case 'seo':
      return content.analysis.optimizedContent || null;
    case 'keywords':
      // Keywords are a structured list — adapt the terms joined
      return content.keywords.keywords.map((k) => k.term).join(', ') || null;
    case 'compliance':
      return content.validation.correctedContent ?? null;
    case 'category':
    case 'brand':
    case 'attributes':
      // Structured data results — no text to adapt directly
      return null;
    default:
      return null;
  }
}

/**
 * Builds a GenerationResult envelope for services that return their own result types.
 */
function buildGenerationResult(
  type: GenerationType,
  content: GenerationResult['content'],
  confidenceScore: number,
): GenerationResult {
  return {
    resultId: randomUUID(),
    type,
    status: 'completed',
    content,
    confidenceScore,
    reviewRecommended: confidenceScore < 0.7,
    metadata: {
      promptVersion: 0,
      promptTemplateId: 'default',
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cached: false,
      modelId: 'unknown',
      latencyMs: 0,
    },
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic for POST /intelligence/generate:
 * 1. Validate request body using Zod schema
 * 2. Extract tenantId from tenant context
 * 3. Check budget via tokenTracker.checkBudget — return 402 if over
 * 4. Route to the correct service based on request type
 * 5. Record token usage via tokenTracker.record
 * 6. Store result in DynamoDB with tenant-scoped PK
 * 7. Emit low-confidence event when confidenceScore < 0.5
 * 8. Return GenerationResult as HTTP 200
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // 1. Validate request body
  let body: unknown;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON in request body' },
      }),
    };
  }

  const parseResult = generateRequestSchema.safeParse(body);
  if (!parseResult.success) {
    const firstIssue = parseResult.error.issues[0];
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: firstIssue?.message ?? 'Request validation failed',
          field: firstIssue?.path.join('.'),
        },
      }),
    };
  }

  const request = parseResult.data;

  // 2. Extract tenantId
  const tenantId = extractTenantId(event as unknown as Record<string, unknown>);
  if (!tenantId) {
    logger.error('Missing tenant context — tenantContextMiddleware may not have run');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'MISSING_TENANT', message: 'Tenant context required' },
      }),
    };
  }

  // Append correlation IDs for structured logging (Requirement 11.4, 14.5)
  logger.appendKeys({ tenantId, generationType: request.type });

  // 3. Check budget
  const budgetCheck = await tokenTracker.checkBudget(tenantId);
  if (!budgetCheck.allowed) {
    logger.warn('Budget exceeded for tenant', { tenantId, remaining: budgetCheck.remaining });
    return {
      statusCode: 402,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'BUDGET_EXCEEDED', message: 'Monthly token budget exceeded' },
      }),
    };
  }

  // 4. Route to the correct service
  let result: GenerationResult;
  try {
    result = await routeToService(request);
  } catch (error) {
    logger.error('Generation failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      type: request.type,
    });

    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'GENERATION_FAILED', message: 'Content generation failed' },
      }),
    };
  }

  // Append resultId for all subsequent log entries (Requirement 11.4)
  logger.appendKeys({ resultId: result.resultId });

  // 5. Record token usage
  if (result.metadata.tokenUsage.inputTokens > 0 || result.metadata.tokenUsage.outputTokens > 0) {
    try {
      await tokenTracker.record({
        tenantId,
        generationType: result.type,
        inputTokens: result.metadata.tokenUsage.inputTokens,
        outputTokens: result.metadata.tokenUsage.outputTokens,
        modelId: result.metadata.modelId,
        timestamp: result.createdAt,
      });
    } catch (error) {
      // Token recording failure should not block the response
      logger.error('Failed to record token usage', {
        error: error instanceof Error ? error.message : String(error),
        tenantId,
      });
    }
  }

  // 6. Store result in DynamoDB
  try {
    await storeResult(tenantId, result);
  } catch (error) {
    // Storage failure should not block the response
    logger.error('Failed to store generation result', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
      resultId: result.resultId,
    });
  }

  // 7. Emit low-confidence event when score < 0.5
  if (result.confidenceScore < LOW_CONFIDENCE_THRESHOLD) {
    try {
      await emitLowConfidenceEvent(tenantId, result.resultId, result.type, result.confidenceScore);
    } catch (error) {
      // Event emission failure should not block the response
      logger.error('Failed to emit low-confidence event', {
        error: error instanceof Error ? error.message : String(error),
        tenantId,
        resultId: result.resultId,
      });
    }
  }

  // 8. Return GenerationResult
  logger.info('Generation completed', {
    tenantId,
    resultId: result.resultId,
    type: result.type,
    confidenceScore: result.confidenceScore,
    cached: result.metadata.cached,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(tenantContextMiddleware())
  .use(
    rbacMiddleware({
      resource: 'intelligence',
      action: 'write',
    }),
  )
  .use(
    rateLimitMiddleware({
      maxRequests: 60,
      windowSeconds: 60,
    }),
  );
