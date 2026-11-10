import { describe, it, expect, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getRawSchema, type RawTakealotSchema } from '@merch-os/marketplace-schemas';
import { ValidationService, type SchemaRegistryPort } from '@merch-os/validation';
import type { CanonicalProduct } from '@merch-os/types';
import { ExportService, ExportBlockedError } from '../export-service.js';
import { handler, setExportService } from '../handlers/generate-export.js';

function validProduct(id = 'prod-1'): CanonicalProduct {
  return {
    productId: id,
    tenantId: 'tenant-1',
    content: {
      title: 'Valid Eyewear',
      shortDescription: 'sub',
      longDescription: '<p>desc</p>',
      bulletPoints: [],
      brand: '',
      manufacturer: null,
      sku: 'SKU-' + id,
      barcode: null,
      mpn: null,
      weight: null, weightUnit: null, length: null, width: null, height: null, dimensionUnit: null,
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
    },
    commercial: {
      sellingPrice: 199, rrp: 249, salePrice: null, currency: 'ZAR', stockQuantity: 5,
      lowStockThreshold: null, fulfilmentMethod: null, leadtimeDays: 3, handlingTimeDays: null,
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

function invalidProduct(id = 'prod-bad'): CanonicalProduct {
  const p = validProduct(id);
  p.content.title = ''; // missing required title → validation ERROR
  return p;
}

let schema: RawTakealotSchema;
let stubRegistry: SchemaRegistryPort;

beforeEach(() => {
  schema = getRawSchema('248')!;
  stubRegistry = {
    getByTemplateId: (sid) => (sid === '248' ? schema : null),
    findTemplateForNode: (node) => (node === '29451' ? '248' : null),
  };
});

function makeService(): ExportService {
  return new ExportService(stubRegistry, new ValidationService(stubRegistry));
}

describe('ExportService validation gate', () => {
  it('exports products that pass validation', () => {
    const svc = makeService();
    const res = svc.export({
      products: [{ product: validProduct(), topCategory: 'Women (29434)' }],
      mode: 'full-create',
    });
    expect(res.validated.length).toBe(1);
    expect(res.excluded.length).toBe(0);
    expect(res.output.rowCount).toBe(1);
    expect(res.output.content).toContain('Valid Eyewear');
  });

  it('blocks the whole batch when any product fails and partial is false', () => {
    const svc = makeService();
    expect(() =>
      svc.export({
        products: [
          { product: validProduct('ok'), topCategory: 'Women (29434)' },
          { product: invalidProduct('bad'), topCategory: 'Women (29434)' },
        ],
        mode: 'full-create',
      })
    ).toThrow(ExportBlockedError);
  });

  it('partial batch exports only passing products and reports the excluded', () => {
    const svc = makeService();
    const res = svc.export({
      products: [
        { product: validProduct('ok'), topCategory: 'Women (29434)' },
        { product: invalidProduct('bad'), topCategory: 'Women (29434)' },
      ],
      mode: 'full-create',
      partial: true,
    });
    expect(res.validated.length).toBe(1);
    expect(res.excluded.length).toBe(1);
    expect(res.excluded[0]!.productId).toBe('bad');
    expect(res.output.rowCount).toBe(1);
  });
});

const evt = (body: unknown): APIGatewayProxyEventV2 =>
  ({ body: body == null ? undefined : JSON.stringify(body) }) as APIGatewayProxyEventV2;

describe('generate-export handler', () => {
  beforeEach(() => setExportService(makeService()));

  it('returns 200 with the export file for valid products', async () => {
    const res = (await handler(
      evt({ products: [{ product: validProduct(), topCategory: 'Women (29434)' }], mode: 'full-create' })
    )) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.export.format).toBe('CSV');
    expect(parsed.validatedCount).toBe(1);
  });

  it('returns 409 EXPORT_BLOCKED when validation fails and not partial', async () => {
    const res = (await handler(
      evt({ products: [{ product: invalidProduct(), topCategory: 'Women (29434)' }], mode: 'full-create' })
    )) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(409);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.code).toBe('EXPORT_BLOCKED');
    expect(parsed.error.validationResults.length).toBe(1);
  });

  it('returns 400 for missing products or mode', async () => {
    expect(((await handler(evt({ mode: 'full-create' }))) as { statusCode: number }).statusCode).toBe(400);
    expect(((await handler(evt({ products: [{ product: validProduct() }] }))) as { statusCode: number }).statusCode).toBe(400);
  });
});
