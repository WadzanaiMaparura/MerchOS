/**
 * Batch Generation Lambda handler for POST /intelligence/batch.
 *
 * Processes multiple generation requests concurrently up to a configured
 * concurrency limit (default 5). Checks budget before each item and stops
 * remaining processing if the tenant's budget is exceeded.
 *
 * Returns a BatchGenerationResult containing individual results and an
 * aggregate summary (total, succeeded, failed, totalTokens).
 *
 * Requirements: 15.5, 16.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';

import { rbacMiddleware } from '../../shared/middleware/rbac';
import { tenantContextMiddleware } from '../../shared/middleware/tenant-context';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger, tracer } from '../../shared/middleware/powertools';

import { randomUUID } from 'crypto';

import { batchGenerationRequestSchema } from '../schemas/batch.schema';
import type {
  GenerationRequest,
  GenerationResult,
  GeneratedContent,
  BatchGenerationResult,
  GenerationType,
} from '../types/generation.types';
import { tokenTracker } from '../services/token-tracker';
import { contentGenerator } from '../services/content-generator';
import { seoOptimizer } from '../services/seo-optimizer';
import { categoryPredictor } from '../services/category-predictor';
import { brandDetector } from '../services/brand-detector';
import { attributeExtractor } from '../services/attribute-extractor';
import { keywordGenerator } from '../services/keyword-generator';
import { complianceValidator } from '../services/compliance-validator';
import { shouldRecommendReview } from '../services/confidence-scorer';

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
 * Routes a single generation request to the appropriate service and returns
 * a standardized GenerationResult.
 *
 * For title/description/bullets: delegates to ContentGenerator which returns GenerationResult directly.
 * For other types: invokes the specialized service and wraps the result into GenerationResult format.
 *
 * @param request - The generation request to process
 * @returns A GenerationResult from the appropriate service
 */
async function routeToService(request: GenerationRequest): Promise<GenerationResult> {
  const startTime = Date.now();

  switch (request.type) {
    case 'title':
      return contentGenerator.generateTitle({
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        ...(request.options ? { attributes: request.options as Record<string, string> } : {}),
      });

    case 'description':
      return contentGenerator.generateDescription({
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        ...(request.options?.['tone'] ? { tone: request.options['tone'] as 'professional' | 'casual' | 'luxury' } : {}),
        ...(request.options?.['wordCountRange'] ? { wordCountRange: request.options['wordCountRange'] as { min: number; max: number } } : {}),
      });

    case 'bullets':
      return contentGenerator.generateBullets({
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        ...(request.options?.['count'] != null ? { count: request.options['count'] as number } : {}),
        ...(request.options?.['attributes'] ? { attributes: request.options['attributes'] as Record<string, string> } : {}),
      });

    case 'seo': {
      const seoResult = await seoOptimizer.analyze({
        content: request.productData.existingContent ?? request.productData.description ?? '',
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
      });
      return wrapServiceResult(request.type, { type: 'seo', analysis: seoResult }, seoResult.confidenceScore, startTime);
    }

    case 'category': {
      const catResult = await categoryPredictor.predict({
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
      });
      // Use the top prediction's confidence or a default
      const catConfidence = catResult.predictions[0]?.confidenceScore ?? 0;
      return wrapServiceResult(request.type, { type: 'category', predictions: catResult }, catConfidence, startTime);
    }

    case 'brand': {
      const brandResult = await brandDetector.detect({
        text: request.productData.description ?? request.productData.name ?? '',
        productData: request.productData,
        ...(request.options?.['brandRegistry'] ? { brandRegistry: request.options['brandRegistry'] as string[] } : {}),
      });
      const brandConfidence = brandResult.brands[0]?.confidenceScore ?? 0;
      return wrapServiceResult(request.type, { type: 'brand', detection: brandResult }, brandConfidence, startTime);
    }

    case 'attributes': {
      const attrResult = await attributeExtractor.extract({
        text: request.productData.description ?? request.productData.name ?? '',
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
      });
      const attrConfidence = attrResult.attributes.length > 0
        ? attrResult.attributes.reduce((sum, a) => sum + a.confidenceScore, 0) / attrResult.attributes.length
        : 0;
      return wrapServiceResult(request.type, { type: 'attributes', extraction: attrResult }, attrConfidence, startTime);
    }

    case 'keywords': {
      const kwResult = await keywordGenerator.generate({
        productData: request.productData,
        ...(request.marketplace ? { marketplace: request.marketplace } : {}),
        ...(request.options?.['competitorKeywords'] ? { competitorKeywords: request.options['competitorKeywords'] as string[] } : {}),
        ...(request.options?.['count'] != null ? { count: request.options['count'] as number } : {}),
      });
      return wrapServiceResult(request.type, { type: 'keywords', keywords: kwResult }, kwResult.overallQualityScore, startTime);
    }

    case 'compliance': {
      const compResult = await complianceValidator.validate({
        content: request.productData.existingContent ?? request.productData.description ?? '',
        marketplace: request.marketplace ?? 'amazon',
        ...(request.productData ? { productData: request.productData } : {}),
      });
      return wrapServiceResult(request.type, { type: 'compliance', validation: compResult }, compResult.complianceScore, startTime);
    }

    default: {
      const _exhaustive: never = request.type;
      throw new Error(`Unsupported generation type: ${_exhaustive}`);
    }
  }
}

