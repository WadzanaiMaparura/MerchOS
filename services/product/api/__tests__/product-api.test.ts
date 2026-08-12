/**
 * Product API Lambda Handlers — Unit Tests
 *
 * Mocks ProductService and verifies:
 * - Success cases for all endpoints
 * - Missing tenant context → 401
 * - Missing/invalid path params → 400
 * - Domain errors mapped to correct HTTP status codes
 * - Strict schema rejects pricing fields, system-managed fields, and wrong types
 * - Pagination works
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { CanonicalProduct } from '@merch-os/types';
import {
  ProductNotFoundError,
  ProductAlreadyExistsError,
  ProductPersistenceError,
  ProductSkuAlreadyExistsError,
  ProductValidationError,
  InvalidProductLifecycleError,
} from '../../service';

import { handler as createHandler, setProductService as setCreateService } from '../handlers/create-product';
import { handler as getHandler, setProductService as setGetService } from '../handlers/get-product';
import { handler as listHandler, setProductService as setListService } from '../handlers/list-products';
import { handler as updateHandler, setProductService as setUpdateService } from '../handlers/update-product';
import { handler as archiveHandler, setProductService as setArchiveService } from '../handlers/archive-product';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-123';
const PRODUCT_ID = 'product-456';

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'ANY /products',
    rawPath: '/products',
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '123456789',
      apiId: 'api-id',
      authorizer: {
        tenantContext: { tenantId: TENANT_ID, userId: 'user-789' },
      },
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method: 'GET', path: '/products', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'req-id',
      routeKey: 'ANY /products',
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    isBase64Encoded: false,
    ...overrides,
  } as unknown as APIGatewayProxyEventV2;
}

function makeEventWithoutTenant(overrides: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  const event = makeEvent(overrides);
  (event as any).requestContext.authorizer = {};
  return event;
}

function makeSampleProduct(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  return {
    productId: PRODUCT_ID,
    tenantId: TENANT_ID,
    content: {
      title: 'Test Product',
      shortDescription: null,
      longDescription: null,
      bulletPoints: [],
      brand: 'TestBrand',
      manufacturer: null,
      sku: 'SKU-001',
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
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Mock ProductService
const mockService = {
  createProduct: vi.fn(),
  getProduct: vi.fn(),
  listProducts: vi.fn(),
  updateProduct: vi.fn(),
  archiveProduct: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  setCreateService(mockService as any);
  setGetService(mockService as any);
  setListService(mockService as any);
  setUpdateService(mockService as any);
  setArchiveService(mockService as any);
});


// ---------------------------------------------------------------------------
// POST /products — Create Product
// ---------------------------------------------------------------------------

describe('POST /products — createProduct', () => {
  it('returns 201 with created product on success', async () => {
    const product = makeSampleProduct();
    mockService.createProduct.mockResolvedValue(product);

    const event = makeEvent({
      body: JSON.stringify({ title: 'Test Product', sku: 'SKU-001', brand: 'TestBrand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(201);
    expect(JSON.parse(result.body as string)).toEqual({ product });
    expect(mockService.createProduct).toHaveBeenCalledWith(TENANT_ID, {
      title: 'Test Product',
      sku: 'SKU-001',
      brand: 'TestBrand',
    });
  });

  it('returns 401 when tenant context is missing', async () => {
    const event = makeEventWithoutTenant({
      body: JSON.stringify({ title: 'Test', sku: 'SKU', brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(401);
    expect(JSON.parse(result.body as string).error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = makeEvent({ body: 'not-json{' });
    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 when required fields are missing', async () => {
    const event = makeEvent({ body: JSON.stringify({ title: 'Test' }) });
    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when title is empty string', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: '', sku: 'SKU', brand: 'Brand' }),
    });
    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 409 when SKU already exists', async () => {
    mockService.createProduct.mockRejectedValue(new ProductSkuAlreadyExistsError(TENANT_ID, 'SKU-001'));

    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
  });

  it('returns 400 when service throws ProductValidationError', async () => {
    mockService.createProduct.mockRejectedValue(new ProductValidationError('Title too long', 'title'));

    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('PRODUCT_VALIDATION_ERROR');
    expect(body.error.field).toBe('title');
  });

  it('returns 400 when tenantId is supplied in body — strict schema rejects it', async () => {
    const event = makeEvent({
      body: JSON.stringify({
        title: 'Test',
        sku: 'SKU-001',
        brand: 'Brand',
        tenantId: 'attacker-tenant',
      }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 for unknown errors without leaking details', async () => {
    mockService.createProduct.mockRejectedValue(new Error('DynamoDB connection timeout'));

    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU', brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toContain('DynamoDB');
  });
});

// ---------------------------------------------------------------------------
// GET /products/{productId} — Get Product
// ---------------------------------------------------------------------------

describe('GET /products/{productId} — getProduct', () => {
  it('returns 200 with product on success', async () => {
    const product = makeSampleProduct();
    mockService.getProduct.mockResolvedValue(product);

    const event = makeEvent({ pathParameters: { productId: PRODUCT_ID } });
    const result = await getHandler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string)).toEqual({ product });
    expect(mockService.getProduct).toHaveBeenCalledWith(TENANT_ID, PRODUCT_ID);
  });

  it('returns 401 when tenant context is missing', async () => {
    const event = makeEventWithoutTenant({ pathParameters: { productId: PRODUCT_ID } });
    const result = await getHandler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 400 when productId path parameter is missing', async () => {
    const event = makeEvent({ pathParameters: {} });
    const result = await getHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when product does not exist', async () => {
    mockService.getProduct.mockRejectedValue(new ProductNotFoundError(TENANT_ID, PRODUCT_ID));

    const event = makeEvent({ pathParameters: { productId: PRODUCT_ID } });
    const result = await getHandler(event);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body as string).error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// GET /products — List Products
// ---------------------------------------------------------------------------

describe('GET /products — listProducts', () => {
  it('returns 200 with products and no nextToken', async () => {
    const products = [makeSampleProduct(), makeSampleProduct({ productId: 'product-789' })];
    mockService.listProducts.mockResolvedValue({ items: products, nextToken: undefined });

    const event = makeEvent();
    const result = await listHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.products).toHaveLength(2);
    expect(body.nextToken).toBeUndefined();
  });

  it('returns 200 with pagination nextToken', async () => {
    const products = [makeSampleProduct()];
    mockService.listProducts.mockResolvedValue({ items: products, nextToken: 'page2token' });

    const event = makeEvent({ queryStringParameters: { limit: '1' } });
    const result = await listHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body as string);
    expect(body.products).toHaveLength(1);
    expect(body.nextToken).toBe('page2token');
    expect(mockService.listProducts).toHaveBeenCalledWith(TENANT_ID, { limit: 1, nextToken: undefined });
  });

  it('passes nextToken to service for continuation', async () => {
    mockService.listProducts.mockResolvedValue({ items: [], nextToken: undefined });

    const event = makeEvent({ queryStringParameters: { nextToken: 'abc123' } });
    await listHandler(event);

    expect(mockService.listProducts).toHaveBeenCalledWith(TENANT_ID, { limit: undefined, nextToken: 'abc123' });
  });

  it('returns 401 when tenant context is missing', async () => {
    const event = makeEventWithoutTenant();
    const result = await listHandler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 400 for invalid limit parameter', async () => {
    const event = makeEvent({ queryStringParameters: { limit: 'abc' } });
    const result = await listHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for negative limit', async () => {
    const event = makeEvent({ queryStringParameters: { limit: '-5' } });
    const result = await listHandler(event);
    expect(result.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /products/{productId} — Update Product
// ---------------------------------------------------------------------------

describe('PUT /products/{productId} — updateProduct', () => {
  it('returns 200 with updated product on success', async () => {
    const product = makeSampleProduct({ content: { ...makeSampleProduct().content, title: 'Updated' } });
    mockService.updateProduct.mockResolvedValue(product);

    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).product.content.title).toBe('Updated');
    expect(mockService.updateProduct).toHaveBeenCalledWith(TENANT_ID, PRODUCT_ID, { title: 'Updated' });
  });

  it('returns 401 when tenant context is missing', async () => {
    const event = makeEventWithoutTenant({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated' }),
    });
    const result = await updateHandler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 400 when productId path parameter is missing', async () => {
    const event = makeEvent({
      pathParameters: {},
      body: JSON.stringify({ title: 'Updated' }),
    });
    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: '{invalid-json',
    });
    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('INVALID_REQUEST');
  });

  it('returns 404 when product does not exist', async () => {
    mockService.updateProduct.mockRejectedValue(new ProductNotFoundError(TENANT_ID, PRODUCT_ID));

    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(404);
  });

  it('returns 409 when lifecycle prevents update (archived product)', async () => {
    mockService.updateProduct.mockRejectedValue(
      new InvalidProductLifecycleError('Cannot update an archived product')
    );

    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error.code).toBe('INVALID_PRODUCT_LIFECYCLE');
  });

  it('returns 409 when SKU is already taken', async () => {
    mockService.updateProduct.mockRejectedValue(new ProductSkuAlreadyExistsError(TENANT_ID, 'DUPE-SKU'));

    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ sku: 'DUPE-SKU' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error.code).toBe('PRODUCT_SKU_ALREADY_EXISTS');
  });

  it('returns 400 when body contains productId — strict schema rejects it', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ productId: 'attacker-id', title: 'Updated' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// DELETE /products/{productId} — Archive Product
// ---------------------------------------------------------------------------

describe('DELETE /products/{productId} — archiveProduct', () => {
  it('returns 200 with archived product on success', async () => {
    const product = makeSampleProduct({ lifecycleState: 'archived' });
    mockService.archiveProduct.mockResolvedValue(product);

    const event = makeEvent({ pathParameters: { productId: PRODUCT_ID } });
    const result = await archiveHandler(event);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body as string).product.lifecycleState).toBe('archived');
    expect(mockService.archiveProduct).toHaveBeenCalledWith(TENANT_ID, PRODUCT_ID);
  });

  it('returns 401 when tenant context is missing', async () => {
    const event = makeEventWithoutTenant({ pathParameters: { productId: PRODUCT_ID } });
    const result = await archiveHandler(event);
    expect(result.statusCode).toBe(401);
  });

  it('returns 400 when productId path parameter is missing', async () => {
    const event = makeEvent({ pathParameters: {} });
    const result = await archiveHandler(event);
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when product does not exist', async () => {
    mockService.archiveProduct.mockRejectedValue(new ProductNotFoundError(TENANT_ID, PRODUCT_ID));

    const event = makeEvent({ pathParameters: { productId: PRODUCT_ID } });
    const result = await archiveHandler(event);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body as string).error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('returns 500 for persistence errors without leaking details', async () => {
    mockService.archiveProduct.mockRejectedValue(new ProductPersistenceError('DynamoDB failed'));

    const event = makeEvent({ pathParameters: { productId: PRODUCT_ID } });
    const result = await archiveHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body as string);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('An internal error occurred');
    expect(body.error.message).not.toContain('DynamoDB');
  });
});

// ---------------------------------------------------------------------------
// Error mapper — domain errors → HTTP responses
// ---------------------------------------------------------------------------

describe('Error mapper coverage', () => {
  it('maps ProductAlreadyExistsError to 409', async () => {
    mockService.createProduct.mockRejectedValue(new ProductAlreadyExistsError(TENANT_ID, PRODUCT_ID));

    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU', brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body as string).error.code).toBe('PRODUCT_ALREADY_EXISTS');
  });
});

// ---------------------------------------------------------------------------
// Strict schema enforcement — pricing fields rejected
// ---------------------------------------------------------------------------

describe('Strict schema — pricing fields rejected', () => {
  it('returns 400 when sellingPrice is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', sellingPrice: 99.99 }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when rrp is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', rrp: 129.99 }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when currency is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', currency: 'USD' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when sellingPrice is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', sellingPrice: 49.99 }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when rrp is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', rrp: 149.99 }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when currency is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', currency: 'EUR' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Strict schema enforcement — system-managed fields rejected
// ---------------------------------------------------------------------------

describe('Strict schema — system-managed fields rejected', () => {
  it('returns 400 when tenantId is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', tenantId: 'attacker-tenant' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when productId is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', productId: 'injected-id' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when createdAt is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', createdAt: '2020-01-01T00:00:00Z' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when updatedAt is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', updatedAt: '2020-01-01T00:00:00Z' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when lifecycleState is in create request body', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: 'SKU-001', brand: 'Brand', lifecycleState: 'active' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when tenantId is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', tenantId: 'attacker-tenant' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when createdAt is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', createdAt: '2020-01-01T00:00:00Z' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when updatedAt is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', updatedAt: '2020-01-01T00:00:00Z' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when lifecycleState is in update request body', async () => {
    const event = makeEvent({
      pathParameters: { productId: PRODUCT_ID },
      body: JSON.stringify({ title: 'Updated', lifecycleState: 'archived' }),
    });

    const result = await updateHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// Strict schema enforcement — wrong types rejected
// ---------------------------------------------------------------------------

describe('Strict schema — wrong types rejected', () => {
  it('returns 400 when title is a number (wrong type)', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 123, sku: 'SKU-001', brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when sku is an array (wrong type)', async () => {
    const event = makeEvent({
      body: JSON.stringify({ title: 'Test', sku: [], brand: 'Brand' }),
    });

    const result = await createHandler(event);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body as string).error.code).toBe('VALIDATION_ERROR');
  });
});
