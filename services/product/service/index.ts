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
export {
  assembleProductDto,
  assembleProductSummary,
  resolveUiLifecycleState,
} from './dto-mapper';
export {
  applySynthesis,
  DEFAULT_REVIEW_THRESHOLD,
} from './synthesis-glue';
export type { GlueGenerationResult, AppliedSynthesis } from './synthesis-glue';
export {
  getIntelligenceCaller,
  setIntelligenceCaller,
  resetIntelligenceCaller,
} from './intelligence-client';
export type { IntelligenceCaller, GenerateCall } from './intelligence-client';
export {
  toCanonical,
  toDto,
  isTransitionAllowed,
  assertTransition,
  ALLOWED_TRANSITIONS,
} from './lifecycle';
export type { CanonicalLifecycle } from './lifecycle';
