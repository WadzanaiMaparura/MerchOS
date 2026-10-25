/**
 * Unit tests for InventoryService (Phase 8A business rules).
 *
 * The repository and the Product SKU lookup are mocked with vi.fn(); no real
 * DynamoDB is involved. Covers SKU validation, warehouse create/update,
 * absolute PUT math, zero stock, non-negative invariant, ledger calculation,
 * tenant isolation, archived-product acceptance, concurrency mapping, source
 * validation, and atomic repository usage.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InventoryRecord, InventoryTransaction } from '../../../shared/types/inventory.types';
import { InventoryService } from '../inventory-service';
import type { InventoryPersistence, ProductSkuLookup } from '../types';
import {
  ProductNotFoundError,
  NegativeStockError,
  InvalidQuantityError,
  InvalidSourceError,
  InventoryConcurrentUpdateError,
} from '../errors';
import { InventoryConcurrencyError } from '../../repository/errors';

const TENANT = 'tenant-abc';
const SKU = 'SKU-123';
const WH = 'WH-MAIN';
const ACTOR = 'user-789';

function makeRepo(): InventoryPersistence & {
  get: ReturnType<typeof vi.fn>;
  queryBySku: ReturnType<typeof vi.fn>;
  listByTenant: ReturnType<typeof vi.fn>;
  listTransactionsBySku: ReturnType<typeof vi.fn>;
  putWithTransaction: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(),
    queryBySku: vi.fn(),
    listByTenant: vi.fn(),
    listTransactionsBySku: vi.fn(),
    putWithTransaction: vi.fn(),
  } as never;
}

function makeProductLookup(): ProductSkuLookup & { findBySku: ReturnType<typeof vi.fn> } {
  return { findBySku: vi.fn() } as never;
}

function existingRecord(overrides?: Partial<InventoryRecord>): InventoryRecord {
  return {
    tenantId: TENANT,
    sku: SKU,
    warehouseId: WH,
    onHand: 10,
    reserved: 0,
    available: 10,
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A minimal "product exists" stub (shape irrelevant — service only checks non-null). */
const PRODUCT_EXISTS = { productId: 'prod-1', content: { sku: SKU } };

