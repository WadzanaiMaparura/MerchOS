/**
 * Confidence Scorer service for the Product Intelligence Engine.
 *
 * Calculates a confidence score for AI-generated outputs based on a weighted
 * average of model probability, input completeness, and historical accuracy.
 * The score is always clamped to the [0.0, 1.0] range.
 *
 * @module confidence-scorer
 */

/**
 * Input parameters for confidence score calculation.
 */
export interface ConfidenceInput {
  /** Model output probability from Bedrock response (0-1) */
  modelProbability: number;
  /** Fraction of required input fields present (0-1) */
  inputCompleteness: number;
  /** Historical accuracy for this generation type (0-1) */
  historicalAccuracy: number;
}

/**
 * Weights used in the weighted average formula.
 * Sum to 1.0 to produce a normalized result.
 */
const WEIGHTS = {
  modelProbability: 0.5,
  inputCompleteness: 0.3,
  historicalAccuracy: 0.2,
} as const;

/**
 * Threshold below which a review is recommended.
 */
const REVIEW_THRESHOLD = 0.7;

/**
 * Calculates a confidence score as a weighted average of the input factors.
 *
 * Formula: score = (modelProbability * 0.5) + (inputCompleteness * 0.3) + (historicalAccuracy * 0.2)
 *
 * The result is clamped to [0.0, 1.0].
 *
 * Properties guaranteed:
 * - Output is always in [0.0, 1.0] for any valid inputs (Property 1)
 * - Higher inputCompleteness with constant other params produces equal or higher score (Property 2 — monotonic)
 * - Score < 0.7 means review is recommended (Property 3)
 *
 * @param params - The confidence calculation inputs
 * @returns A confidence score in [0.0, 1.0]
 */
export function calculate(params: ConfidenceInput): number {
  const { modelProbability, inputCompleteness, historicalAccuracy } = params;

  const rawScore =
    modelProbability * WEIGHTS.modelProbability +
    inputCompleteness * WEIGHTS.inputCompleteness +
    historicalAccuracy * WEIGHTS.historicalAccuracy;

  // Clamp to [0.0, 1.0]
  return Math.min(1.0, Math.max(0.0, rawScore));
}

/**
 * Determines whether a generation result should be flagged for manual review.
 *
 * @param confidenceScore - The calculated confidence score (0-1)
 * @returns true when the score is below the review threshold (0.7)
 */
export function shouldRecommendReview(confidenceScore: number): boolean {
  return confidenceScore < REVIEW_THRESHOLD;
}
