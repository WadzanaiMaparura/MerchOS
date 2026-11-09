import { describe, it, expect } from 'vitest';
import type { CanonicalContentData, EnrichmentLayer } from '@merch-os/types';
import {
  applySynthesis,
  DEFAULT_REVIEW_THRESHOLD,
  type GlueGenerationResult,
} from '../synthesis-glue';

function baseContent(overrides?: Partial<CanonicalContentData>): CanonicalContentData {
  return {
    title: 'Old title',
    shortDescription: null,
    longDescription: null,
    bulletPoints: [],
    brand: 'OldBrand',
    manufacturer: null,
    sku: 'SKU-1',
    barcode: null,
    mpn: null,
    weight: null,
    weightUnit: null,
    length: null,
    width: null,
    height: null,
    dimensionUnit: null,
    materials: [],
    attributes: {},
    imageRefs: [],
    variants: [],
    ...overrides,
  };
}

function emptyEnrichment(): EnrichmentLayer {
  return { attributes: {}, channelContent: {}, detectedLanguage: '', enrichedAt: '' };
}

describe('applySynthesis: title', () => {
  it('writes content.title and a high-confidence (unflagged) attribute', () => {
    const results: GlueGenerationResult[] = [
      { type: 'title', status: 'completed', confidenceScore: 0.95, content: { type: 'title', title: 'New AI Title' } },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.content.title).toBe('New AI Title');
    expect(out.enrichment.attributes.title?.value).toBe('New AI Title');
    expect(out.enrichment.attributes.title?.flaggedForReview).toBe(false);
    expect(out.enrichment.attributes.title?.source).toBe('bedrock');
  });

  it('flags a low-confidence title for review', () => {
    const results: GlueGenerationResult[] = [
      { type: 'title', status: 'completed', confidenceScore: 0.5, content: { type: 'title', title: 'Shaky Title' } },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.enrichment.attributes.title?.flaggedForReview).toBe(true);
  });
});

describe('applySynthesis: description + bullets', () => {
  it('maps description to longDescription', () => {
    const results: GlueGenerationResult[] = [
      { type: 'description', status: 'completed', confidenceScore: 0.8, content: { type: 'description', description: 'A long description', truncated: false } },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.content.longDescription).toBe('A long description');
    expect(out.enrichment.attributes.description?.value).toBe('A long description');
  });

  it('maps bullets array to bulletPoints and a joined attribute', () => {
    const results: GlueGenerationResult[] = [
      { type: 'bullets', status: 'completed', confidenceScore: 0.9, content: { type: 'bullets', bullets: ['One', 'Two'] } },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.content.bulletPoints).toEqual(['One', 'Two']);
    expect(out.enrichment.attributes.bullets?.value).toBe('One | Two');
  });
});

describe('applySynthesis: brand', () => {
  it('uses the primary detected brand and its own confidence', () => {
    const results: GlueGenerationResult[] = [
      {
        type: 'brand',
        status: 'completed',
        confidenceScore: 0.6,
        content: { type: 'brand', detection: { brands: [{ name: 'JumpMaster', confidenceScore: 0.99 }], unidentified: false } },
      },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.content.brand).toBe('JumpMaster');
    expect(out.enrichment.attributes.brand?.confidence).toBe(0.99);
    expect(out.enrichment.attributes.brand?.flaggedForReview).toBe(false);
  });
});

describe('applySynthesis: attributes', () => {
  it('merges extracted attributes into content and enrichment, preferring normalizedValue', () => {
    const results: GlueGenerationResult[] = [
      {
        type: 'attributes',
        status: 'completed',
        confidenceScore: 0.8,
        content: {
          type: 'attributes',
          extraction: {
            attributes: [
              { key: 'colour', value: 'Blue', normalizedValue: 'blue', confidenceScore: 0.9 },
              { key: 'size', value: '10ft', confidenceScore: 0.4 },
            ],
          },
        },
      },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.content.attributes['colour']).toBe('blue');
    expect(out.content.attributes['size']).toBe('10ft');
    expect(out.enrichment.attributes.colour?.flaggedForReview).toBe(false);
    expect(out.enrichment.attributes.size?.flaggedForReview).toBe(true);
  });
});

describe('applySynthesis: category', () => {
  it('records the top category prediction and always flags it for review', () => {
    const results: GlueGenerationResult[] = [
      {
        type: 'category',
        status: 'completed',
        confidenceScore: 0.99,
        content: { type: 'category', predictions: { predictions: [{ categoryId: 'node-123', categoryPath: ['A'], confidenceScore: 0.99 }], manualReviewRecommended: false } },
      },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.enrichment.attributes.category?.value).toBe('node-123');
    // Category always requires seller confirmation regardless of confidence.
    expect(out.enrichment.attributes.category?.flaggedForReview).toBe(true);
  });
});

describe('applySynthesis: robustness', () => {
  it('skips failed results', () => {
    const results: GlueGenerationResult[] = [
      { type: 'title', status: 'failed', confidenceScore: 0, content: {} },
    ];
    const out = applySynthesis(baseContent({ title: 'Keep me' }), emptyEnrichment(), results);
    expect(out.content.title).toBe('Keep me');
    expect(out.enrichment.attributes.title).toBeUndefined();
  });

  it('ignores unknown generation types', () => {
    const results: GlueGenerationResult[] = [
      { type: 'mystery', status: 'completed', confidenceScore: 0.9, content: { foo: 'bar' } },
    ];
    const out = applySynthesis(baseContent(), emptyEnrichment(), results);
    expect(out.enrichment.attributes).toEqual({});
  });

  it('preserves existing enrichment attributes not overwritten', () => {
    const existing: EnrichmentLayer = {
      attributes: {
        colour: { value: 'red', confidence: 1, source: 'bedrock', flaggedForReview: false },
      },
      channelContent: {},
      detectedLanguage: 'en',
      enrichedAt: '2026-01-01T00:00:00Z',
    };
    const results: GlueGenerationResult[] = [
      { type: 'title', status: 'completed', confidenceScore: 0.9, content: { type: 'title', title: 'T' } },
    ];
    const out = applySynthesis(baseContent(), existing, results);
    expect(out.enrichment.attributes.colour?.value).toBe('red');
    expect(out.enrichment.attributes.title?.value).toBe('T');
  });

  it('uses the default review threshold constant', () => {
    expect(DEFAULT_REVIEW_THRESHOLD).toBe(0.7);
  });

  it('refreshes enrichedAt timestamp', () => {
    const out = applySynthesis(baseContent(), emptyEnrichment(), []);
    expect(out.enrichment.enrichedAt).not.toBe('');
  });
});