/**
 * Wraps a service-specific result into a standardized GenerationResult.
 *
 * @param generationType - The generation type
 * @param content - The generated content payload
 * @param confidenceScore - The confidence score from the service
 * @param startTime - The request start time for latency calculation
 * @returns A standardized GenerationResult
 */
function wrapServiceResult(
  generationType: GenerationType,
  content: GeneratedContent,
  confidenceScore: number,
  startTime: number,
): GenerationResult {
  const latencyMs = Date.now() - startTime;
  const clampedScore = Math.min(1, Math.max(0, confidenceScore));

  return {
    resultId: randomUUID(),
    type: generationType,
    status: 'completed',
    content,
    confidenceScore: clampedScore,
    reviewRecommended: shouldRecommendReview(clampedScore),
    metadata: {
      promptVersion: 0,
      promptTemplateId: 'service-direct',
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      cached: false,
      modelId: 'bedrock-via-service',
      latencyMs,
    },
    createdAt: new Date().toISOString(),
  };
}

/**
 * Processes items in batches of the given concurrency limit.
 * Checks budget before each item and stops remaining processing on budget exceeded.
 *
 * @param items - The generation request items to process
 * @param tenantId - The tenant identifier for budget checks
 * @param concurrencyLimit - Max concurrent items to process at once
 * @returns An array of GenerationResults (one per item, including failures)
 */
