export { InventoryService } from './inventory-service';
export type { ListOptions } from './inventory-service';
export {
  getInventoryService,
  setInventoryServiceInstance,
  resetInventoryService,
} from './inventory-service-factory';
export {
  InventoryServiceError,
  ProductNotFoundError,
  NegativeStockError,
  InventoryConcurrentUpdateError,
  InvalidQuantityError,
  InvalidSourceError,
  InventoryServicePersistenceError,
} from './errors';
export type {
  InventoryUpdateSource,
  UpdateStockInput,
  CsvImportRow,
  CsvImportRowResult,
  CsvImportResult,
  ProductSkuLookup,
  InventoryPersistence,
} from './types';
export { PHASE_8A_SOURCES } from './types';
