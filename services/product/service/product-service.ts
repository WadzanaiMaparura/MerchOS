/**
 * ProductService — Business logic layer for MerchOS product operations.
 *
 * Sits between the API/application layer and the ProductRepository.
 * Owns: validation, SKU uniqueness, lifecycle rules, immutable field protection.
 * Does NOT contain: DynamoDB calls, marketplace logic, pricing rules, Cognito, S3.
 */

import { CanonicalProduct, Product, ProductSummary } from '@merch-os/types';
import { ProductRepository } from '../repository/product-repository';
import {
  ProductNotFoundError as RepoNotFoundError,
  ProductAlreadyExistsError as RepoAlreadyExistsError,
  ProductPersistenceError as RepoPersistenceError,
} from '../repository/errors';
import { ListProductsOptions, PaginatedProducts, ProductEnrichmentRecord } from '../repository/types';
import { CreateProductInput, UpdateProductInput } from './types';
import { assembleProductDto, assembleProductSummary } from './dto-mapper';
import { applySynthesis, type GlueGenerationResult } from './synthesis-glue';
import type { LifecycleTransition, LifecycleState, EnrichmentLayer } from '@merch-os/types';
import {
  ProductAlreadyExistsError,
  ProductNotFoundError,
  ProductPersistenceError,
  ProductSkuAlreadyExistsError,
  ProductValidationError,
  InvalidProductLifecycleError,
} from './errors';

export class ProductService {
  private readonly repository: ProductRepository;

  constructor(repository: ProductRepository) {
    this.repository = repository;
  }

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------

