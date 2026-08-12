// API layer barrel exports
export { handler as createProductHandler, setProductService as setCreateProductService } from './handlers/create-product';
export { handler as getProductHandler, setProductService as setGetProductService } from './handlers/get-product';
export { handler as listProductsHandler, setProductService as setListProductsService } from './handlers/list-products';
export { handler as updateProductHandler, setProductService as setUpdateProductService } from './handlers/update-product';
export { handler as archiveProductHandler, setProductService as setArchiveProductService } from './handlers/archive-product';
export { mapErrorToResponse } from './error-mapper';
export { extractTenantContext } from './tenant-context';
export type { TenantContext } from './tenant-context';
export type {
  CreateProductRequest,
  UpdateProductRequest,
  ListProductsQuery,
  ProductResponse,
  ProductListResponse,
  ErrorResponse,
} from './types';
