/**
 * Synthesis glue — maps Product Intelligence Engine generation results onto the
 * canonical product content and the enrichment layer.
 *
 * The engine persists its own `GenerationResult`s keyed by resultId in a
 * separate table; it never touches the product. This module is the bridge: it
 * takes the results for a product and produces (a) updated canonical content and
 * (b) an updated EnrichmentLayer with per-field confidence, source, and
 * review-flagging. Pure and side-effect free — the caller persists the output.
 */

import type {
  CanonicalContentData,
  EnrichmentLayer,
  EnrichedAttribute,
} from '@merch-os/types';

/** Default confidence below which a field is flagged for seller review. */
export const DEFAULT_REVIEW_THRESHOLD = 0.7;

// ─── Minimal GenerationResult contract (mirrors the engine output) ───────────
//
// Declared locally so the product service does not depend on the
// product-intelligence service package. Only the fields the glue consumes are
// modelled; `content` is the engine's discriminated union on `type`.

export type GlueGenerationType =
  | 'title'
  | 'description'
  | 'bullets'
  | 'brand'
  | 'attributes'
  | 'category';

export interface GlueGenerationResult {
  type: string;
  status: 'completed' | 'failed';
  confidenceScore: number;
  content: Record<string, unknown>;
}

// ─── Result output ───────────────────────────────────────────────────────────

export interface AppliedSynthesis {
  /** Canonical content with generated fields merged in. */
  content: CanonicalContentData;
  /** Enrichment layer with per-field confidence/source/flag. */
  enrichment: EnrichmentLayer;
}

function makeAttribute(
  value: string | number | boolean,
  confidence: number,
  threshold: number
): EnrichedAttribute {
  return {
    value,
    confidence,
    source: 'bedrock',
    flaggedForReview: confidence < threshold,
  };
}

/**
 * Applies a set of generation results onto a product's content + enrichment.
 *
 * - `title` → content.title + enrichment.attributes.title
 * - `description` → content.longDescription + enrichment.attributes.description
 * - `bullets` → content.bulletPoints + enrichment.attributes.bullets (joined)
 * - `brand` → content.brand + enrichment.attributes.brand
 * - `attributes` → merged into content.attributes + per-key enrichment entries
 * - `category` → recorded in enrichment.attributes.category (top prediction);
 *   seller confirms the marketplace category in the review loop (Task 6)
 *
 * Failed results (status !== 'completed') are skipped. Unknown types are ignored
 * so new engine types never crash the glue.
 */
export function applySynthesis(
  baseContent: CanonicalContentData,
  baseEnrichment: EnrichmentLayer,
  results: GlueGenerationResult[],
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD
): AppliedSynthesis {
  const content: CanonicalContentData = {
    ...baseContent,
    attributes: { ...baseContent.attributes },
  };
  const attributes: Record<string, EnrichedAttribute> = {
    ...baseEnrichment.attributes,
  };

  for (const result of results) {
    if (result.status !== 'completed') continue;
    const c = result.content;
    const conf = result.confidenceScore;

    switch (result.type) {
      case 'title': {
        const title = c['title'];
        if (typeof title === 'string' && title.length > 0) {
          content.title = title;
          attributes.title = makeAttribute(title, conf, reviewThreshold);
        }
        break;
      }
      case 'description': {
        const desc = c['description'];
        if (typeof desc === 'string' && desc.length > 0) {
          content.longDescription = desc;
          attributes.description = makeAttribute(desc, conf, reviewThreshold);
        }
        break;
      }
      case 'bullets': {
        const bullets = c['bullets'];
        if (Array.isArray(bullets) && bullets.length > 0) {
          const list = bullets.filter((b): b is string => typeof b === 'string');
          content.bulletPoints = list;
          attributes.bullets = makeAttribute(list.join(' | '), conf, reviewThreshold);
        }
        break;
      }
      case 'brand': {
        // content.type === 'brand' → { detection: BrandDetectionResult }
        const detection = c['detection'] as
          | { brands?: Array<{ name?: string; confidenceScore?: number }> }
          | undefined;
        const primary = detection?.brands?.[0];
        if (primary?.name) {
          content.brand = primary.name;
          attributes.brand = makeAttribute(
            primary.name,
            primary.confidenceScore ?? conf,
            reviewThreshold
          );
        }
        break;
      }
      case 'attributes': {
        // content.type === 'attributes' → { extraction: AttributeExtractionResult }
        const extraction = c['extraction'] as
          | {
              attributes?: Array<{
                key?: string;
                value?: string;
                normalizedValue?: string;
                confidenceScore?: number;
              }>;
            }
          | undefined;
        for (const a of extraction?.attributes ?? []) {
          if (!a.key) continue;
          const value = a.normalizedValue ?? a.value ?? '';
          content.attributes[a.key] = value;
          attributes[a.key] = makeAttribute(
            value,
            a.confidenceScore ?? conf,
            reviewThreshold
          );
        }
        break;
      }
      case 'category': {
        // content.type === 'category' → { predictions: CategoryPredictionResult }
        const predictions = c['predictions'] as
          | { predictions?: Array<{ categoryId?: string; confidenceScore?: number }> }
          | undefined;
        const top = predictions?.predictions?.[0];
        if (top?.categoryId) {
          // Always flag category for seller confirmation in the review loop.
          attributes.category = {
            value: top.categoryId,
            confidence: top.confidenceScore ?? conf,
            source: 'bedrock',
            flaggedForReview: true,
          };
        }
        break;
      }
      default:
        // Unknown generation type — ignore (forward-compatible).
        break;
    }
  }

  const enrichment: EnrichmentLayer = {
    attributes,
    channelContent: baseEnrichment.channelContent ?? {},
    detectedLanguage: baseEnrichment.detectedLanguage || 'en',
    enrichedAt: new Date().toISOString(),
  };

  return { content, enrichment };
}
