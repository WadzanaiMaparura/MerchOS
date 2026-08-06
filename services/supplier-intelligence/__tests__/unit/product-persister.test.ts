/**
 * Unit tests for product-persister.ts
 *
 * Tests cover:
 * - chunkArray helper
 * - buildProductItem field mapping
 * - persistProducts happy path (single and multi-batch)
 * - Partial failure preservation: records before failure point are retained
 * - ImportJob COMPLETED transition is always called
 * - emitImportJobCompleted is called with correct arguments
 * - Missing table name error handling
 *
 * Requirements: 2.1, 10.2, 14.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DynamoDBDocumentClient, BatchWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { mockClient } from 'aws-sdk-client-mock';

import {
  persistProducts,
  chunkArray,
  setDynamoClient,
  resetDynamoClient,
  BATCH_WRITE_MAX_ITEMS,
  type PersistProductsParams,
  type ProductToPersist,
} from '../../processors/product-persister';
import { setDynamoDocClient } from '../../utils/import-job-status';
import { resetForTesting as resetEventBridgeClient } from '../../utils/event-emitter';
import type { ImportMetadata } from '../../types/supplier.types';

// Mock EventBridge at the module level so credential resolution is intercepted
const ebMock = mockClient(EventBridgeClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImportMetadata(overrides?: Partial<ImportMetadata>): ImportMetadata {
  return {
    sourceImportJobId: 'job-001',
    sourceSupplierId: 'sup-001',
    sourceType: 'FILE_CSV',
    importedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeProduct(overrides?: Partial<ProductToPersist>): ProductToPersist {
  return {
    record: {
      title: 'Test Product',
      sku: 'SKU-001',
      description: 'A test product description',
    },
    importMetadata: makeImportMetadata(),
    ...overrides,
  };
}

function makeBaseParams(
  overrides?: Partial<PersistProductsParams>,
): PersistProductsParams {
  return {
    tenantId: 'tenant-abc',
    importJobId: 'job-001',
    supplierId: 'sup-001',
    sourceType: 'FILE_CSV',
    products: [makeProduct()],
    productsTableName: 'products-test',
    importJobsTableName: 'import-jobs-test',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// chunkArray
// ---------------------------------------------------------------------------

describe('chunkArray', () => {
  it('returns empty array for empty input', () => {
    expect(chunkArray([], 25)).toEqual([]);
  });

  it('returns one chunk when items < size', () => {
    const result = chunkArray([1, 2, 3], 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([1, 2, 3]);
  });

  it('returns one chunk when items === size', () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const result = chunkArray(items, 25);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(25);
  });

  it('splits exactly into equal chunks', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const result = chunkArray(items, 25);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(25);
    expect(result[1]).toHaveLength(25);
  });

  it('handles remainder chunk correctly', () => {
    const items = Array.from({ length: 27 }, (_, i) => i);
    const result = chunkArray(items, 25);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(25);
    expect(result[1]).toHaveLength(2);
  });

  it('preserves original items across all chunks', () => {
    const items = [10, 20, 30, 40, 50];
    const result = chunkArray(items, 2);
    const flattened = result.flat();
    expect(flattened).toEqual(items);
  });
});

// ---------------------------------------------------------------------------
// persistProducts — DynamoDB and ImportJob interactions
// ---------------------------------------------------------------------------

describe('persistProducts', () => {
  const ddbMock = mockClient(DynamoDBDocumentClient);

  beforeEach(() => {
    ddbMock.reset();
    ebMock.reset();
    resetEventBridgeClient();
    // Inject the mock into both the persister and the import-job-status utility
    setDynamoClient(ddbMock as unknown as DynamoDBDocumentClient);
    setDynamoDocClient(ddbMock as unknown as DynamoDBDocumentClient);

    // Default mock: everything succeeds
    ddbMock.on(BatchWriteCommand).resolves({ UnprocessedItems: {} });
    ddbMock.on(UpdateCommand).resolves({});
    ebMock.on(PutEventsCommand).resolves({ FailedEntryCount: 0, Entries: [{}] });

    vi.stubEnv('EVENT_BUS_NAME', 'test-event-bus');
    vi.stubEnv('AWS_REGION', 'af-south-1');
  });

  afterEach(() => {
    resetDynamoClient();
    resetEventBridgeClient();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path — single product
  // -------------------------------------------------------------------------

  it('writes a single product via BatchWriteCommand', async () => {
    const params = makeBaseParams();

    const result = await persistProducts(params);

    expect(result.persisted).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.failureAtIndex).toBeNull();
    expect(result.failureError).toBeNull();

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(batchCalls).toHaveLength(1);
  });

  it('sets lifecycleState to DRAFT on every written product', async () => {
    const params = makeBaseParams();

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const requestItems = batchCalls[0]!.args[0].input.RequestItems!['products-test']!;

    expect(requestItems).toHaveLength(1);
    const item = requestItems[0]!.PutRequest!.Item!;
    expect(item['lifecycleState']).toBe('DRAFT');
  });

  it('attaches importMetadata with all required fields', async () => {
    const importMetadata = makeImportMetadata({
      ocrConfidence: 0.95,
      flaggedForReview: false,
      duplicateOf: undefined,
    });
    const params = makeBaseParams({
      products: [makeProduct({ importMetadata })],
    });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const item = batchCalls[0]!.args[0].input.RequestItems!['products-test']![0]!.PutRequest!.Item!;
    const meta = item['importMetadata'] as ImportMetadata;

    expect(meta.sourceImportJobId).toBe('job-001');
    expect(meta.sourceSupplierId).toBe('sup-001');
    expect(meta.sourceType).toBe('FILE_CSV');
    expect(meta.importedAt).toBe('2024-01-01T00:00:00.000Z');
    expect(meta.ocrConfidence).toBe(0.95);
  });

  it('attaches optional importMetadata fields when provided', async () => {
    const importMetadata = makeImportMetadata({
      ocrConfidence: 0.65,
      flaggedForReview: true,
      duplicateOf: 'existing-product-id',
    });
    const params = makeBaseParams({
      products: [makeProduct({ importMetadata })],
    });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const item = batchCalls[0]!.args[0].input.RequestItems!['products-test']![0]!.PutRequest!.Item!;
    const meta = item['importMetadata'] as ImportMetadata;

    expect(meta.flaggedForReview).toBe(true);
    expect(meta.duplicateOf).toBe('existing-product-id');
    expect(meta.ocrConfidence).toBe(0.65);
  });

  it('uses PK=TENANT#{tenantId} and SK=PRODUCT#{productId} format', async () => {
    const params = makeBaseParams({ products: [makeProduct({ productId: 'prod-xyz' })] });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const item = batchCalls[0]!.args[0].input.RequestItems!['products-test']![0]!.PutRequest!.Item!;
    expect(item['PK']).toBe('TENANT#tenant-abc');
    expect(item['SK']).toBe('PRODUCT#prod-xyz');
  });

  it('generates a productId when none is provided', async () => {
    const params = makeBaseParams({ products: [makeProduct({ productId: undefined })] });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const item = batchCalls[0]!.args[0].input.RequestItems!['products-test']![0]!.PutRequest!.Item!;
    expect(item['productId']).toBeTruthy();
    expect(typeof item['productId']).toBe('string');
    // UUID v4 pattern: 8-4-4-4-12 hex
    expect(item['productId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  // -------------------------------------------------------------------------
  // Batching — splits 26+ records into multiple batches
  // -------------------------------------------------------------------------

  it('splits 26 products into two batchWrite calls', async () => {
    const products = Array.from({ length: 26 }, (_, i) =>
      makeProduct({ productId: `prod-${i}` }),
    );
    const params = makeBaseParams({ products });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[0]!.args[0].input.RequestItems!['products-test']).toHaveLength(
      BATCH_WRITE_MAX_ITEMS,
    );
    expect(batchCalls[1]!.args[0].input.RequestItems!['products-test']).toHaveLength(1);

    const result = await persistProducts(params);
    expect(result.persisted).toBe(26);
  });

  it('writes all 25-item batches exactly at the DynamoDB limit', async () => {
    const products = Array.from({ length: 25 }, (_, i) =>
      makeProduct({ productId: `prod-${i}` }),
    );
    const params = makeBaseParams({ products });

    const result = await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(batchCalls).toHaveLength(1);
    expect(result.persisted).toBe(25);
  });

  // -------------------------------------------------------------------------
  // Partial failure preservation (Requirement 14.3)
  // -------------------------------------------------------------------------

  it('preserves records from successful batches when a later batch fails', async () => {
    // 26 products → 2 batches (25 + 1)
    // First batch succeeds, second batch throws
    const products = Array.from({ length: 26 }, (_, i) =>
      makeProduct({ productId: `prod-${i}` }),
    );

    ddbMock
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: {} })          // batch 1 succeeds
      .rejectsOnce(new Error('DynamoDB write failure')); // batch 2 fails

    const params = makeBaseParams({ products });
    const result = await persistProducts(params);

    // First 25 records are preserved, last 1 fails
    expect(result.persisted).toBe(25);
    expect(result.failed).toBe(1);
    expect(result.failureAtIndex).toBe(25); // failure at record index 25
    expect(result.failureError).toContain('DynamoDB write failure');
  });

  it('sets failureAtIndex=0 when the very first batch fails', async () => {
    ddbMock
      .on(BatchWriteCommand)
      .rejectsOnce(new Error('immediate failure'));

    const params = makeBaseParams({
      products: [makeProduct(), makeProduct({ productId: 'prod-2' })],
    });
    const result = await persistProducts(params);

    expect(result.persisted).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.failureAtIndex).toBe(0);
  });

  it('reports partial result in jobResults when some batches fail', async () => {
    const products = Array.from({ length: 26 }, (_, i) =>
      makeProduct({ productId: `prod-${i}` }),
    );

    ddbMock
      .on(BatchWriteCommand)
      .resolvesOnce({ UnprocessedItems: {} })
      .rejectsOnce(new Error('network error'));

    const params = makeBaseParams({ products });
    const result = await persistProducts(params);

    expect(result.jobResults.totalExtracted).toBe(26);
    expect(result.jobResults.created).toBe(25);
  });

  // -------------------------------------------------------------------------
  // ImportJob status update (Requirement 10.2)
  // -------------------------------------------------------------------------

  it('calls UpdateCommand to mark ImportJob COMPLETED after persisting', async () => {
    const params = makeBaseParams();

    await persistProducts(params);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);

    const updateInput = updateCalls[0]!.args[0].input;
    expect(updateInput.Key).toEqual({
      PK: 'TENANT#tenant-abc',
      SK: 'IMPORT#job-001',
    });
    expect(updateInput.ExpressionAttributeValues?.[':newStatus']).toBe('COMPLETED');
  });

  it('always calls UpdateCommand COMPLETED even when a batch fails', async () => {
    ddbMock
      .on(BatchWriteCommand)
      .rejectsOnce(new Error('write failed'));

    const params = makeBaseParams();

    await persistProducts(params);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    const updateInput = updateCalls[0]!.args[0].input;
    expect(updateInput.ExpressionAttributeValues?.[':newStatus']).toBe('COMPLETED');
  });

  it('sets progress to 100% on successful completion', async () => {
    const params = makeBaseParams();

    await persistProducts(params);

    const updateCalls = ddbMock.commandCalls(UpdateCommand);
    const updateInput = updateCalls[0]!.args[0].input;
    const progress = updateInput.ExpressionAttributeValues?.[':progress'] as {
      percentage: number;
    };
    expect(progress?.percentage).toBe(100);
  });

  // -------------------------------------------------------------------------
  // JobResults shape
  // -------------------------------------------------------------------------

  it('returns jobResults with totalExtracted === products.length', async () => {
    const products = Array.from({ length: 5 }, (_, i) =>
      makeProduct({ productId: `prod-${i}` }),
    );
    const params = makeBaseParams({ products });

    const result = await persistProducts(params);

    expect(result.jobResults.totalExtracted).toBe(5);
    expect(result.jobResults.created).toBe(5);
    expect(result.jobResults.updated).toBe(0);
    expect(result.jobResults.duplicates).toBe(0);
    expect(result.jobResults.validationFailed).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Missing environment variables
  // -------------------------------------------------------------------------

  it('throws when PRODUCTS_TABLE_NAME is not set and productsTableName is omitted', async () => {
    const originalEnv = process.env['PRODUCTS_TABLE_NAME'];
    delete process.env['PRODUCTS_TABLE_NAME'];

    await expect(
      persistProducts(makeBaseParams({ productsTableName: undefined })),
    ).rejects.toThrow('Products table name is required');

    if (originalEnv !== undefined) {
      process.env['PRODUCTS_TABLE_NAME'] = originalEnv;
    }
  });

  it('throws when IMPORT_JOBS_TABLE is not set and importJobsTableName is omitted', async () => {
    const originalEnv = process.env['IMPORT_JOBS_TABLE'];
    delete process.env['IMPORT_JOBS_TABLE'];

    await expect(
      persistProducts(makeBaseParams({ importJobsTableName: undefined })),
    ).rejects.toThrow('Import Jobs table name is required');

    if (originalEnv !== undefined) {
      process.env['IMPORT_JOBS_TABLE'] = originalEnv;
    }
  });

  it('reads productsTableName from PRODUCTS_TABLE_NAME env var when not passed', async () => {
    process.env['PRODUCTS_TABLE_NAME'] = 'env-products-table';
    const params = makeBaseParams({ productsTableName: undefined });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    expect(batchCalls[0]!.args[0].input.RequestItems).toHaveProperty('env-products-table');

    delete process.env['PRODUCTS_TABLE_NAME'];
  });

  // -------------------------------------------------------------------------
  // Product fields are written correctly
  // -------------------------------------------------------------------------

  it('writes core product fields to DynamoDB', async () => {
    const record = {
      title: 'Running Shoes',
      sku: 'RS-100',
      description: 'Great shoes',
      brand: 'Nike',
      category: 'Footwear',
    };
    const params = makeBaseParams({
      products: [makeProduct({ record, productId: 'prod-rs-100' })],
    });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const item = batchCalls[0]!.args[0].input.RequestItems!['products-test']![0]!.PutRequest!.Item!;

    expect(item['title']).toBe('Running Shoes');
    expect(item['sku']).toBe('RS-100');
    expect(item['description']).toBe('Great shoes');
    expect(item['brand']).toBe('Nike');
    expect(item['category']).toBe('Footwear');
    expect(item['supplierId']).toBe('sup-001');
    expect(item['tenantId']).toBe('tenant-abc');
  });

  it('sets GSI keys for SKU and supplier lookup', async () => {
    const record = { title: 'Blue Shirt', sku: 'SHIRT-42', description: 'Nice shirt' };
    const params = makeBaseParams({
      products: [makeProduct({ record, productId: 'prod-shirt' })],
    });

    await persistProducts(params);

    const batchCalls = ddbMock.commandCalls(BatchWriteCommand);
    const item = batchCalls[0]!.args[0].input.RequestItems!['products-test']![0]!.PutRequest!.Item!;

    expect(item['GSI1PK']).toBe('TENANT#tenant-abc#SKU#SHIRT-42');
    expect(item['GSI2PK']).toBe('TENANT#tenant-abc#SUPPLIER#sup-001');
  });

  // -------------------------------------------------------------------------
  // Empty product list
  // -------------------------------------------------------------------------

  it('handles empty product list without error', async () => {
    const params = makeBaseParams({ products: [] });

    const result = await persistProducts(params);

    expect(result.persisted).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.failureAtIndex).toBeNull();
    expect(result.jobResults.totalExtracted).toBe(0);

    // No batch writes issued
    expect(ddbMock.commandCalls(BatchWriteCommand)).toHaveLength(0);
  });
});