async function processItemsConcurrently(
  items: GenerationRequest[],
  tenantId: string,
  concurrencyLimit: number,
): Promise<GenerationResult[]> {
  const results: GenerationResult[] = [];
  let budgetExceeded = false;

  // Process in batches of concurrencyLimit
  for (let i = 0; i < items.length; i += concurrencyLimit) {
    if (budgetExceeded) {
      // Stop processing remaining items — fill with budget exceeded errors
      for (let j = i; j < items.length; j++) {
        results.push({
          resultId: randomUUID(),
          type: items[j]!.type,
          status: 'failed',
          content: { type: 'title', title: '' },
          confidenceScore: 0,
          reviewRecommended: false,
          metadata: {
            promptVersion: 0,
            promptTemplateId: 'unknown',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            cached: false,
            modelId: 'unknown',
            latencyMs: 0,
          },
          error: {
            code: 'BUDGET_EXCEEDED',
            message: 'Monthly token budget exceeded. Remaining items were not processed.',
          },
          createdAt: new Date().toISOString(),
        });
      }
      break;
    }

    const batch = items.slice(i, i + concurrencyLimit);

    const batchResults = await Promise.allSettled(
      batch.map(async (item) => {
        // Check budget before processing each item
        const budgetCheck = await tokenTracker.checkBudget(tenantId);
        if (!budgetCheck.allowed) {
          budgetExceeded = true;
          const failedResult: GenerationResult = {
            resultId: randomUUID(),
            type: item.type,
            status: 'failed',
            content: { type: 'title', title: '' },
            confidenceScore: 0,
            reviewRecommended: false,
            metadata: {
              promptVersion: 0,
              promptTemplateId: 'unknown',
              tokenUsage: { inputTokens: 0, outputTokens: 0 },
              cached: false,
              modelId: 'unknown',
              latencyMs: 0,
            },
            error: {
              code: 'BUDGET_EXCEEDED',
              message: 'Monthly token budget exceeded.',
            },
            createdAt: new Date().toISOString(),
          };
          return failedResult;
        }

        // Route to appropriate service
        const result = await routeToService(item);

        // Record token usage after generation
        if (result.status === 'completed') {
          await tokenTracker.record({
            tenantId,
            generationType: result.type,
            inputTokens: result.metadata.tokenUsage.inputTokens,
            outputTokens: result.metadata.tokenUsage.outputTokens,
            modelId: result.metadata.modelId,
            timestamp: result.createdAt,
          });
        }

        return result;
      }),
    );

    // Collect results from the settled promises
    for (const settled of batchResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        // Promise was rejected — create a failed result
        const errorMessage =
          settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        results.push({
          resultId: randomUUID(),
          type: 'title', // Default type for unresolved errors
          status: 'failed',
          content: { type: 'title', title: '' },
          confidenceScore: 0,
          reviewRecommended: false,
          metadata: {
            promptVersion: 0,
            promptTemplateId: 'unknown',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            cached: false,
            modelId: 'unknown',
            latencyMs: 0,
          },
          error: {
            code: 'GENERATION_FAILED',
            message: errorMessage,
          },
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core handler logic for batch generation:
 * 1. Validate request body against batchGenerationRequestSchema
 * 2. Extract tenantId from tenant context
 * 3. Process items concurrently up to concurrencyLimit
 * 4. Check budget before each item, stop on budget exceeded
 * 5. Aggregate results with summary (total, succeeded, failed, totalTokens)
 * 6. Return BatchGenerationResult
 */
async function baseHandler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // Parse and validate request body
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

  const validation = batchGenerationRequestSchema.safeParse(body);
  if (!validation.success) {
    const firstError = validation.error.errors[0];
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: {
          code: 'VALIDATION_ERROR',
          message: firstError?.message ?? 'Invalid request body',
          field: firstError?.path?.join('.'),
        },
      }),
    };
  }

  const { items, concurrencyLimit } = validation.data;

  // Extract tenant context
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
  logger.appendKeys({ tenantId, generationType: 'batch' });

  logger.info('Batch generation request received', {
    tenantId,
    itemCount: items.length,
    concurrencyLimit,
  });

  try {
    // Process all items concurrently with budget checks
    const results = await processItemsConcurrently(
      items as GenerationRequest[],
      tenantId,
      concurrencyLimit,
    );

    // Aggregate summary
    const summary = {
      total: results.length,
      succeeded: results.filter((r) => r.status === 'completed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      totalTokens: results.reduce(
        (sum, r) =>
          sum + r.metadata.tokenUsage.inputTokens + r.metadata.tokenUsage.outputTokens,
        0,
      ),
    };

    const batchResult: BatchGenerationResult = {
      results,
      summary,
    };

    logger.info('Batch generation completed', {
      tenantId,
      ...summary,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batchResult),
    };
  } catch (error) {
    logger.error('Batch generation failed', {
      error: error instanceof Error ? error.message : String(error),
      tenantId,
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      }),
    };
  }
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
