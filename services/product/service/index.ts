export { ProductService } from './product-service';
export { getProductService, setProductServiceInstance, resetProductService } from './product-service-factory';
export {
  ProductNotFoundError,
  ProductAlreadyExistsError,
  ProductPersistenceError,
  ProductSkuAlreadyExistsError,
  ProductValidationError,
  InvalidProductLifecycleError,
} from './errors';
export type { CreateProductInput, UpdateProductInput } from './types';
