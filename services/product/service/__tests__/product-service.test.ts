import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanonicalProduct } from '@merch-os/types';
import { ProductService } from '../product-service';
import { ProductRepository } from '../../repository/product-repository';
import { ProductNotFoundError as RepoNotFoundError, ProductAlreadyExistsError as RepoAlreadyExistsError, ProductPersistenceError as RepoPersistenceError } from '../../repository/errors';
import {
  ProductNotFoundError,
  ProductAlreadyExistsError,
  ProductPersistenceError,
  ProductSkuAlreadyExistsError,
  ProductValidationError,
  InvalidProductLifecycleError,
} from '../errors';
import { CreateProductInput, UpdateProductInput } from '../types';

// ---------------------------------------------------------------------------
// Mock repository
// ---------------------------------------------------------------------------

function createMockRepository() {
  return {
    create: vi.fn(),
    get: vi.fn(),
    listByTenant: vi.fn(),
    findBySku: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  } as unknown as vi.Mocked<ProductRepository>;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-abc-123';
const PRODUCT_ID = 'prod-uuid-456';

function makeCanonicalProduct(
  overrides?: Partial<CanonicalProduct>
): CanonicalProduct {
  return {
    productId: PRODUCT_ID,
    tenantId: TENANT_ID,
    content: {
      title: 'Test Product',
      shortDescription: 'A short desc',
      longDescription: 'A long description',
      bulletPoints: ['Point 1', 'Point 2'],
      brand: 'TestBrand',
      manufacturer: 'TestMfg',
      sku: 'SKU-001',
      barcode: '1234567890123',
      mpn: 'MPN-001',
      weight: 500,
      weightUnit: 'g',
      length: 10,
      width: 5,
      height: 3,
      dimensionUnit: 'cm',
      materials: ['cotton'],
      attributes: { color: 'red' },
      imageRefs: [],
      variants: [],
    },
    commercial: {
      sellingPrice: 199.99,
      rrp: 249.99,
      salePrice: null,
      currency: 'ZAR',
      stockQuantity: 100,
      lowStockThreshold: 10,
      fulfilmentMethod: 'warehouse',
      leadtimeDays: 3,
      handlingTimeDays: 1,
      listingStatus: 'draft',
      saleStartDate: null,
      saleEndDate: null,
    },
    platformSpecific: {
      platformIdentifiers: {},
      categoryMappings: {},
      metadata: {},
      exportHistory: {},
    },
    lifecycleState: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeCreateInput(
  overrides?: Partial<CreateProductInput>
): CreateProductInput {
  return {
    title: 'Test Product',
    sku: 'SKU-001',
    brand: 'TestBrand',
    shortDescription: 'A short desc',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductService', () => {
  let repo: vi.Mocked<ProductRepository>;
  let service: ProductService;

  beforeEach(() => {
    repo = createMockRepository();
    service = new ProductService(repo as unknown as ProductRepository);
  });

  // =========================================================================
  // createProduct
  // =========================================================================

  describe('createProduct', () => {
    it('should create a product successfully', async () => {
      const input = makeCreateInput();
      const expectedProduct = makeCanonicalProduct();

      repo.findBySku.mockResolvedValue(null);
      repo.create.mockResolvedValue(expectedProduct);

      const result = await service.createProduct(TENANT_ID, input);

      expect(repo.findBySku).toHaveBeenCalledWith(TENANT_ID, input.sku);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          content: expect.objectContaining({
            title: input.title,
            sku: input.sku,
            brand: input.brand,
          }),
          lifecycleState: 'draft',
        })
      );
      expect(result).toEqual(expectedProduct);
    });

    it('should generate a UUID for productId', async () => {
      const input = makeCreateInput();

      repo.findBySku.mockResolvedValue(null);
      repo.create.mockImplementation(async (product) => ({
        ...product,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }));

      await service.createProduct(TENANT_ID, input);

      const createdProduct = repo.create.mock.calls[0]![0];
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(createdProduct.productId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should set default commercial values when not provided', async () => {
      const input = makeCreateInput();

      repo.findBySku.mockResolvedValue(null);
      repo.create.mockImplementation(async (product) => product);

      await service.createProduct(TENANT_ID, input);

      const createdProduct = repo.create.mock.calls[0]![0];
      expect(createdProduct.commercial.currency).toBe('ZAR');
      expect(createdProduct.commercial.stockQuantity).toBe(0);
      expect(createdProduct.commercial.listingStatus).toBe('draft');
      expect(createdProduct.commercial.sellingPrice).toBeNull();
    });

    it('should throw ProductSkuAlreadyExistsError when SKU is duplicate', async () => {
      const input = makeCreateInput({ sku: 'EXISTING-SKU' });
      const existingProduct = makeCanonicalProduct({
        content: {
          ...makeCanonicalProduct().content,
          sku: 'EXISTING-SKU',
        },
      });

      repo.findBySku.mockResolvedValue(existingProduct);

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductSkuAlreadyExistsError);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('should throw ProductValidationError when title is missing', async () => {
      const input = makeCreateInput({ title: '' });

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductValidationError);

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow('Product title is required');

      expect(repo.findBySku).not.toHaveBeenCalled();
    });

    it('should throw ProductValidationError when sku is missing', async () => {
      const input = makeCreateInput({ sku: '' });

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductValidationError);

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow('Product SKU is required');
    });

    it('should throw ProductValidationError when brand is missing', async () => {
      const input = makeCreateInput({ brand: '' });

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductValidationError);

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow('Product brand is required');
    });

    it('should throw ProductValidationError when title is whitespace only', async () => {
      const input = makeCreateInput({ title: '   ' });

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductValidationError);
    });

    it('should set empty platformSpecific defaults', async () => {
      const input = makeCreateInput();

      repo.findBySku.mockResolvedValue(null);
      repo.create.mockImplementation(async (product) => product);

      await service.createProduct(TENANT_ID, input);

      const createdProduct = repo.create.mock.calls[0]![0];
      expect(createdProduct.platformSpecific).toEqual({
        platformIdentifiers: {},
        categoryMappings: {},
        metadata: {},
        exportHistory: {},
      });
    });
  });

  // =========================================================================
  // getProduct
  // =========================================================================

  describe('getProduct', () => {
    it('should return the product when found', async () => {
      const product = makeCanonicalProduct();
      repo.get.mockResolvedValue(product);

      const result = await service.getProduct(TENANT_ID, PRODUCT_ID);

      expect(repo.get).toHaveBeenCalledWith(TENANT_ID, PRODUCT_ID);
      expect(result).toEqual(product);
    });

    it('should throw ProductNotFoundError when product does not exist', async () => {
      repo.get.mockResolvedValue(null);

      await expect(
        service.getProduct(TENANT_ID, 'non-existent-id')
      ).rejects.toThrow(ProductNotFoundError);
    });
  });

  // =========================================================================
  // listProducts
  // =========================================================================

  describe('listProducts', () => {
    it('should delegate to repository and return results', async () => {
      const products = [makeCanonicalProduct()];
      repo.listByTenant.mockResolvedValue({ items: products });

      const result = await service.listProducts(TENANT_ID);

      expect(repo.listByTenant).toHaveBeenCalledWith(TENANT_ID, undefined);
      expect(result.items).toEqual(products);
    });

    it('should pass pagination options to repository', async () => {
      const options = { limit: 10, nextToken: 'abc123' };
      repo.listByTenant.mockResolvedValue({
        items: [],
        nextToken: 'next-token',
      });

      const result = await service.listProducts(TENANT_ID, options);

      expect(repo.listByTenant).toHaveBeenCalledWith(TENANT_ID, options);
      expect(result.nextToken).toBe('next-token');
    });

    it('should return empty list when no products exist', async () => {
      repo.listByTenant.mockResolvedValue({ items: [] });

      const result = await service.listProducts(TENANT_ID);

      expect(result.items).toEqual([]);
      expect(result.nextToken).toBeUndefined();
    });
  });

  // =========================================================================
  // updateProduct
  // =========================================================================

  describe('updateProduct', () => {
    it('should update a product successfully', async () => {
      const existing = makeCanonicalProduct();
      const updateInput: UpdateProductInput = { title: 'Updated Title' };
      const updatedProduct = makeCanonicalProduct({
        content: { ...existing.content, title: 'Updated Title' },
      });

      repo.get.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updatedProduct);

      const result = await service.updateProduct(
        TENANT_ID,
        PRODUCT_ID,
        updateInput
      );

      expect(repo.get).toHaveBeenCalledWith(TENANT_ID, PRODUCT_ID);
      expect(repo.update).toHaveBeenCalledWith(
        TENANT_ID,
        PRODUCT_ID,
        expect.objectContaining({
          content: expect.objectContaining({ title: 'Updated Title' }),
        })
      );
      expect(result).toEqual(updatedProduct);
    });

    it('should throw ProductNotFoundError when product does not exist', async () => {
      repo.get.mockResolvedValue(null);

      await expect(
        service.updateProduct(TENANT_ID, 'non-existent', { title: 'X' })
      ).rejects.toThrow(ProductNotFoundError);

      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should throw InvalidProductLifecycleError when product is archived', async () => {
      const archived = makeCanonicalProduct({ lifecycleState: 'archived' });
      repo.get.mockResolvedValue(archived);

      await expect(
        service.updateProduct(TENANT_ID, PRODUCT_ID, { title: 'X' })
      ).rejects.toThrow(InvalidProductLifecycleError);

      await expect(
        service.updateProduct(TENANT_ID, PRODUCT_ID, { title: 'X' })
      ).rejects.toThrow('Cannot update an archived product');

      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should preserve immutable fields (tenantId, productId, createdAt)', async () => {
      const existing = makeCanonicalProduct();
      repo.get.mockResolvedValue(existing);
      repo.update.mockImplementation(async (_t, _p, product) => product);

      await service.updateProduct(TENANT_ID, PRODUCT_ID, {
        title: 'New Title',
      });

      const merged = repo.update.mock.calls[0]![2];
      expect(merged.tenantId).toBe(TENANT_ID);
      expect(merged.productId).toBe(PRODUCT_ID);
      expect(merged.createdAt).toBe(existing.createdAt);
    });

    it('should allow SKU change when new SKU is unique', async () => {
      const existing = makeCanonicalProduct();
      repo.get.mockResolvedValue(existing);
      repo.findBySku.mockResolvedValue(null);
      repo.update.mockImplementation(async (_t, _p, product) => product);

      const result = await service.updateProduct(TENANT_ID, PRODUCT_ID, {
        sku: 'NEW-SKU',
      });

      expect(repo.findBySku).toHaveBeenCalledWith(TENANT_ID, 'NEW-SKU');
      expect(result.content.sku).toBe('NEW-SKU');
    });

    it('should allow update when SKU is unchanged (same SKU submitted)', async () => {
      const existing = makeCanonicalProduct(); // SKU = 'SKU-001'
      repo.get.mockResolvedValue(existing);
      repo.update.mockImplementation(async (_t, _p, product) => product);

      // Update with the SAME SKU as existing — should NOT trigger uniqueness check
      const result = await service.updateProduct(TENANT_ID, PRODUCT_ID, {
        sku: 'SKU-001', // Same as existing.content.sku
      });

      // findBySku should NOT be called because SKU didn't change
      expect(repo.findBySku).not.toHaveBeenCalled();
      expect(result.content.sku).toBe('SKU-001');
    });

    it('should throw ProductSkuAlreadyExistsError when SKU belongs to another product', async () => {
      const existing = makeCanonicalProduct();
      const otherProduct = makeCanonicalProduct({
        productId: 'other-product-id',
        content: { ...existing.content, sku: 'TAKEN-SKU' },
      });

      repo.get.mockResolvedValue(existing);
      repo.findBySku.mockResolvedValue(otherProduct);

      await expect(
        service.updateProduct(TENANT_ID, PRODUCT_ID, { sku: 'TAKEN-SKU' })
      ).rejects.toThrow(ProductSkuAlreadyExistsError);

      expect(repo.update).not.toHaveBeenCalled();
    });

    it('should not check SKU uniqueness when SKU is unchanged', async () => {
      const existing = makeCanonicalProduct();
      repo.get.mockResolvedValue(existing);
      repo.update.mockImplementation(async (_t, _p, product) => product);

      await service.updateProduct(TENANT_ID, PRODUCT_ID, {
        sku: existing.content.sku, // Same SKU
      });

      expect(repo.findBySku).not.toHaveBeenCalled();
    });

    it('should preserve lifecycleState during update', async () => {
      const existing = makeCanonicalProduct({ lifecycleState: 'ready' });
      repo.get.mockResolvedValue(existing);
      repo.update.mockImplementation(async (_t, _p, product) => product);

      const result = await service.updateProduct(TENANT_ID, PRODUCT_ID, {
        title: 'Updated',
      });

      expect(result.lifecycleState).toBe('ready');
    });

    it('should merge commercial fields correctly', async () => {
      const existing = makeCanonicalProduct();
      repo.get.mockResolvedValue(existing);
      repo.update.mockImplementation(async (_t, _p, product) => product);

      const result = await service.updateProduct(TENANT_ID, PRODUCT_ID, {
        sellingPrice: 299.99,
        stockQuantity: 50,
      });

      expect(result.commercial.sellingPrice).toBe(299.99);
      expect(result.commercial.stockQuantity).toBe(50);
      // Unchanged fields preserved
      expect(result.commercial.currency).toBe('ZAR');
      expect(result.commercial.rrp).toBe(249.99);
    });
  });

  // =========================================================================
  // archiveProduct
  // =========================================================================

  describe('archiveProduct', () => {
    it('should archive a product successfully', async () => {
      const archivedProduct = makeCanonicalProduct({
        lifecycleState: 'archived',
      });
      repo.delete.mockResolvedValue(archivedProduct);

      const result = await service.archiveProduct(TENANT_ID, PRODUCT_ID);

      expect(repo.delete).toHaveBeenCalledWith(TENANT_ID, PRODUCT_ID);
      expect(result.lifecycleState).toBe('archived');
    });

    it('should throw ProductNotFoundError when product does not exist', async () => {
      repo.delete.mockRejectedValue(
        new RepoNotFoundError(TENANT_ID, 'non-existent')
      );

      await expect(
        service.archiveProduct(TENANT_ID, 'non-existent')
      ).rejects.toThrow(ProductNotFoundError);
    });
  });

  // =========================================================================
  // Error Mapping (repository → service boundary)
  // =========================================================================

  describe('error mapping', () => {
    it('should map repository ProductAlreadyExistsError to service ProductAlreadyExistsError', async () => {
      const input = makeCreateInput();
      repo.findBySku.mockResolvedValue(null); // SKU check passes
      repo.create.mockRejectedValue(
        new RepoAlreadyExistsError(TENANT_ID, 'some-id')
      );

      // Must throw service-level ProductAlreadyExistsError
      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductAlreadyExistsError);

      // Must NOT be converted to ProductSkuAlreadyExistsError
      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.not.toThrow(ProductSkuAlreadyExistsError);
    });

    it('should map repository ProductPersistenceError to service ProductPersistenceError (NOT validation)', async () => {
      const input = makeCreateInput();
      repo.findBySku.mockResolvedValue(null);
      repo.create.mockRejectedValue(
        new RepoPersistenceError('DynamoDB write failed')
      );

      // Must throw service-level ProductPersistenceError
      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductPersistenceError);

      // Must NOT be converted to ProductValidationError
      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.not.toThrow(ProductValidationError);
    });

    it('should map repository ProductPersistenceError from update to service ProductPersistenceError', async () => {
      const existing = makeCanonicalProduct();
      repo.get.mockResolvedValue(existing);
      repo.update.mockRejectedValue(
        new RepoPersistenceError('DynamoDB conditional write failed')
      );

      await expect(
        service.updateProduct(TENANT_ID, PRODUCT_ID, { title: 'New Title' })
      ).rejects.toThrow(ProductPersistenceError);

      await expect(
        service.updateProduct(TENANT_ID, PRODUCT_ID, { title: 'New Title' })
      ).rejects.not.toThrow(ProductValidationError);
    });

    it('should map repository ProductPersistenceError from archive to service ProductPersistenceError', async () => {
      repo.delete.mockRejectedValue(
        new RepoPersistenceError('DynamoDB update failed')
      );

      await expect(
        service.archiveProduct(TENANT_ID, PRODUCT_ID)
      ).rejects.toThrow(ProductPersistenceError);

      await expect(
        service.archiveProduct(TENANT_ID, PRODUCT_ID)
      ).rejects.not.toThrow(ProductValidationError);
    });

    it('should map repository ProductNotFoundError from archive to service ProductNotFoundError', async () => {
      repo.delete.mockRejectedValue(
        new RepoNotFoundError(TENANT_ID, PRODUCT_ID)
      );

      await expect(
        service.archiveProduct(TENANT_ID, PRODUCT_ID)
      ).rejects.toThrow(ProductNotFoundError);
    });

    it('SKU conflict is separate from product-exists conflict', async () => {
      const input = makeCreateInput({ sku: 'TAKEN-SKU' });
      const otherProduct = makeCanonicalProduct({ productId: 'other-id' });
      repo.findBySku.mockResolvedValue(otherProduct);

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductSkuAlreadyExistsError);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('validation errors remain separate from persistence errors', async () => {
      const input = makeCreateInput({ title: '' });

      await expect(
        service.createProduct(TENANT_ID, input)
      ).rejects.toThrow(ProductValidationError);
    });
  });
});
