import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CanonicalProduct } from '@merch-os/types';
import { ProductService } from '../product-service';
import { ProductRepository } from '../../repository/product-repository';
import type { ProductEnrichmentRecord } from '../../repository/types';
import { ProductNotFoundError, ProductValidationError, InvalidProductLifecycleError } from '../errors';

const TENANT = 'tenant-1';
const PRODUCT = 'prod-1';

function makeProduct(): CanonicalProduct {
  return {
    productId: PRODUCT,
    tenantId: TENANT,
    content: {
      title: 'T', shortDescription: null, longDescription: null, bulletPoints: [],
      brand: 'B', manufacturer: null, sku: 'S', barcode: null, mpn: null,
      weight: null, weightUnit: null, length: null, width: null, height: null,
      dimensionUnit: null, materials: [], attributes: {}, imageRefs: [], variants: [],
    },
    commercial: {
      sellingPrice: null, rrp: null, salePrice: null, currency: 'ZAR', stockQuantity: 0,
      lowStockThreshold: null, fulfilmentMethod: null, leadtimeDays: null, handlingTimeDays: null,
      listingStatus: 'draft', saleStartDate: null, saleEndDate: null,
    },
    platformSpecific: { platformIdentifiers: {}, categoryMappings: {}, metadata: {}, exportHistory: {} },
    lifecycleState: 'draft',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  };
}

function makeEnrichment(overrides?: Partial<ProductEnrichmentRecord>): ProductEnrichmentRecord {
  return {
    uiLifecycleState: 'REVIEW',
    enrichment: {
      attributes: {
        title: { value: 'AI Title', confidence: 0.5, source: 'bedrock', flaggedForReview: true },
        category: { value: 'node-1', confidence: 0.9, source: 'bedrock', flaggedForReview: true },
      },
      channelContent: {},
      detectedLanguage: 'en',
      enrichedAt: '2026-11-02T00:00:00Z',
    },
    lifecycleHistory: [],
    updatedAt: '2026-11-02T00:00:00Z',
    ...overrides,
  };
}

function createMockRepo() {
  return {
    get: vi.fn(),
    getEnrichment: vi.fn(),
    putEnrichment: vi.fn().mockImplementation((_t, _p, rec) => Promise.resolve({ ...rec, updatedAt: 'now' })),
    appendLifecycleTransition: vi.fn().mockImplementation((_t, _p, _tr, ui) => Promise.resolve({ uiLifecycleState: ui })),
    update: vi.fn().mockImplementation((_t, _p, prod) => Promise.resolve(prod)),
  } as unknown as ProductRepository & Record<string, ReturnType<typeof vi.fn>>;
}

let repo: ReturnType<typeof createMockRepo>;
let service: ProductService;

beforeEach(() => {
  repo = createMockRepo();
  service = new ProductService(repo);
});

describe('approveAttribute', () => {
  it('clears the review flag and records approver', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment());

    await service.approveAttribute(TENANT, PRODUCT, 'title', 'user-1');

    const written = repo.putEnrichment.mock.calls[0][2] as ProductEnrichmentRecord;
    expect(written.enrichment.attributes.title.flaggedForReview).toBe(false);
    expect(written.enrichment.attributes.title.approvedBy).toBe('user-1');
  });

  it('throws ProductValidationError for an unknown attribute', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment());
    await expect(service.approveAttribute(TENANT, PRODUCT, 'nope', 'user-1')).rejects.toBeInstanceOf(
      ProductValidationError
    );
  });

  it('throws ProductNotFoundError when the product is gone', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.approveAttribute(TENANT, PRODUCT, 'title', 'user-1')).rejects.toBeInstanceOf(
      ProductNotFoundError
    );
  });
});

describe('overrideAttribute', () => {
  it('sets value, source manual, clears flag, and writes title through to content', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment());

    await service.overrideAttribute(TENANT, PRODUCT, 'title', 'Seller Title', 'user-1');

    const updatedProduct = repo.update.mock.calls[0][2] as CanonicalProduct;
    expect(updatedProduct.content.title).toBe('Seller Title');

    const written = repo.putEnrichment.mock.calls[0][2] as ProductEnrichmentRecord;
    expect(written.enrichment.attributes.title.value).toBe('Seller Title');
    expect(written.enrichment.attributes.title.source).toBe('manual');
    expect(written.enrichment.attributes.title.flaggedForReview).toBe(false);
  });

  it('writes a non-top-level field into content.attributes', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment());

    await service.overrideAttribute(TENANT, PRODUCT, 'colour', 'blue', 'user-1');

    const updatedProduct = repo.update.mock.calls[0][2] as CanonicalProduct;
    expect(updatedProduct.content.attributes['colour']).toBe('blue');
  });
});

describe('confirmCategory', () => {
  it('sets the category node, clears its flag, records approver', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment());

    await service.confirmCategory(TENANT, PRODUCT, 'node-confirmed', 'user-1');

    const written = repo.putEnrichment.mock.calls[0][2] as ProductEnrichmentRecord;
    expect(written.enrichment.attributes.category.value).toBe('node-confirmed');
    expect(written.enrichment.attributes.category.flaggedForReview).toBe(false);
    expect(written.enrichment.attributes.category.source).toBe('manual');
  });
});

describe('transitionLifecycle', () => {
  it('allows REVIEW → EXPORT_READY when all flags cleared and category confirmed', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(
      makeEnrichment({
        enrichment: {
          attributes: {
            title: { value: 'T', confidence: 1, source: 'manual', flaggedForReview: false },
            category: { value: 'node-1', confidence: 1, source: 'manual', flaggedForReview: false },
          },
          channelContent: {},
          detectedLanguage: 'en',
          enrichedAt: '2026-11-02T00:00:00Z',
        },
      })
    );

    await service.transitionLifecycle(TENANT, PRODUCT, 'EXPORT_READY', 'user-1');

    expect(repo.appendLifecycleTransition).toHaveBeenCalledWith(
      TENANT,
      PRODUCT,
      expect.objectContaining({ fromState: 'REVIEW', toState: 'EXPORT_READY' }),
      'EXPORT_READY'
    );
  });

  it('blocks EXPORT_READY when a field is still flagged for review', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment()); // title + category flagged

    await expect(
      service.transitionLifecycle(TENANT, PRODUCT, 'EXPORT_READY', 'user-1')
    ).rejects.toBeInstanceOf(InvalidProductLifecycleError);
    expect(repo.appendLifecycleTransition).not.toHaveBeenCalled();
  });

  it('blocks EXPORT_READY when category is not confirmed', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(
      makeEnrichment({
        enrichment: {
          attributes: {
            title: { value: 'T', confidence: 1, source: 'manual', flaggedForReview: false },
            // no category attribute at all
          },
          channelContent: {},
          detectedLanguage: 'en',
          enrichedAt: '2026-11-02T00:00:00Z',
        },
      })
    );

    await expect(
      service.transitionLifecycle(TENANT, PRODUCT, 'EXPORT_READY', 'user-1')
    ).rejects.toThrow(/category not confirmed/i);
  });

  it('rejects a structurally invalid transition (REVIEW → PUBLISHED)', async () => {
    repo.get.mockResolvedValue(makeProduct());
    repo.getEnrichment.mockResolvedValue(makeEnrichment());

    await expect(
      service.transitionLifecycle(TENANT, PRODUCT, 'PUBLISHED', 'user-1')
    ).rejects.toBeInstanceOf(InvalidProductLifecycleError);
  });
});
