import type { InventoryRecord, InventoryTransaction } from '../../shared/types/inventory.types';

/** Options for listing a tenant's inventory records. */
export interface ListInventoryOptions {
  limit?: number; // default 50, max 100
  nextToken?: string; // opaque pagination token
}

/** A page of inventory records. */
export interface PaginatedInventory {
  items: InventoryRecord[];
  nextToken?: string;
}

/** Options for querying a SKU's transaction ledger history. */
export interface ListTransactionsOptions {
  limit?: number; // default 50, max 100
  nextToken?: string; // opaque pagination token
}

/** A page of transaction ledger entries (newest first). */
export interface PaginatedTransactions {
  items: InventoryTransaction[];
  nextToken?: string;
}

/**
 * Expected prior state for a concurrency-safe inventory write.
 *
 * The service supplies the record it believes it is updating so the repository
 * can build a ConditionExpression that fails if another writer changed the
 * record in the meantime.
 *
 * - For a create (no record yet): omit `expectedUpdatedAt` → the write asserts
 *   `attribute_not_exists(PK)`.
 * - For an update of an existing record: supply the `updatedAt` the service read
 *   → the write asserts the stored `updatedAt` still matches.
 */
export interface InventoryWriteCondition {
  expectedUpdatedAt?: string;
}
