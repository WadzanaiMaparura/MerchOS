export class ProductSkuAlreadyExistsError extends Error {
  public readonly code = 'PRODUCT_SKU_ALREADY_EXISTS';
  constructor(tenantId: string, sku: string) {
    super(`SKU '${sku}' already exists for tenant: ${tenantId}`);
    this.name = 'ProductSkuAlreadyExistsError';
  }
}

export class ProductValidationError extends Error {
  public readonly code = 'PRODUCT_VALIDATION_ERROR';
  public readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ProductValidationError';
    this.field = field;
  }
}

export class InvalidProductLifecycleError extends Error {
  public readonly code = 'INVALID_PRODUCT_LIFECYCLE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidProductLifecycleError';
  }
}
