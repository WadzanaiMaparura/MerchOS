import type { InventoryRecord, InventoryTransaction } from '../../shared/types/inventory.types';

/**
 * Phase 8A allowed inventory update sources. A subset of the shared
 * InventoryTransactionSource union; feed/whatsapp/order/cancellation are
 * deferred and rejected by the service.
 */
export type InventoryUpdateSource = 'manual' | 'api' | 'csv-import';

export const PHASE_8A_SOURCES: readonly InventoryUpdateSource[] = [
  'manual',
  'api',
  'csv-import',
];

/**
 * Input for an absolute stock update (PUT semantics): set `onHand` to an
 * absolute, non-negative integer for a given SKU + warehouse.
 */
export interface UpdateStockInput {
  sku: string;
  warehouseId: string;
  /** Absolute target on-hand quantity (non-negative integer). */
  onHand: number;
  /** Who/what initiated the change (JWT sub, or a system identifier). */
  actor: string;
  /** Phase 8A source; validated by the service. */
  source: InventoryUpdateSource;
}

/** One row of a CSV import, already parsed by the R5 HTTP layer. */
export interface CsvImportRow {
  rowNumber: number;
  sku: string;
  warehouseId: string;
  onHand: number;
}

/** Per-row result of a CSV import (partial-success semantics). */
export interface CsvImportRowResult {
  rowNumber: number;
  sku: string;
  warehouseId: string;
  status: 'accepted' | 'rejected';
  /** Present when accepted — the ledger entry id (domain field name). */
  txnId?: string;
  /** Present when rejected. */
  error?: { code: string; message: string };
}

/** Aggregate result of a CSV import. */
export interface CsvImportResult {
  summary: { totalRows: number; accepted: number; rejected: number };
  results: CsvImportRowResult[];
}

/**
 * Narrow contract the Inventory Service needs from the Product domain:
 * tenant-scoped SKU existence lookup. Satisfied by
 * ProductRepository.findBySku(tenantId, sku). Kept minimal to keep the
 * dependency one-way (Inventory → Product) and avoid importing Product's full
 * type surface into the service.
 */
export interface ProductSkuLookup {
  findBySku(tenantId: string, sku: string): Promise<unknown | null>;
}

/**
 * Persistence contract the Inventory Service needs from the repository layer.
 * Satisfied by InventoryRepository.
 */
export interface InventoryPersistence {
  get(
    tenantId: string,
    sku: string,
    warehouseId: string,
    consistentRead?: boolean
  ): Promise<InventoryRecord | null>;
  queryBySku(tenantId: string, sku: string): Promise<InventoryRecord[]>;
  listByTenant(
    tenantId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<{ items: InventoryRecord[]; nextToken?: string }>;
  listTransactionsBySku(
    tenantId: string,
    sku: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<{ items: InventoryTransaction[]; nextToken?: string }>;
  putWithTransaction(
    record: InventoryRecord,
    transaction: InventoryTransaction,
    condition: { expectedUpdatedAt?: string }
  ): Promise<InventoryRecord>;
}
