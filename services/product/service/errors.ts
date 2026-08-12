export class ProductNotFoundError extends Error {
  public readonly code = 'PRODUCT_NOT_FOUND';
  constructor(tenantId: string, productId: string) {
    super(`Product not found: tenantId=${tenantId}, productId=${productId}`);
    this.name = 'ProductNotFoundError';
  }
}

export class ProductSkuAlreadyExistsError extends Error {
  public readonly code = 'PRODUCT_SKU_ALREADY_EXISTS';
  constructor(tenantId: string, sku: string) {
    super(`SKU '${sku}' already exists for tenant: ${tenantId}`);
    this.name = 'ProductSkuAlreadyExistsError';
  }
}

export class ProductAlreadyExistsError extends Error {
  public readonly code = 'PRODUCT_ALREADY_EXISTS';
  constructor(tenantId: string, productId: string) {
    super(`Product already exists: tenantId=${tenantId}, productId=${productId}`);
    this.name = 'ProductAlreadyExistsError';
  }
}

export class ProductPersistenceError extends Error {
  public readonly code = 'PRODUCT_PERSISTENCE_ERROR';
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ProductPersistenceError';
    if (cause) this.cause = cause;
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
