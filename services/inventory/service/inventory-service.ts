/**
 * InventoryService — Phase 8A business/domain logic for inventory.
 *
 * Owns business rules; delegates all persistence to InventoryRepository and
 * SKU existence checks to the Product domain (ProductRepository.findBySku).
 *
 * Rules enforced here:
 *  - SKU referential validation against Products (unknown SKU → 404). Archived
 *    products count as existing in Phase 8A (no lifecycle/event logic).
 *  - Absolute PUT semantics: onHand is set to the requested absolute value;
 *    the ledger records previousQty, deltaQty (newQty - previousQty), newQty.
 *  - Non-negative invariant: onHand ≥ 0, reserved ≥ 0, available ≥ 0, with
 *    available = onHand - reserved. reserved stays 0 in Phase 8A.
 *  - Every successful stock change writes exactly one ledger entry, atomically
 *    with the record (via repository.putWithTransaction).
 *  - Phase 8A sources only: manual | api | csv-import.
 *  - Repository concurrency failures surface as INVENTORY_CONCURRENT_UPDATE.
 *
 * Dependency direction is Inventory → Product (one-way). This service never
 * mutates products and holds only a narrow SKU-lookup contract.
 */

import { randomUUID } from 'node:crypto';
import type { InventoryRecord, InventoryTransaction } from '../../shared/types/inventory.types';
import {
  InventoryConcurrencyError,
  InventoryPersistenceError,
} from '../repository/errors';
import {
  ProductNotFoundError,
  NegativeStockError,
  InventoryConcurrentUpdateError,
  InvalidQuantityError,
  InvalidSourceError,
  InventoryServicePersistenceError,
} from './errors';
import {
  PHASE_8A_SOURCES,
  type InventoryUpdateSource,
  type UpdateStockInput,
  type CsvImportRow,
  type CsvImportRowResult,
  type CsvImportResult,
  type ProductSkuLookup,
  type InventoryPersistence,
} from './types';

export interface ListOptions {
  limit?: number;
  nextToken?: string;
}

export class InventoryService {
  private readonly repository: InventoryPersistence;
  private readonly productLookup: ProductSkuLookup;

