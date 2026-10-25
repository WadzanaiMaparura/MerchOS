// Inventory API layer — barrel exports (handlers + helpers).

export {
  handler as listInventoryHandler,
  setInventoryService as setListInventoryService,
} from './handlers/list-inventory';
export {
  handler as getInventoryHandler,
  setInventoryService as setGetInventoryService,
} from './handlers/get-inventory';
export {
  handler as updateInventoryHandler,
  setInventoryService as setUpdateInventoryService,
} from './handlers/update-inventory';
export {
  handler as importInventoryHandler,
  setInventoryService as setImportInventoryService,
} from './handlers/import-inventory';
export {
  handler as listTransactionsHandler,
  setInventoryService as setListTransactionsService,
} from './handlers/list-transactions';

export { mapErrorToResponse, ApiErrors } from './error-mapper';
export { updateInventorySchema, paginationQuerySchema } from './schemas';
export {
  parseInventoryCsv,
  CsvContractError,
  CSV_MAX_ROWS,
  CSV_MAX_BYTES,
  CSV_REQUIRED_HEADERS,
} from './csv-parser';
