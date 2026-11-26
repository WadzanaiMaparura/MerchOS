/**
 * Runs one bench case through the same five steps a seller's "Write my
 * listing" runs (services/product synthesize: title, description, bullets,
 * attributes, category), with the same services, models and active prompts.
 *
 * Differences from production, on purpose:
 *   - no response cache: every run writes fresh, so prompt or model changes show
 *   - no token budget, rate limit or trial gate (those are not about quality)
 *   - results are not stored for any seller
 */

import { attributeExtractor } from '../services/attribute-extractor';
import { categoryPredictor } from '../services/category-predictor';
import { ContentGenerator } from '../services/content-generator';
import { ResponseCache } from '../services/response-cache';
import type { GenerationResult, MarketplaceId, ProductData } from '../types/generation.types';
import type { BenchOutput } from './types';

/** Never returns a cached listing and never stores one. */
class NoCache extends ResponseCache {
  override async get(): Promise<GenerationResult | null> {
    return null;
  }
  override async set(): Promise<void> {
    return undefined;
  }
}

const writer = new ContentGenerator({ responseCache: new NoCache() });

const message = (e: unknown) =>
  (e as { message?: string })?.message ?? (e as { code?: string })?.code ?? String(e);

export async function runPipeline(caseId: string, productData: ProductData, marketplace: MarketplaceId): Promise<BenchOutput> {
  const started = Date.now();
  const out: BenchOutput = { caseId, productData, errors: [], modelIds: [], latencyMs: 0 };
  const content = (r: GenerationResult, step: string) => {
    if (r.status !== 'completed') {
      out.errors.push({ step, message: r.error?.message ?? 'failed' });
      return null;
    }
    if (r.metadata.modelId && !out.modelIds.includes(r.metadata.modelId)) out.modelIds.push(r.metadata.modelId);
    return r.content;
  };

  // In parallel, like production.
  await Promise.all([
    writer
      .generateTitle({ productData, marketplace })
      .then((r) => {
        const c = content(r, 'Title');
        if (c?.type === 'title') out.title = c.title;
      })
      .catch((e) => out.errors.push({ step: 'Title', message: message(e) })),
    writer
      .generateDescription({ productData, marketplace })
      .then((r) => {
        const c = content(r, 'Description');
        if (c?.type === 'description') out.description = c.description;
      })
      .catch((e) => out.errors.push({ step: 'Description', message: message(e) })),
    writer
      .generateBullets({ productData, marketplace })
      .then((r) => {
        const c = content(r, 'Bullets');
        if (c?.type === 'bullets') out.bullets = c.bullets;
      })
      .catch((e) => out.errors.push({ step: 'Bullets', message: message(e) })),
    attributeExtractor
      .extract({ text: productData.existingContent ?? productData.description ?? '', productData, marketplace })
      .then((r) => {
        out.attributes = r.attributes.map((a) => ({ key: a.key, value: a.normalizedValue ?? a.value, confidence: a.confidenceScore }));
      })
      .catch((e) => out.errors.push({ step: 'Attributes', message: message(e) })),
    categoryPredictor
      .predict({ productData, marketplace })
      .then((r) => {
        out.categories = r.predictions.map((p) => ({ path: p.categoryPath, confidence: p.confidenceScore }));
      })
      .catch((e) => out.errors.push({ step: 'Category', message: message(e) })),
  ]);

  out.latencyMs = Date.now() - started;
  return out;
}