  constructor(repository: InventoryPersistence, productLookup: ProductSkuLookup) {
    this.repository = repository;
    this.productLookup = productLookup;
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Get all warehouse records for a SKU within the tenant. */
  async getBySku(tenantId: string, sku: string): Promise<InventoryRecord[]> {
    try {
      return await this.repository.queryBySku(tenantId, sku);
    } catch (error) {
      throw this.wrapPersistence(error, `Failed to read inventory for SKU: ${sku}`);
    }
  }

  /** List a tenant's inventory records (paginated). */
  async listInventory(
    tenantId: string,
    options?: ListOptions
  ): Promise<{ items: InventoryRecord[]; nextToken?: string }> {
    try {
      return await this.repository.listByTenant(tenantId, options);
    } catch (error) {
      throw this.wrapPersistence(error, `Failed to list inventory for tenant: ${tenantId}`);
    }
  }

  /** List a SKU's immutable ledger history (paginated, newest first). */
  async listTransactions(
    tenantId: string,
    sku: string,
    options?: ListOptions
  ): Promise<{ items: InventoryTransaction[]; nextToken?: string }> {
    try {
      return await this.repository.listTransactionsBySku(tenantId, sku, options);
    } catch (error) {
      throw this.wrapPersistence(error, `Failed to list transactions for SKU: ${sku}`);
    }
  }

  // -------------------------------------------------------------------------
  // Mutation — absolute stock update (PUT / API / CSV row)
  // -------------------------------------------------------------------------

  /**
   * Apply an absolute on-hand stock update for a SKU + warehouse.
   *
   * Steps: validate source → validate quantity → validate SKU exists for the
   * tenant → read current record (strong consistency) → compute deltas →
   * enforce non-negative invariant → atomic record+ledger write.
   *
   * Returns the updated/created InventoryRecord. Throws typed domain errors on
   * any rule violation; no record or ledger write occurs on rejection.
   */
  async updateStock(tenantId: string, input: UpdateStockInput): Promise<InventoryRecord> {
    const { record } = await this.applyUpdate(tenantId, input);
    return record;
  }

  /**
   * Core absolute-update logic shared by the public updateStock() and CSV
   * import. Returns both the persisted record and the ledger entry it minted
   * so callers that need the txnId (CSV per-row result) can surface it without
   * a re-query.
   */
  private async applyUpdate(
    tenantId: string,
    input: UpdateStockInput
  ): Promise<{ record: InventoryRecord; transaction: InventoryTransaction }> {
    this.assertValidSource(input.source);
    this.assertValidQuantity(input.onHand);

    // SKU referential validation (Inventory → Product, read-only).
    const product = await this.lookupProductOrThrow(tenantId, input.sku);
    void product; // existence is all we need in Phase 8A (archived counts as existing)

    // Read current state with strong consistency (update path).
    const existing = await this.readForUpdate(tenantId, input.sku, input.warehouseId);

    const previousQty = existing ? existing.onHand : 0;
    const newQty = input.onHand;
    const deltaQty = newQty - previousQty;

    const reserved = existing ? existing.reserved : 0;
    const available = newQty - reserved;

    // Non-negative invariant.
    if (newQty < 0 || reserved < 0 || available < 0) {
      throw new NegativeStockError(input.sku, input.warehouseId, newQty);
    }

    const timestamp = new Date().toISOString();

    const record: InventoryRecord = {
      tenantId,
      sku: input.sku,
      warehouseId: input.warehouseId,
      onHand: newQty,
      reserved,
      available,
      updatedAt: timestamp,
    };

    const transaction: InventoryTransaction = {
      tenantId,
      txnId: randomUUID(),
      sku: input.sku,
      warehouseId: input.warehouseId,
      actor: input.actor,
      source: input.source,
      deltaQty,
      previousQty,
      newQty,
      timestamp,
    };

    // Create when no record exists yet; otherwise optimistic update keyed on
    // the updatedAt the service just read.
    const condition = existing ? { expectedUpdatedAt: existing.updatedAt } : {};

    try {
      const persisted = await this.repository.putWithTransaction(record, transaction, condition);
      return { record: persisted, transaction };
    } catch (error) {
      if (error instanceof InventoryConcurrencyError) {
        throw new InventoryConcurrentUpdateError(input.sku, input.warehouseId);
      }
      throw this.wrapPersistence(
        error,
        `Failed to persist inventory update: sku=${input.sku}, warehouseId=${input.warehouseId}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // CSV import — per-row, independent, partial success
  // -------------------------------------------------------------------------

  /**
   * Apply a batch of already-parsed CSV rows. Each row is processed
   * independently with its own atomic record+ledger write; a row's failure
   * never aborts other rows (partial success). The HTTP parsing/validation of
   * the raw CSV body and the response shaping belong to R5 — this method only
   * owns the per-row business rules.
   */
  async importCsvRows(
    tenantId: string,
    rows: CsvImportRow[],
    actor: string
  ): Promise<CsvImportResult> {
    const results: CsvImportRowResult[] = [];
    let accepted = 0;
    let rejected = 0;

    for (const row of rows) {
      try {
        const { transaction } = await this.applyUpdate(tenantId, {
          sku: row.sku,
          warehouseId: row.warehouseId,
          onHand: row.onHand,
          actor,
          source: 'csv-import',
        });
        accepted++;
        results.push({
          rowNumber: row.rowNumber,
          sku: row.sku,
          warehouseId: row.warehouseId,
          status: 'accepted',
          txnId: transaction.txnId,
        });
      } catch (error) {
        rejected++;
        const { code, message } = this.toRowError(error);
        results.push({
          rowNumber: row.rowNumber,
          sku: row.sku,
          warehouseId: row.warehouseId,
          status: 'rejected',
          error: { code, message },
        });
      }
    }

    return {
      summary: { totalRows: rows.length, accepted, rejected },
      results,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private assertValidSource(source: string): asserts source is InventoryUpdateSource {
    if (!PHASE_8A_SOURCES.includes(source as InventoryUpdateSource)) {
      throw new InvalidSourceError(source);
    }
  }

  private assertValidQuantity(onHand: number): void {
    if (!Number.isInteger(onHand)) {
      throw new InvalidQuantityError(`onHand must be an integer, received: ${onHand}`);
    }
    if (onHand < 0) {
      throw new InvalidQuantityError(`onHand must be non-negative, received: ${onHand}`);
    }
  }

  private async lookupProductOrThrow(tenantId: string, sku: string): Promise<unknown> {
    let product: unknown | null;
    try {
      product = await this.productLookup.findBySku(tenantId, sku);
    } catch (error) {
      throw this.wrapPersistence(error, `Failed to validate SKU against Products: ${sku}`);
    }
    if (product === null || product === undefined) {
      throw new ProductNotFoundError(tenantId, sku);
    }
    return product;
  }

  private async readForUpdate(
    tenantId: string,
    sku: string,
    warehouseId: string
  ): Promise<InventoryRecord | null> {
    try {
      return await this.repository.get(tenantId, sku, warehouseId, true);
    } catch (error) {
      throw this.wrapPersistence(
        error,
        `Failed to read current inventory: sku=${sku}, warehouseId=${warehouseId}`
      );
    }
  }

  private toRowError(error: unknown): { code: string; message: string } {
    if (
      error instanceof ProductNotFoundError ||
      error instanceof NegativeStockError ||
      error instanceof InvalidQuantityError ||
      error instanceof InvalidSourceError ||
      error instanceof InventoryConcurrentUpdateError ||
      error instanceof InventoryServicePersistenceError
    ) {
      return { code: error.code, message: error.message };
    }
    return { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
  }

  private wrapPersistence(error: unknown, message: string): InventoryServicePersistenceError {
    if (error instanceof InventoryPersistenceError) {
      return new InventoryServicePersistenceError(message, error);
    }
    return new InventoryServicePersistenceError(
      message,
      error instanceof Error ? error : undefined
    );
  }
}
