/**
 * InventoryService lazy-singleton factory.
 *
 * Mirrors the established MerchOS composition pattern (see
 * services/product/service/product-service-factory.ts and
 * services/auth/utils/cognito-client.ts): the InventoryService — backed by a
 * real InventoryRepository and a real ProductRepository (for tenant-scoped SKU
 * validation via findBySku) — is constructed on first use and cached in a
 * module-scoped variable so the instance and its DynamoDB connection pools are
 * reused across warm Lambda invocations.
 *
 * The production composition root ACTUALLY constructs the dependencies; this is
 * not a test-only injection seam. Both repositories require no constructor
 * arguments in Lambda — they build their own DynamoDBClient and read their
 * table names from the environment (INVENTORY_TABLE / INVENTORY_TRANSACTIONS_TABLE
 * and PRODUCTS_TABLE respectively).
 *
 * Dependency direction is Inventory → Product (one-way). ProductRepository is
 * imported read-only; Product has no knowledge of Inventory.
 */

import { ProductRepository } from '../../product/repository/product-repository';
import { InventoryRepository } from '../repository/inventory-repository';
import { InventoryService } from './inventory-service';

let instance: InventoryService | null = null;

/**
 * Returns a lazily-constructed, module-cached InventoryService.
 * Used by Lambda handlers (R5) in production.
 */
export function getInventoryService(): InventoryService {
  if (!instance) {
    instance = new InventoryService(new InventoryRepository(), new ProductRepository());
  }
  return instance;
}

/**
 * Overrides the cached InventoryService instance.
 * Intended for tests that want the factory to return a specific instance.
 */
export function setInventoryServiceInstance(service: InventoryService): void {
  instance = service;
}

/**
 * Clears the cached InventoryService instance so the next getInventoryService()
 * call constructs a fresh one. Useful for tests.
 */
export function resetInventoryService(): void {
  instance = null;
}