describe('InventoryService.updateStock', () => {
  let repo: ReturnType<typeof makeRepo>;
  let products: ReturnType<typeof makeProductLookup>;
  let service: InventoryService;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = makeRepo();
    products = makeProductLookup();
    service = new InventoryService(repo, products);
    // putWithTransaction echoes the record back by default
    repo.putWithTransaction.mockImplementation(async (record: InventoryRecord) => record);
  });

  // 1. unknown SKU
  it('rejects an unknown SKU with PRODUCT_NOT_FOUND (404) and no writes', async () => {
    products.findBySku.mockResolvedValue(null);

    await expect(
      service.updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 5, actor: ACTOR, source: 'manual' })
    ).rejects.toBeInstanceOf(ProductNotFoundError);

    const err = await service
      .updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 5, actor: ACTOR, source: 'manual' })
      .catch((e) => e);
    expect(err.code).toBe('PRODUCT_NOT_FOUND');
    expect(err.status).toBe(404);
    expect(repo.get).not.toHaveBeenCalled();
    expect(repo.putWithTransaction).not.toHaveBeenCalled();
  });

  // 2. known SKU + new warehouse (create)
  it('creates a record for a known SKU + new warehouse (previousQty=0, delta=+onHand)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(null); // no existing record

    const result = await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 12, actor: ACTOR, source: 'manual',
    });

    expect(result.onHand).toBe(12);
    expect(result.available).toBe(12);
    const [record, txn, condition] = repo.putWithTransaction.mock.calls[0] as [
      InventoryRecord, InventoryTransaction, { expectedUpdatedAt?: string }
    ];
    expect(record.onHand).toBe(12);
    expect(txn.previousQty).toBe(0);
    expect(txn.newQty).toBe(12);
    expect(txn.deltaQty).toBe(12);
    expect(condition).toEqual({}); // create → no expectedUpdatedAt
  });

  // 3. known SKU + existing warehouse (update) + 4. absolute increase
  it('updates an existing warehouse with absolute increase (10 -> 15 => delta +5)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord({ onHand: 10, available: 10 }));

    await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 15, actor: ACTOR, source: 'api',
    });

    const [record, txn, condition] = repo.putWithTransaction.mock.calls[0] as [
      InventoryRecord, InventoryTransaction, { expectedUpdatedAt?: string }
    ];
    expect(record.onHand).toBe(15);
    expect(txn.previousQty).toBe(10);
    expect(txn.newQty).toBe(15);
    expect(txn.deltaQty).toBe(5);
    expect(condition.expectedUpdatedAt).toBe('2024-01-01T00:00:00.000Z'); // optimistic lock
  });

  // 5. absolute decrease
  it('updates an existing warehouse with absolute decrease (10 -> 6 => delta -4)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord({ onHand: 10, available: 10 }));

    await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 6, actor: ACTOR, source: 'manual',
    });

    const [, txn] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(txn.previousQty).toBe(10);
    expect(txn.newQty).toBe(6);
    expect(txn.deltaQty).toBe(-4);
  });

  // 6. zero-stock creation
  it('creates a zero-stock record (onHand=0) with a ledger entry (prev=0, delta=0, new=0)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(null);

    const result = await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 0, actor: ACTOR, source: 'manual',
    });

    expect(result.onHand).toBe(0);
    expect(result.available).toBe(0);
    const [, txn] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(txn.previousQty).toBe(0);
    expect(txn.deltaQty).toBe(0);
    expect(txn.newQty).toBe(0);
    expect(repo.putWithTransaction).toHaveBeenCalledTimes(1); // ledger entry written
  });

  // 7. zero-stock update (10 -> 0)
  it('updates an existing record to zero stock (10 -> 0 => delta -10) with a ledger entry', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord({ onHand: 10, available: 10 }));

    const result = await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 0, actor: ACTOR, source: 'manual',
    });

    expect(result.onHand).toBe(0);
    const [, txn] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(txn.previousQty).toBe(10);
    expect(txn.deltaQty).toBe(-10);
    expect(txn.newQty).toBe(0);
  });

  // 8. negative quantity (invalid input) + non-negative invariant
  it('rejects a negative onHand with INVALID_QUANTITY (400) and no writes', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);

    const err = await service
      .updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: -3, actor: ACTOR, source: 'manual' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidQuantityError);
    expect(err.status).toBe(400);
    expect(repo.putWithTransaction).not.toHaveBeenCalled();
  });

  it('rejects a non-integer onHand with INVALID_QUANTITY (400)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    const err = await service
      .updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 2.5, actor: ACTOR, source: 'manual' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidQuantityError);
    expect(repo.putWithTransaction).not.toHaveBeenCalled();
  });

  it('rejects when existing reserved would push available below zero (NEGATIVE_STOCK 409)', async () => {
    // Defensive: if a record somehow has reserved > requested onHand, available < 0.
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord({ onHand: 10, reserved: 8, available: 2 }));

    const err = await service
      .updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 5, actor: ACTOR, source: 'manual' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(NegativeStockError);
    expect(err.code).toBe('INVENTORY_NEGATIVE_STOCK');
    expect(err.status).toBe(409);
    expect(repo.putWithTransaction).not.toHaveBeenCalled();
  });

  // 9. ledger calculation (actor/source/timestamp/ids)
  it('builds a complete ledger entry (actor, source, ids, timestamp)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord({ onHand: 4, available: 4 }));

    await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 9, actor: ACTOR, source: 'manual',
    });

    const [, txn] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(txn.tenantId).toBe(TENANT);
    expect(txn.sku).toBe(SKU);
    expect(txn.warehouseId).toBe(WH);
    expect(txn.actor).toBe(ACTOR);
    expect(txn.source).toBe('manual');
    expect(typeof txn.txnId).toBe('string');
    expect(txn.txnId.length).toBeGreaterThan(0);
    expect(txn.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // record.updatedAt matches the ledger timestamp
    const [record] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(record.updatedAt).toBe(txn.timestamp);
  });

  // 10. tenant isolation
  it('passes the trusted tenantId to both the SKU lookup and the repository', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(null);

    await service.updateStock('tenant-XYZ', {
      sku: SKU, warehouseId: WH, onHand: 1, actor: ACTOR, source: 'manual',
    });

    expect(products.findBySku).toHaveBeenCalledWith('tenant-XYZ', SKU);
    expect(repo.get).toHaveBeenCalledWith('tenant-XYZ', SKU, WH, true);
    const [record, txn] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(record.tenantId).toBe('tenant-XYZ');
    expect(txn.tenantId).toBe('tenant-XYZ');
  });

  // 11. archived product accepted
  it('accepts a stock update for an archived product (archived counts as existing)', async () => {
    products.findBySku.mockResolvedValue({ ...PRODUCT_EXISTS, lifecycleState: 'archived' });
    repo.get.mockResolvedValue(existingRecord());

    const result = await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 7, actor: ACTOR, source: 'manual',
    });
    expect(result.onHand).toBe(7);
    expect(repo.putWithTransaction).toHaveBeenCalledTimes(1);
  });

  // 12. concurrent update error
  it('maps a repository concurrency failure to INVENTORY_CONCURRENT_UPDATE (409)', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord());
    repo.putWithTransaction.mockRejectedValue(new InventoryConcurrencyError(TENANT, SKU, WH));

    const err = await service
      .updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 11, actor: ACTOR, source: 'manual' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(InventoryConcurrentUpdateError);
    expect(err.code).toBe('INVENTORY_CONCURRENT_UPDATE');
    expect(err.status).toBe(409);
  });

  // 13. source validation
  it('rejects a non-Phase-8A source with INVALID_SOURCE (400) before any lookup', async () => {
    const err = await service
      .updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 5, actor: ACTOR, source: 'feed' as never })
      .catch((e) => e);
    expect(err).toBeInstanceOf(InvalidSourceError);
    expect(err.status).toBe(400);
    expect(products.findBySku).not.toHaveBeenCalled();
    expect(repo.putWithTransaction).not.toHaveBeenCalled();
  });

  it('accepts each allowed Phase 8A source', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(null);
    for (const source of ['manual', 'api', 'csv-import'] as const) {
      await expect(
        service.updateStock(TENANT, { sku: SKU, warehouseId: WH, onHand: 1, actor: ACTOR, source })
      ).resolves.toBeDefined();
    }
  });

  // 14. atomic repository call
  it('performs exactly one atomic putWithTransaction per successful update', async () => {
    products.findBySku.mockResolvedValue(PRODUCT_EXISTS);
    repo.get.mockResolvedValue(existingRecord());

    await service.updateStock(TENANT, {
      sku: SKU, warehouseId: WH, onHand: 20, actor: ACTOR, source: 'manual',
    });
    expect(repo.putWithTransaction).toHaveBeenCalledTimes(1);
    // record + transaction + condition passed together (single atomic call)
    const call = repo.putWithTransaction.mock.calls[0] as unknown[];
    expect(call).toHaveLength(3);
  });
});

