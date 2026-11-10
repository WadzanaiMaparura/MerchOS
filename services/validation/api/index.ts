/**
 * Validation Service API layer — Lambda handlers + service boundary.
 */

export {
  ValidationService,
  SchemaNotFoundError,
  type ValidateRequest,
  type SchemaRegistryPort,
} from './validation-service.js';
export { handler, setValidationService } from './handlers/validate-product.js';
