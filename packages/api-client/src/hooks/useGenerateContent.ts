'use client';

import { useMutation, UseMutationResult } from '@tanstack/react-query';
import type { ApiError } from '../errors';
import { useIntelligenceClient } from '../context';

// ─── Frontend contract types for the Product Intelligence API ────────────────
//
// These mirror the request/response shape of POST /intelligence/generate in the
// deployed Product Intelligence Engine. They are declared here (not imported
// from the service package) because the api-client package is the frontend
// contract boundary and must not depend on backend service code.

/** Generation operations supported by the engine. */
export type GenerationType =
  | 'title'
  | 'description'
  | 'bullets'
  | 'seo'
  | 'category'
  | 'brand'
  | 'attributes'
  | 'keywords'
  | 'compliance';

/** Target marketplace for platform-specific generation rules. */
export type GenerationMarketplaceId =
  | 'takealot'
  | 'makro'
  | 'amazon'
  | 'shopify'
  | 'woocommerce';

/** Product context the engine uses to generate content. */
export interface GenerationProductData {
  name?: string;
  description?: string;
  category?: string;
  brand?: string;
  attributes?: Record<string, string>;
  images?: string[];
  price?: { amount: number; currency: string };
  existingContent?: string;
}

/** Request body for POST /intelligence/generate. */
export interface GenerateContentPayload {
  type: GenerationType;
  productData: GenerationProductData;
  marketplace?: GenerationMarketplaceId;
  options?: Record<string, unknown>;
}

/**
 * Result envelope returned by the engine. `content` is a discriminated union on
 * `type` in the backend; the frontend treats it as an opaque record here and
 * narrows at the call site where a specific generation type is requested.
 */
export interface GenerationResult {
  resultId: string;
  type: GenerationType;
  status: 'completed' | 'failed';
  content: Record<string, unknown>;
  confidenceScore: number;
  reviewRecommended: boolean;
  metadata: {
    promptVersion: number;
    promptTemplateId: string;
    tokenUsage: { inputTokens: number; outputTokens: number };
    cached: boolean;
    modelId: string;
    latencyMs: number;
    marketplace?: GenerationMarketplaceId;
    marketplaceCompliance?: 'compliant' | 'warnings' | 'non_compliant';
  };
  error?: { code: string; message: string };
  createdAt: string;
}

/**
 * Distinct error code surfaced when the tenant's generation budget is exhausted
 * (the engine returns HTTP 402 BUDGET_EXCEEDED). Call sites can switch on this
 * to show a "generation limit reached" message instead of a generic failure.
 */
export const GENERATION_LIMIT_REACHED = 'GENERATION_LIMIT_REACHED' as const;

/**
 * Mutation to request AI content generation for a product.
 *
 * Targets the Product Intelligence API (separate base URL) via
 * useIntelligenceClient(). On an HTTP 402 budget-exceeded response, rejects with
 * an ApiError whose `code` is GENERATION_LIMIT_REACHED so the UI can present a
 * clear limit message (Requirement 2.3). The seller's Cognito JWT is attached by
 * the client's request interceptor (Requirement 2.4).
 */
export function useGenerateContent(): UseMutationResult<
  GenerationResult,
  ApiError,
  GenerateContentPayload
> {
  const client = useIntelligenceClient();

  return useMutation<GenerationResult, ApiError, GenerateContentPayload>({
    mutationFn: async (payload) => {
      try {
        const response = await client.post<GenerationResult>(
          '/intelligence/generate',
          payload
        );
        return response.data;
      } catch (err) {
        // The client interceptor already normalizes to ApiError. Re-map the
        // engine's 402 budget response to a stable, user-switchable code.
        const apiErr = err as ApiError;
        if (apiErr?.statusCode === 402) {
          const mapped: ApiError = {
            statusCode: 402,
            message:
              'You have reached your content generation limit for this billing period.',
            requestId: apiErr.requestId ?? '',
            code: GENERATION_LIMIT_REACHED,
          };
          throw mapped;
        }
        throw apiErr;
      }
    },
  });
}