describe('InventoryService.importCsvRows', () => {
  let repo: ReturnType<typeof makeRepo>;
  let products: ReturnType<typeof makeProductLookup>;
  let service: InventoryService;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = makeRepo();
    products = makeProductLookup();
    service = new InventoryService(repo, products);
    repo.get.mockResolvedValue(null);
    repo.putWithTransaction.mockImplementation(async (record: InventoryRecord) => record);
  });

  it('processes rows independently with partial success (valid committed, invalid reported)', async () => {
    // Row 1 known SKU, row 2 unknown SKU, row 3 negative qty.
    products.findBySku.mockImplementation(async (_tenant: string, sku: string) =>
      sku === 'SKU-ok' ? PRODUCT_EXISTS : null
    );

    const result = await service.importCsvRows(
      TENANT,
      [
        { rowNumber: 1, sku: 'SKU-ok', warehouseId: WH, onHand: 5 },
        { rowNumber: 2, sku: 'SKU-missing', warehouseId: WH, onHand: 5 },
        { rowNumber: 3, sku: 'SKU-ok', warehouseId: WH, onHand: -1 },
      ],
      ACTOR
    );

    expect(result.summary).toEqual({ totalRows: 3, accepted: 1, rejected: 2 });
    const r1 = result.results.find((r) => r.rowNumber === 1)!;
    const r2 = result.results.find((r) => r.rowNumber === 2)!;
    const r3 = result.results.find((r) => r.rowNumber === 3)!;
    expect(r1.status).toBe('accepted');
    expect(r1.txnId).toBeDefined();
    expect(r2.status).toBe('rejected');
    expect(r2.error!.code).toBe('PRODUCT_NOT_FOUND');
    expect(r3.status).toBe('rejected');
    expect(r3.error!.code).toBe('INVALID_QUANTITY');
    // Only the one valid row hit the atomic write.
    expect(repo.putWithTransaction).toHaveBeenCalledTimes(1);
    // Every CSV write uses source 'csv-import'.
    const [, txn] = repo.putWithTransaction.mock.calls[0] as [InventoryRecord, InventoryTransaction, unknown];
    expect(txn.source).toBe('csv-import');
  });
});
