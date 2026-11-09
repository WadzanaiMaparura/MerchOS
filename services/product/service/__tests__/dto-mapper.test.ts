import { describe, it, expect } from 'vitest';
import type {
  CanonicalProduct,
  LifecycleTransition,
} from '@merch-os/types';
import type { ProductEnrichmentRecord } from '../../repository/types';
import {
  assembleProductDto,
  assembleProductSummary,
  resolveUiLifecycleState,
} from '../dto-mapper';

function makeProduct(overrides?: Partial<CanonicalProduct>): CanonicalProduct {
  return {
    productId: 'prod-001',
    tenantId: 'tenant-abc',
    content: {
      title: 'Trampoline 10ft',
      shortDescription: 'Short',
      longDescription: 'Long description here',
      bulletPoints: ['Durable'],
      brand: 'JumpMaster',
      manufacturer: null,
      sku: 'TRM-10FT',
      barcode: null,
      mpn: null,
      weight: null,
      weightUnit: null,
      length: null,
      width: null,
      height: null,
      dimensionUnit: null,
      materials: [],
      attributes: { colour: 'blue', pieces: 1, assembled: false },
      imageRefs: [
        {
          imageId: 'img-1',
          s3Key: 'images/tenant-abc/prod-001/source/img-1.jpg',
          position: 0,
          altText: null,
          mimeType: 'image/jpeg',
          width: 800,
          height: 800,
          fileSize: 1000,
        },
      ],
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
    lifecycleState: 'draft',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeEnrichment(
  overrides?: Partial<ProductEnrichmentRecord>
): ProductEnrichmentRecord {
  const transition: LifecycleTransition = {
    fromState: 'DRAFT',
    toState: 'GENERATING',
    transitionedAt: '2026-11-02T10:00:00.000Z',
    actor: 'user-1',
  };
  return {
    uiLifecycleState: 'REVIEW',
    enrichment: {
      attributes: {
        title: {
          value: 'AI Trampoline Title',
          confidence: 0.92,
          source: 'bedrock',
          flaggedForReview: false,
        },
        colour: {
          value: 'blue',
          confidence: 0.4,
          source: 'bedrock',
          flaggedForReview: true,
        },
      },
      channelContent: {},
      detectedLanguage: 'en',
      enrichedAt: '2026-11-02T10:05:00.000Z',
    },
    lifecycleHistory: [transition],
    updatedAt: '2026-11-02T10:05:00.000Z',
    ...overrides,
  };
}

describe('dto-mapper: resolveUiLifecycleState', () => {
  it('prefers the stored uiLifecycleState from enrichment', () => {
    const product = makeProduct({ lifecycleState: 'draft' });
    const enrichment = makeEnrichment({ uiLifecycleState: 'REVIEW' });
    expect(resolveUiLifecycleState(product, enrichment)).toBe('REVIEW');
  });

  it('falls back to mapping the canonical state when no enrichment', () => {
    const product = makeProduct({ lifecycleState: 'validated' });
    expect(resolveUiLifecycleState(product, null)).toBe('EXPORT_READY');
  });

  it('falls back when enrichment has no uiLifecycleState', () => {
    const product = makeProduct({ lifecycleState: 'draft' });
    const enrichment = makeEnrichment({
      uiLifecycleState: undefined as unknown as never,
    });
    expect(resolveUiLifecycleState(product, enrichment)).toBe('DRAFT');
  });
});

describe('dto-mapper: assembleProductDto', () => {
  it('stitches canonical content + enrichment into a Product DTO', () => {
    const product = makeProduct();
    const enrichment = makeEnrichment();
    const dto = assembleProductDto(product, enrichment);

    expect(dto.productId).toBe('prod-001');
    expect(dto.tenantId).toBe('tenant-abc');
    expect(dto.sku).toBe('TRM-10FT');
    expect(dto.title).toBe('Trampoline 10ft');
    expect(dto.description).toBe('Long description here');
    expect(dto.brand).toBe('JumpMaster');
    expect(dto.lifecycleState).toBe('REVIEW');
    expect(dto.lifecycleHistory).toHaveLength(1);
    expect(dto.enrichmentLayer.attributes.colour?.flaggedForReview).toBe(true);
    expect(dto.images).toHaveLength(1);
    expect(dto.images[0]?.isHero).toBe(true);
  });

  it('uses an empty enrichment layer when none exists', () => {
    const product = makeProduct();
    const dto = assembleProductDto(product, null);

    expect(dto.enrichmentLayer.attributes).toEqual({});
    expect(dto.lifecycleHistory).toEqual([]);
    expect(dto.lifecycleState).toBe('DRAFT'); // from canonical 'draft'
  });

  it('falls back description to shortDescription when longDescription is null', () => {
    const product = makeProduct({
      content: { ...makeProduct().content, longDescription: null },
    });
    const dto = assembleProductDto(product, null);
    expect(dto.description).toBe('Short');
  });
});

describe('dto-mapper: assembleProductSummary', () => {
  it('builds a summary with the precise UI lifecycle state and thumbnail', () => {
    const summary = assembleProductSummary(makeProduct(), makeEnrichment());
    expect(summary.productId).toBe('prod-001');
    expect(summary.sku).toBe('TRM-10FT');
    expect(summary.title).toBe('Trampoline 10ft');
    expect(summary.lifecycleState).toBe('REVIEW');
    expect(summary.thumbnailUrl).toBe(
      'images/tenant-abc/prod-001/source/img-1.jpg'
    );
  });

  it('uses canonical fallback and null thumbnail when no enrichment/images', () => {
    const product = makeProduct({
      content: { ...makeProduct().content, imageRefs: [] },
    });
    const summary = assembleProductSummary(product, null);
    expect(summary.thumbnailUrl).toBeNull();
    expect(summary.lifecycleState).toBe('DRAFT');
  });
});
