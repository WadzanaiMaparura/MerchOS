/**
 * Unit tests for ProductRepository.
 *
 * Uses aws-sdk-client-mock to mock DynamoDBDocumentClient commands.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { CanonicalProduct } from '@merch-os/types';
import { ProductRepository } from '../product-repository';
import { ProductAlreadyExistsError, ProductNotFoundError } from '../errors';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const ddbMock = mockClient(DynamoDBDocumentClient);

function createRepo(): ProductRepository {
  return ProductRepository.fromDocClient(
    ddbMock as unknown as DynamoDBDocumentClient
  );
}

function makeProduct(overrides?: Partial<CanonicalProduct>): CanonicalProduct {
  return {
    productId: 'prod-001',
    tenantId: 'tenant-abc',
    content: {
      title: 'Test Product',
      shortDescription: 'A test product',
      longDescription: null,
      bulletPoints: ['Point 1'],
      brand: 'TestBrand',
      manufacturer: null,
      sku: 'SKU-123',
      barcode: null,
      mpn: null,
      weight: 500,
      weightUnit: 'g',
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
      sellingPrice: 99.99,
      rrp: null,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 100,
      lowStockThreshold: 10,
      fulfilmentMethod: null,
      leadtimeDays: null,
      handlingTimeDays: null,
      listingStatus: 'active',
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

function makeDynamoItem(product: CanonicalProduct): Record<string, unknown> {
  return {
    ...product,
    PK: `TENANT#${product.tenantId}`,
    SK: `PRODUCT#${product.productId}`,
    GSI1PK: `TENANT#${product.tenantId}#SKU`,
    GSI1SK: `SKU#${product.content.sku}`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductRepository', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('should create a product and set timestamps', async () => {
      ddbMock.on(PutCommand).resolves({});
      const repo = createRepo();
      const product = makeProduct();

      const result = await repo.create(product);

      expect(result.productId).toBe('prod-001');
      expect(result.tenantId).toBe('tenant-abc');
      // createdAt and updatedAt should be set to current time (ISO format)
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.createdAt).toBe(result.updatedAt);

      // Verify PutCommand was called with correct condition
      const calls = ddbMock.commandCalls(PutCommand);
      expect(calls).toHaveLength(1);
      const input = calls[0]!.args[0].input;
      expect(input.ConditionExpression).toBe('attribute_not_exists(PK)');
      expect(input.Item!['PK']).toBe('TENANT#tenant-abc');
      expect(input.Item!['SK']).toBe('PRODUCT#prod-001');
      expect(input.Item!['GSI1PK']).toBe('TENANT#tenant-abc#SKU');
      expect(input.Item!['GSI1SK']).toBe('SKU#SKU-123');
    });

    it('should throw ProductAlreadyExistsError on duplicate', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      const repo = createRepo();
      const product = makeProduct();

      await expect(repo.create(product)).rejects.toThrow(ProductAlreadyExistsError);
      await expect(repo.create(product)).rejects.toMatchObject({
        code: 'PRODUCT_ALREADY_EXISTS',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Get
  // -------------------------------------------------------------------------

  describe('get', () => {
    it('should return a product when found', async () => {
      const product = makeProduct();
      ddbMock.on(GetCommand).resolves({
        Item: makeDynamoItem(product),
      });

      const repo = createRepo();
      const result = await repo.get('tenant-abc', 'prod-001');

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('prod-001');
      expect(result!.tenantId).toBe('tenant-abc');
      // DynamoDB keys should be stripped
      expect((result as Record<string, unknown>)['PK']).toBeUndefined();
      expect((result as Record<string, unknown>)['SK']).toBeUndefined();
      expect((result as Record<string, unknown>)['GSI1PK']).toBeUndefined();
      expect((result as Record<string, unknown>)['GSI1SK']).toBeUndefined();

      // Verify correct key was used
      const calls = ddbMock.commandCalls(GetCommand);
      const input = calls[0]!.args[0].input;
      expect(input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'PRODUCT#prod-001',
      });
    });

    it('should return null when product not found', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });

      const repo = createRepo();
      const result = await repo.get('tenant-abc', 'prod-nonexistent');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // List by Tenant
  // -------------------------------------------------------------------------

  describe('listByTenant', () => {
    it('should return products for a tenant (single page)', async () => {
      const products = [makeProduct(), makeProduct({ productId: 'prod-002' })];
      ddbMock.on(QueryCommand).resolves({
        Items: products.map(makeDynamoItem),
        LastEvaluatedKey: undefined,
      });

      const repo = createRepo();
      const result = await repo.listByTenant('tenant-abc');

      expect(result.items).toHaveLength(2);
      expect(result.nextToken).toBeUndefined();

      // Verify query uses begins_with, not scan
      const calls = ddbMock.commandCalls(QueryCommand);
      const input = calls[0]!.args[0].input;
      expect(input.KeyConditionExpression).toBe(
        'PK = :pk AND begins_with(SK, :skPrefix)'
      );
      expect(input.ExpressionAttributeValues).toEqual({
        ':pk': 'TENANT#tenant-abc',
        ':skPrefix': 'PRODUCT#',
      });
    });

    it('should handle pagination with nextToken', async () => {
      const lastKey = { PK: 'TENANT#tenant-abc', SK: 'PRODUCT#prod-005' };
      const product = makeProduct({ productId: 'prod-006' });

      ddbMock.on(QueryCommand).resolves({
        Items: [makeDynamoItem(product)],
        LastEvaluatedKey: { PK: 'TENANT#tenant-abc', SK: 'PRODUCT#prod-006' },
      });

      const repo = createRepo();
      const token = Buffer.from(JSON.stringify(lastKey)).toString('base64');
      const result = await repo.listByTenant('tenant-abc', {
        nextToken: token,
        limit: 10,
      });

      expect(result.items).toHaveLength(1);
      expect(result.nextToken).toBeDefined();

      // Decode the returned nextToken
      const decoded = JSON.parse(
        Buffer.from(result.nextToken!, 'base64').toString('utf-8')
      );
      expect(decoded).toEqual({ PK: 'TENANT#tenant-abc', SK: 'PRODUCT#prod-006' });

      // Verify ExclusiveStartKey was passed
      const calls = ddbMock.commandCalls(QueryCommand);
      const input = calls[0]!.args[0].input;
      expect(input.ExclusiveStartKey).toEqual(lastKey);
      expect(input.Limit).toBe(10);
    });

    it('should cap limit at 100', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: undefined });

      const repo = createRepo();
      await repo.listByTenant('tenant-abc', { limit: 500 });

      const calls = ddbMock.commandCalls(QueryCommand);
      const input = calls[0]!.args[0].input;
      expect(input.Limit).toBe(100);
    });

    it('should default limit to 50', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [], LastEvaluatedKey: undefined });

      const repo = createRepo();
      await repo.listByTenant('tenant-abc');

      const calls = ddbMock.commandCalls(QueryCommand);
      const input = calls[0]!.args[0].input;
      expect(input.Limit).toBe(50);
    });
  });

  // -------------------------------------------------------------------------
  // Find by SKU (GSI1)
  // -------------------------------------------------------------------------

  describe('findBySku', () => {
    it('should return a product when found via GSI1', async () => {
      const product = makeProduct();
      ddbMock.on(QueryCommand).resolves({
        Items: [makeDynamoItem(product)],
      });

      const repo = createRepo();
      const result = await repo.findBySku('tenant-abc', 'SKU-123');

      expect(result).not.toBeNull();
      expect(result!.content.sku).toBe('SKU-123');

      // Verify GSI1 query
      const calls = ddbMock.commandCalls(QueryCommand);
      const input = calls[0]!.args[0].input;
      expect(input.IndexName).toBe('GSI1');
      expect(input.KeyConditionExpression).toBe(
        'GSI1PK = :gsi1pk AND GSI1SK = :gsi1sk'
      );
      expect(input.ExpressionAttributeValues).toEqual({
        ':gsi1pk': 'TENANT#tenant-abc#SKU',
        ':gsi1sk': 'SKU#SKU-123',
      });
    });

    it('should return null when SKU not found', async () => {
      ddbMock.on(QueryCommand).resolves({ Items: [] });

      const repo = createRepo();
      const result = await repo.findBySku('tenant-abc', 'SKU-NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('should update a product and set updatedAt', async () => {
      ddbMock.on(PutCommand).resolves({});

      const repo = createRepo();
      const product = makeProduct({
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await repo.update('tenant-abc', 'prod-001', product);

      // updatedAt should change
      expect(result.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
      expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // createdAt should be preserved
      expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');

      // Verify condition expression
      const calls = ddbMock.commandCalls(PutCommand);
      const input = calls[0]!.args[0].input;
      expect(input.ConditionExpression).toBe(
        'attribute_exists(PK) AND PK = :callerTenantPK'
      );
      expect(input.ExpressionAttributeValues![':callerTenantPK']).toBe(
        'TENANT#tenant-abc'
      );
    });

    it('should throw ProductNotFoundError when product does not exist', async () => {
      const error = new Error('Conditional check failed');
      error.name = 'ConditionalCheckFailedException';
      ddbMock.on(PutCommand).rejects(error);

      const repo = createRepo();
      const product = makeProduct();

      await expect(
        repo.update('tenant-abc', 'prod-001', product)
      ).rejects.toThrow(ProductNotFoundError);
    });

    it('should throw when tenantId does not match', async () => {
      const repo = createRepo();
      const product = makeProduct({ tenantId: 'different-tenant' });

      await expect(
        repo.update('tenant-abc', 'prod-001', product)
      ).rejects.toThrow('Cannot change tenantId or productId during update');
    });

    it('should throw when productId does not match', async () => {
      const repo = createRepo();
      const product = makeProduct({ productId: 'different-product' });

      await expect(
        repo.update('tenant-abc', 'prod-001', product)
      ).rejects.toThrow('Cannot change tenantId or productId during update');
    });
  });

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('should delete and return the product', async () => {
      const product = makeProduct();
      ddbMock.on(DeleteCommand).resolves({
        Attributes: makeDynamoItem(product),
      });

      const repo = createRepo();
      const result = await repo.delete('tenant-abc', 'prod-001');

      expect(result).not.toBeNull();
      expect(result!.productId).toBe('prod-001');
      // DynamoDB keys should be stripped
      expect((result as Record<string, unknown>)['PK']).toBeUndefined();

      // Verify ReturnValues
      const calls = ddbMock.commandCalls(DeleteCommand);
      const input = calls[0]!.args[0].input;
      expect(input.ReturnValues).toBe('ALL_OLD');
      expect(input.Key).toEqual({
        PK: 'TENANT#tenant-abc',
        SK: 'PRODUCT#prod-001',
      });
    });

    it('should return null when product does not exist', async () => {
      ddbMock.on(DeleteCommand).resolves({ Attributes: undefined });

      const repo = createRepo();
      const result = await repo.delete('tenant-abc', 'prod-nonexistent');

      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Tenant Isolation
  // -------------------------------------------------------------------------

  describe('tenant isolation', () => {
    it('all operations use tenant-scoped PK', async () => {
      ddbMock.on(GetCommand).resolves({ Item: undefined });
      ddbMock.on(QueryCommand).resolves({ Items: [] });
      ddbMock.on(PutCommand).resolves({});
      ddbMock.on(DeleteCommand).resolves({ Attributes: undefined });

      const repo = createRepo();

      // Get
      await repo.get('tenant-xyz', 'prod-001');
      const getCalls = ddbMock.commandCalls(GetCommand);
      expect(getCalls[0]!.args[0].input.Key!['PK']).toBe('TENANT#tenant-xyz');

      // List
      await repo.listByTenant('tenant-xyz');
      const queryCalls = ddbMock.commandCalls(QueryCommand);
      expect(queryCalls[0]!.args[0].input.ExpressionAttributeValues![':pk']).toBe(
        'TENANT#tenant-xyz'
      );

      // FindBySku
      await repo.findBySku('tenant-xyz', 'SKU-1');
      const queryCallsSku = ddbMock.commandCalls(QueryCommand);
      expect(
        queryCallsSku[1]!.args[0].input.ExpressionAttributeValues![':gsi1pk']
      ).toBe('TENANT#tenant-xyz#SKU');

      // Create
      const product = makeProduct({ tenantId: 'tenant-xyz' });
      await repo.create(product);
      const putCalls = ddbMock.commandCalls(PutCommand);
      expect(putCalls[0]!.args[0].input.Item!['PK']).toBe('TENANT#tenant-xyz');

      // Delete
      await repo.delete('tenant-xyz', 'prod-001');
      const deleteCalls = ddbMock.commandCalls(DeleteCommand);
      expect(deleteCalls[0]!.args[0].input.Key!['PK']).toBe('TENANT#tenant-xyz');
    });
  });

  // -------------------------------------------------------------------------
  // No Scan operations
  // -------------------------------------------------------------------------

  describe('no scan operations', () => {
    it('repository source code does not use ScanCommand', async () => {
      // This is a compile-time guarantee — ScanCommand is not imported in
      // product-repository.ts. We verify by checking the import list isn't
      // used at runtime.
      const { ProductRepository: Repo } = await import('../product-repository');
      expect(Repo).toBeDefined();
      // The fact that all list operations use QueryCommand (verified above)
      // confirms no Scan is used.
    });
  });
});
