import { describe, it, expect, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CanonicalProduct } from '@merch-os/types';
import { getRawSchema } from '@merch-os/marketplace-schemas';
import {
  ValidationService,
  SchemaNotFoundError,
  type SchemaRegistryPort,
} from '../validation-service.js';
import { handler, setValidationService } from '../handlers/validate-product.js';

function product(overrides: Partial<CanonicalProduct['content']> = {}): CanonicalProduct {
  return {
    productId: 'prod-99',
    tenantId: 'tenant-1',
    content: {
      title: 'Test Eyewear',
      shortDescription: 'sub',
      longDescription: '<p>desc</p>',
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
      attributes: {
        eyewear_lens_type: 'Clear',
        whats_in_the_box: '1 x glasses',
        is_polarised: 'Yes',
        'merchant_packaged_dimensions.width': 10,
        'merchant_packaged_dimensions.length': 15,
        'merchant_packaged_dimensions.height': 5,
        'merchant_packaged_weight.value': 200,
        materials: 'Cellulose Acetate Butyrate',
        eyewear_type: 'Rectangle',
        'warranty.type': 'Limited',
        'warranty.period.value': 6,
      },
      imageRefs: [
        { imageId: 'i1', s3Key: 'k1', position: 0, altText: null, mimeType: 'image/jpeg', width: 1500, height: 1500, fileSize: 1, variantId: null },
        { imageId: 'i2', s3Key: 'k2', position: 1, altText: null, mimeType: 'image/jpeg', width: 1500, height: 1500, fileSize: 1, variantId: null },
      ],
      variants: [],
      ...overrides,
    },
    commercial: {
      sellingPrice: 199, rrp: 249, salePrice: null, currency: 'ZAR', stockQuantity: 5,
      lowStockThreshold: null, fulfilmentMethod: null, leadtimeDays: null, handlingTimeDays: null,
      listingStatus: 'draft', saleStartDate: null, saleEndDate: null,
    },
    platformSpecific: {
      platformIdentifiers: {},
      categoryMappings: { takealot: 'Accessories->Eyewear (29451)' },
      metadata: {}, exportHistory: {},
    },
    lifecycleState: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const evt = (body: unknown): APIGatewayProxyEventV2 =>
  ({ body: body == null ? undefined : JSON.stringify(body) }) as APIGatewayProxyEventV2;

describe('ValidationService with a stub registry', () => {
  it('resolves template by category node and validates', () => {
    const schema = getRawSchema('248')!;
    const stub: SchemaRegistryPort = {
      getByTemplateId: (id) => (id === '248' ? schema : null),
      findTemplateForNode: (node) => (node === '29451' ? '248' : null),
    };
    const svc = new ValidationService(stub);
    const result = svc.validate({ product: product(), topCategory: 'Women (29434)' });
    expect(result.exportAllowed).toBe(true);
    expect(result.targetPlatform).toBe('takealot');
  });

  it('throws SchemaNotFoundError when no template resolves', () => {
    const stub: SchemaRegistryPort = { getByTemplateId: () => null, findTemplateForNode: () => null };
    const svc = new ValidationService(stub);
    const p = product();
    p.platformSpecific.categoryMappings = {};
    expect(() => svc.validate({ product: p })).toThrow(SchemaNotFoundError);
  });
});

describe('validate-product handler', () => {
  beforeEach(() => {
    const schema = getRawSchema('248')!;
    setValidationService(
      new ValidationService({
        getByTemplateId: (id) => (id === '248' ? schema : null),
        findTemplateForNode: (node) => (node === '29451' ? '248' : null),
      })
    );
  });

  it('returns 200 with a result for a valid product', async () => {
    const res = (await handler(evt({ product: product(), topCategory: 'Women (29434)' }))) as {
      statusCode: number; body: string;
    };
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.result.exportAllowed).toBe(true);
    expect(parsed.result.errorCount).toBe(0);
  });

  it('returns 200 with exportAllowed=false for an invalid product', async () => {
    const res = (await handler(evt({ product: product({ title: '' }), topCategory: 'Women (29434)' }))) as {
      statusCode: number; body: string;
    };
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.result.exportAllowed).toBe(false);
    expect(parsed.result.errorCount).toBeGreaterThan(0);
  });

  it('returns 400 for a missing product', async () => {
    const res = (await handler(evt({}))) as { statusCode: number };
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for malformed JSON', async () => {
    const res = (await handler({ body: '{not json' } as APIGatewayProxyEventV2)) as { statusCode: number };
    expect(res.statusCode).toBe(400);
  });

  it('returns 422 when the schema cannot be resolved', async () => {
    const p = product();
    p.platformSpecific.categoryMappings = {};
    const res = (await handler(evt({ product: p }))) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('SCHEMA_NOT_FOUND');
  });
});
