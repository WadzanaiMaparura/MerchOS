export class ProductAlreadyExistsError extends Error {
  public readonly code = 'PRODUCT_ALREADY_EXISTS';
  constructor(tenantId: string, productId: string) {
    super(`Product already exists: tenantId=${tenantId}, productId=${productId}`);
    this.name = 'ProductAlreadyExistsError';
  }
}

export class ProductNotFoundError extends Error {
  public readonly code = 'PRODUCT_NOT_FOUND';
  constructor(tenantId: string, productId: string) {
    super(`Product not found: tenantId=${tenantId}, productId=${productId}`);
    this.name = 'ProductNotFoundError';
  }
}

export class ProductPersistenceError extends Error {
  public readonly code = 'PRODUCT_PERSISTENCE_ERROR';
  public override readonly cause: Error | undefined;
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'ProductPersistenceError';
    this.cause = cause;
  }
}