  async createProduct(
    tenantId: string,
    input: CreateProductInput
  ): Promise<CanonicalProduct> {
    // 1. Validate required fields
    this.validateCreateInput(input);

    // 2. Check SKU uniqueness
    const existingBySku = await this.repository.findBySku(tenantId, input.sku);
    if (existingBySku) {
      throw new ProductSkuAlreadyExistsError(tenantId, input.sku);
    }

    // 3. Generate productId
    const productId = crypto.randomUUID();

    // 4. Construct full CanonicalProduct
    const product: CanonicalProduct = {
      productId,
      tenantId,
      content: {
        title: input.title,
        shortDescription: input.shortDescription ?? null,
        longDescription: input.longDescription ?? null,
        bulletPoints: input.bulletPoints ?? [],
        brand: input.brand,
        manufacturer: input.manufacturer ?? null,
        sku: input.sku,
        barcode: input.barcode ?? null,
        mpn: input.mpn ?? null,
        weight: input.weight ?? null,
        weightUnit: input.weightUnit ?? null,
        length: input.length ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        dimensionUnit: input.dimensionUnit ?? null,
        materials: input.materials ?? [],
        attributes: input.attributes ?? {},
        imageRefs: [],
        variants: [],
      },
      commercial: {
        sellingPrice: input.sellingPrice ?? null,
        rrp: input.rrp ?? null,
        salePrice: null,
        currency: input.currency ?? 'ZAR',
        stockQuantity: input.stockQuantity ?? 0,
        lowStockThreshold: null,
        fulfilmentMethod: input.fulfilmentMethod ?? null,
        leadtimeDays: input.leadtimeDays ?? null,
        handlingTimeDays: null,
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
      createdAt: '', // Set by repository
      updatedAt: '', // Set by repository
    };

    // 5. Persist (map repository errors to service-level errors)
    try {
      const created = await this.repository.create(product);
      return created;
    } catch (error) {
      if (error instanceof RepoAlreadyExistsError) {
        throw new ProductAlreadyExistsError(tenantId, productId);
      }
      if (error instanceof RepoPersistenceError) {
        throw new ProductPersistenceError(
          (error as Error).message,
          error as Error
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Get
  // ---------------------------------------------------------------------------

  async getProduct(
    tenantId: string,
    productId: string
  ): Promise<CanonicalProduct> {
    const product = await this.repository.get(tenantId, productId);
    if (!product) {
      throw new ProductNotFoundError(tenantId, productId);
    }
    return product;
  }

  // ---------------------------------------------------------------------------
  // List
  // ---------------------------------------------------------------------------

  async listProducts(
    tenantId: string,
    options?: ListProductsOptions
  ): Promise<PaginatedProducts> {
    return this.repository.listByTenant(tenantId, options);
  }

  // ---------------------------------------------------------------------------
  // DTO assembly (canonical + enrichment → API DTOs)
  // ---------------------------------------------------------------------------

  /**
   * Returns the full `Product` API DTO: the canonical product stitched together
   * with its enrichment layer, lifecycle history, and precise UI lifecycle
   * state. Throws ProductNotFoundError if the product does not exist.
   */
  async getProductDto(tenantId: string, productId: string): Promise<Product> {
    const product = await this.repository.get(tenantId, productId);
    if (!product) {
      throw new ProductNotFoundError(tenantId, productId);
    }
    const enrichment = await this.repository.getEnrichment(tenantId, productId);
    return assembleProductDto(product, enrichment);
  }

  /**
   * Returns a page of `ProductSummary` DTOs (list view). Each summary reflects
   * the precise UI lifecycle state when an enrichment record exists.
   *
   * Enrichment is fetched per item; at launch page sizes (≤100) this is
   * acceptable. If list latency becomes a concern, denormalise
   * `uiLifecycleState` onto the product item or batch-get enrichment.
   */
  async listProductSummaries(
    tenantId: string,
    options?: ListProductsOptions
  ): Promise<{ items: ProductSummary[]; nextToken?: string }> {
    const page = await this.repository.listByTenant(tenantId, options);
    const summaries = await Promise.all(
      page.items.map(async (product) => {
        const enrichment = await this.repository.getEnrichment(
          tenantId,
          product.productId
        );
        return assembleProductSummary(product, enrichment);
      })
    );
    return page.nextToken !== undefined
      ? { items: summaries, nextToken: page.nextToken }
      : { items: summaries };
  }

  // ---------------------------------------------------------------------------
  // Enrichment + lifecycle (used by the synthesis glue and review loop)
  // ---------------------------------------------------------------------------

  /** Reads the enrichment record for a product (null if none). */
  async getEnrichment(
    tenantId: string,
    productId: string
  ): Promise<ProductEnrichmentRecord | null> {
    return this.repository.getEnrichment(tenantId, productId);
  }

  /** Writes the enrichment layer + precise UI lifecycle state for a product. */
  async putEnrichment(
    tenantId: string,
    productId: string,
    enrichment: EnrichmentLayer,
    uiLifecycleState: LifecycleState,
    lifecycleHistory: LifecycleTransition[]
  ): Promise<ProductEnrichmentRecord> {
    return this.repository.putEnrichment(tenantId, productId, {
      uiLifecycleState,
      enrichment,
      lifecycleHistory,
    });
  }

  /** Appends a lifecycle transition and sets the precise UI lifecycle state. */
  async appendLifecycleTransition(
    tenantId: string,
    productId: string,
    transition: LifecycleTransition,
    uiLifecycleState: LifecycleState
  ): Promise<ProductEnrichmentRecord> {
    return this.repository.appendLifecycleTransition(
      tenantId,
      productId,
      transition,
      uiLifecycleState
    );
  }

  /**
   * Applies synthesis results onto the product: runs the glue over the current
   * content + enrichment, persists the updated canonical content, and writes the
   * enrichment layer with the given precise UI lifecycle state + history.
   * Returns the updated enrichment record. Throws ProductNotFoundError if the
   * product is gone.
   */
  async applyAndPersistSynthesis(
    tenantId: string,
    productId: string,
    results: GlueGenerationResult[],
    uiLifecycleState: LifecycleState,
    lifecycleHistory: LifecycleTransition[],
    reviewThreshold?: number
  ): Promise<ProductEnrichmentRecord> {
    const product = await this.repository.get(tenantId, productId);
    if (!product) {
      throw new ProductNotFoundError(tenantId, productId);
    }

    const existingEnrichment = await this.repository.getEnrichment(tenantId, productId);
    const baseEnrichment: EnrichmentLayer =
      existingEnrichment?.enrichment ?? {
        attributes: {},
        channelContent: {},
        detectedLanguage: '',
        enrichedAt: '',
      };

    const applied = applySynthesis(
      product.content,
      baseEnrichment,
      results,
      reviewThreshold
    );

    // Persist updated canonical content (keep everything else unchanged).
    const updatedProduct: CanonicalProduct = {
      ...product,
      content: applied.content,
    };
    await this.repository.update(tenantId, productId, updatedProduct);

    // Persist the enrichment layer + precise lifecycle state + history.
    return this.repository.putEnrichment(tenantId, productId, {
      uiLifecycleState,
      enrichment: applied.enrichment,
      lifecycleHistory,
    });
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  async updateProduct(
    tenantId: string,
    productId: string,
    input: UpdateProductInput
  ): Promise<CanonicalProduct> {
    // 1. Get existing product
    const existing = await this.repository.get(tenantId, productId);
    if (!existing) {
      throw new ProductNotFoundError(tenantId, productId);
    }

    // 2. Check lifecycle — archived products cannot be updated
    if (existing.lifecycleState === 'archived') {
      throw new InvalidProductLifecycleError(
        'Cannot update an archived product'
      );
    }

    // 3. If SKU is being changed, check uniqueness
    if (input.sku !== undefined && input.sku !== existing.content.sku) {
      const skuOwner = await this.repository.findBySku(tenantId, input.sku);
      if (skuOwner && skuOwner.productId !== productId) {
        throw new ProductSkuAlreadyExistsError(tenantId, input.sku);
      }
    }

    // 4. Merge input into existing product (only mutable fields)
    const mergedProduct: CanonicalProduct = {
      // Immutable identity fields preserved
      productId: existing.productId,
      tenantId: existing.tenantId,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt, // Repository will refresh this

      // Lifecycle state preserved (unless explicitly transitioning via other means)
      lifecycleState: existing.lifecycleState,

      // Content: merge input over existing
      content: {
        ...existing.content,
        ...(input.title !== undefined && { title: input.title }),
        ...(input.sku !== undefined && { sku: input.sku }),
        ...(input.brand !== undefined && { brand: input.brand }),
        ...(input.shortDescription !== undefined && {
          shortDescription: input.shortDescription,
        }),
        ...(input.longDescription !== undefined && {
          longDescription: input.longDescription,
        }),
        ...(input.bulletPoints !== undefined && {
          bulletPoints: input.bulletPoints,
        }),
        ...(input.manufacturer !== undefined && {
          manufacturer: input.manufacturer,
        }),
        ...(input.barcode !== undefined && { barcode: input.barcode }),
        ...(input.mpn !== undefined && { mpn: input.mpn }),
        ...(input.weight !== undefined && { weight: input.weight }),
        ...(input.weightUnit !== undefined && { weightUnit: input.weightUnit }),
        ...(input.length !== undefined && { length: input.length }),
        ...(input.width !== undefined && { width: input.width }),
        ...(input.height !== undefined && { height: input.height }),
        ...(input.dimensionUnit !== undefined && {
          dimensionUnit: input.dimensionUnit,
        }),
        ...(input.materials !== undefined && { materials: input.materials }),
        ...(input.attributes !== undefined && {
          attributes: input.attributes,
        }),
      },

      // Commercial: merge input over existing
      commercial: {
        ...existing.commercial,
        ...(input.sellingPrice !== undefined && {
          sellingPrice: input.sellingPrice,
        }),
        ...(input.rrp !== undefined && { rrp: input.rrp }),
        ...(input.salePrice !== undefined && { salePrice: input.salePrice }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.stockQuantity !== undefined && {
          stockQuantity: input.stockQuantity,
        }),
        ...(input.lowStockThreshold !== undefined && {
          lowStockThreshold: input.lowStockThreshold,
        }),
        ...(input.fulfilmentMethod !== undefined && {
          fulfilmentMethod: input.fulfilmentMethod,
        }),
        ...(input.leadtimeDays !== undefined && {
          leadtimeDays: input.leadtimeDays,
        }),
        ...(input.handlingTimeDays !== undefined && {
          handlingTimeDays: input.handlingTimeDays,
        }),
        ...(input.listingStatus !== undefined && {
          listingStatus: input.listingStatus,
        }),
      },

      // Platform-specific data preserved (not editable via this method)
      platformSpecific: existing.platformSpecific,
    };

    // 5. Persist (map repository errors to service-level errors)
    try {
      const updated = await this.repository.update(
        tenantId,
        productId,
        mergedProduct
      );
      return updated;
    } catch (error) {
      if (error instanceof RepoNotFoundError) {
        throw new ProductNotFoundError(tenantId, productId);
      }
      if (error instanceof RepoPersistenceError) {
        throw new ProductPersistenceError(
          (error as Error).message,
          error as Error
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Archive
  // ---------------------------------------------------------------------------

  async archiveProduct(
    tenantId: string,
    productId: string
  ): Promise<CanonicalProduct> {
    try {
      return await this.repository.delete(tenantId, productId);
    } catch (error) {
      if (error instanceof RepoNotFoundError) {
        throw new ProductNotFoundError(tenantId, productId);
      }
      if (error instanceof RepoPersistenceError) {
        throw new ProductPersistenceError(
          (error as Error).message,
          error as Error
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateCreateInput(input: CreateProductInput): void {
    if (!input.title || input.title.trim().length === 0) {
      throw new ProductValidationError(
        'Product title is required',
        'title'
      );
    }
    if (!input.sku || input.sku.trim().length === 0) {
      throw new ProductValidationError(
        'Product SKU is required',
        'sku'
      );
    }
    if (!input.brand || input.brand.trim().length === 0) {
      throw new ProductValidationError(
        'Product brand is required',
        'brand'
      );
    }
  }
}
