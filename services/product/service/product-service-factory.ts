/**
 * ProductService lazy-singleton factory.
 *
 * Mirrors the Auth service's lazy-singleton pattern (see
 * services/auth/utils/cognito-client.ts): the ProductService (backed by a
 * ProductRepository that reads PRODUCTS_TABLE from the environment) is
 * constructed on first use and cached in a module-scoped variable so the
 * instance — and its underlying DynamoDB connection pool — is reused across
 * warm Lambda invocations.
 *
 * ProductRepository requires no constructor arguments in Lambda: it builds its
 * own DynamoDBClient (region/credentials from the execution environment) and
 * reads the table name from the PRODUCTS_TABLE env var.
 */

import { ProductService } from './product-service';
import { ProductRepository } from '../repository/product-repository';

let instance: ProductService | null = null;

/**
 * Returns a lazily-constructed, module-cached ProductService.
 *
 * Used by Lambda handlers in production. Tests may override the instance via
 * setProductServiceInstance() (or continue using each handler's existing
 * setProductService() test seam).
 */
export function getProductService(): ProductService {
  if (!instance) {
    instance = new ProductService(new ProductRepository());
  }
  return instance;
}

/**
 * Overrides the cached ProductService instance.
 * Intended for tests that want the factory to return a specific instance.
 */
export function setProductServiceInstance(service: ProductService): void {
  instance = service;
}

/**
 * Clears the cached ProductService instance.
 * Useful for tests to force a fresh construction on the next getProductService() call.
 */
export function resetProductService(): void {
  instance = null;
}
