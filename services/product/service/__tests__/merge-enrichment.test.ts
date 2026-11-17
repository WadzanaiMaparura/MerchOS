import { describe, it, expect } from 'vitest';
import type { CanonicalProduct } from '@merch-os/types';
import type { ProductEnrichmentRecord } from '../../repository/types';
import { mergeEnrichmentIntoCanonical } from '../dto-mapper';

function product(attributes: Record<string, string | number | boolean>): CanonicalProduct {
  return {
    productId: 'p1',
    tenantId: 't1',
    content: {
      title: 'Eyewear',
      shortDescription: null,
      longDescription: null,
      bulletPoints: [],
      brand: '',
      manufacturer: null,
      sku: '',
      barcode: null,
      mpn: null,
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      attributes,
      imageRefs: [],
      variants: [],
    },
    commercial: {
      sellingPrice: null,
      rrp: null,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 0,
      lowStockThreshold: null,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'draft',
      saleStartDate: null,
      saleEndDate: null,
    },
    platformSpecific: {
      platformIdentifiers: {},
      categoryMappings: {},
      metadata: {},
      exportHistory: {},
    },
    lifecycleState: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function enrichment(
  attrs: Record<string, { value: string | number | boolean }>
): ProductEnrichmentRecord {
  const attributes = Object.fromEntries(
    Object.entries(attrs).map(([k, v]) => [
      k,
      { value: v.value, confidence: 0.9, source: 'bedrock' as const, flaggedForReview: false },
    ])
  );
  return {
    uiLifecycleState: 'ENRICHED',
    enrichment: { attributes, channelContent: {}, detectedLanguage: 'en', enrichedAt: '' },
    lifecycleHistory: [],
    updatedAt: '',
  };
}

describe('mergeEnrichmentIntoCanonical', () => {
  it('returns the product unchanged when there is no enrichment', () => {
    const p = product({ materials: 'Acetate' });
    expect(mergeEnrichmentIntoCanonical(p, null)).toBe(p);
  });

  it('fills attributes that are absent in canonical content from enrichment', () => {
    const p = product({ materials: 'Acetate' });
    const e = enrichment({ is_polarised: { value: 'Yes' }, eyewear_type: { value: 'Rectangle' } });
    const merged = mergeEnrichmentIntoCanonical(p, e);
    expect(merged.content.attributes).toEqual({
      materials: 'Acetate',
      is_polarised: 'Yes',
      eyewear_type: 'Rectangle',
    });
  });

  it('canonical/manual values WIN over enrichment for the same key', () => {
    const p = product({ is_polarised: 'No' });
    const e = enrichment({ is_polarised: { value: 'Yes' } });
    const merged = mergeEnrichmentIntoCanonical(p, e);
    expect(merged.content.attributes['is_polarised']).toBe('No');
  });

  it('treats null/empty canonical values as absent (enrichment fills them)', () => {
    const p = product({ warranty_type: '' });
    const e = enrichment({ warranty_type: { value: 'Limited' } });
    const merged = mergeEnrichmentIntoCanonical(p, e);
    expect(merged.content.attributes['warranty_type']).toBe('Limited');
  });

  it('does not mutate the input product', () => {
    const p = product({ materials: 'Acetate' });
    const e = enrichment({ is_polarised: { value: 'Yes' } });
    mergeEnrichmentIntoCanonical(p, e);
    expect(p.content.attributes).toEqual({ materials: 'Acetate' });
  });

  it('preserves variants, platformSpecific, and commercial untouched', () => {
    const p = product({ a: '1' });
    const e = enrichment({ b: { value: '2' } });
    const merged = mergeEnrichmentIntoCanonical(p, e);
    expect(merged.commercial).toBe(p.commercial);
    expect(merged.platformSpecific).toBe(p.platformSpecific);
  });
});
