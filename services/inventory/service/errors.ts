/**
 * Service-layer (domain/business-rule) error types for Inventory.
 *
 * These carry a stable `code` and the intended HTTP `status` so the later API
 * layer (R5) can map them deterministically without re-deriving semantics.
 * Persistence/concurrency failures originate in the repository layer; the
 * service translates the repository's concurrency error into
 * InventoryConcurrentUpdateError below.
 */

/** Base class so handlers can branch on `instanceof InventoryServiceError`. */
export abstract class InventoryServiceError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
}

/** The SKU does not exist in the Products table for the tenant (unknown SKU). */
export class ProductNotFoundError extends InventoryServiceError {
  readonly code = 'PRODUCT_NOT_FOUND';
  readonly status = 404;
  constructor(tenantId: string, sku: string) {
    super(`Product not found for SKU: tenantId=${tenantId}, sku=${sku}`);
    this.name = 'ProductNotFoundError';
  }
}

/** An update would violate the non-negative stock invariant. */
export class NegativeStockError extends InventoryServiceError {
  readonly code = 'INVENTORY_NEGATIVE_STOCK';
  readonly status = 409;
  constructor(sku: string, warehouseId: string, attemptedOnHand: number) {
    super(
      `Update would make stock negative: sku=${sku}, warehouseId=${warehouseId}, attemptedOnHand=${attemptedOnHand}`
    );
    this.name = 'NegativeStockError';
  }
}

/** A concurrent/stale update was detected (optimistic-concurrency conflict). */
export class InventoryConcurrentUpdateError extends InventoryServiceError {
  readonly code = 'INVENTORY_CONCURRENT_UPDATE';
  readonly status = 409;
  constructor(sku: string, warehouseId: string) {
    super(`Concurrent inventory update detected: sku=${sku}, warehouseId=${warehouseId}`);
    this.name = 'InventoryConcurrentUpdateError';
  }
}

/** The requested quantity is not a non-negative integer. */
export class InvalidQuantityError extends InventoryServiceError {
  readonly code = 'INVALID_QUANTITY';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

/** The update `source` is not an allowed Phase 8A source. */
export class InvalidSourceError extends InventoryServiceError {
  readonly code = 'INVALID_SOURCE';
  readonly status = 400;
  constructor(source: string) {
    super(`Unsupported inventory update source for Phase 8A: ${source}`);
    this.name = 'InvalidSourceError';
  }
}

/** An unexpected persistence failure bubbled up from the repository. */
export class InventoryServicePersistenceError extends InventoryServiceError {
  readonly code = 'INTERNAL_ERROR';
  readonly status = 500;
  public override readonly cause: Error | undefined;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'InventoryServicePersistenceError';
    this.cause = cause;
  }
}
