import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { assertCanGenerate, isTrialError } from '../../shared/entitlements/trial-gate';
import type { GenerationResult, GenerationType } from '../types/generation.types';

/**
 * Free-trial gate for the intelligence API, shared by /generate and /batch.
 * (No-op unless TRIAL_ENFORCEMENT is on; see services/shared/entitlements.)
 */

/**
 * Checks the gate for one generation. Returns a ready-made 402 response when the
 * request is NOT allowed, or null when it may proceed. Unexpected errors (e.g.
 * DynamoDB down) are rethrown, never treated as "allowed".
 */
export async function trialGateResponse(
  tenantId: string,
  productId: string | undefined
): Promise<APIGatewayProxyResultV2 | null> {
  try {
    await assertCanGenerate(tenantId, productId);
    return null;
  } catch (error) {
    if (isTrialError(error)) {
      return {
        statusCode: 402,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { code: error.code, message: error.message } }),
      };
    }
    throw error;
  }
}

/** A failed batch item for something the gate refused (same shape as the budget failure). */
export function trialFailedResult(type: GenerationType, code: string, message: string): GenerationResult {
  return {
    resultId: randomUUID(),
    type,
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
    error: { code, message },
    createdAt: new Date().toISOString(),
  };
}
