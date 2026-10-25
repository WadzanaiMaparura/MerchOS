/**
 * Repository-layer error types for the Inventory persistence boundary.
 *
 * These represent persistence/concurrency failures only. Business-rule errors
 * (e.g. non-negative stock invariant, unknown-SKU validation) belong to the
 * Inventory Service layer, not here.
 */

/** Thrown when a conditional write detects a concurrent/stale update conflict. */
export class InventoryConcurrencyError extends Error {
  public readonly code = 'INVENTORY_CONCURRENT_UPDATE';
  constructor(tenantId: string, sku: string, warehouseId: string) {
    super(
      `Concurrent inventory update detected: tenantId=${tenantId}, sku=${sku}, warehouseId=${warehouseId}`
    );
    this.name = 'InventoryConcurrencyError';
  }
}

/** Thrown for any other DynamoDB persistence failure. */
export class InventoryPersistenceError extends Error {
  public readonly code = 'INVENTORY_PERSISTENCE_ERROR';
  public override readonly cause: Error | undefined;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'InventoryPersistenceError';
    this.cause = cause;
  }
}
