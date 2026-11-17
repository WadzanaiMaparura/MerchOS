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
import {
  assembleProductDto,
  assembleProductSummary,
  mergeEnrichmentIntoCanonical,
} from './dto-mapper';
import { applySynthesis, type GlueGenerationResult } from './synthesis-glue';
import { assertTransition } from './lifecycle';
import type {
  LifecycleTransition,
  LifecycleState,
  EnrichmentLayer,
  EnrichedAttribute,
} from '@merch-os/types';
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
   * Returns the fullest `CanonicalProduct` for export/validation: the stored
   * canonical product with the AI enrichment layer's attribute values merged
   * into `content.attributes` (canonical/manual values win). This is what the
   * export pipeline consumes — unlike the `Product` DTO, it preserves
   * `variants`, `platformSpecific`, and the full typed content. Throws
   * ProductNotFoundError if the product does not exist.
   */
  async getCanonicalProduct(
    tenantId: string,
    productId: string
  ): Promise<CanonicalProduct> {
    const product = await this.repository.get(tenantId, productId);
    if (!product) {
      throw new ProductNotFoundError(tenantId, productId);
    }
    const enrichment = await this.repository.getEnrichment(tenantId, productId);
    return mergeEnrichmentIntoCanonical(product, enrichment);
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
  // Review loop — per-field approve / override / confirm category / transition
  // ---------------------------------------------------------------------------

  /** Loads the enrichment record for a product, throwing if the product is gone. */
  private async requireEnrichment(
    tenantId: string,
    productId: string
  ): Promise<ProductEnrichmentRecord> {
    const product = await this.repository.get(tenantId, productId);
    if (!product) {
      throw new ProductNotFoundError(tenantId, productId);
    }
    const existing = await this.repository.getEnrichment(tenantId, productId);
    // Seed an empty record (with the product's current UI state) if none exists.
    return (
      existing ?? {
        uiLifecycleState: 'DRAFT',
        enrichment: { attributes: {}, channelContent: {}, detectedLanguage: '', enrichedAt: '' },
        lifecycleHistory: [],
        updatedAt: '',
      }
    );
  }

  /**
   * Approve an enriched attribute: clears its review flag, records approver +
   * timestamp. Throws ProductValidationError if the attribute does not exist.
   */
  async approveAttribute(
    tenantId: string,
    productId: string,
    attributeName: string,
    approvedBy: string
  ): Promise<ProductEnrichmentRecord> {
    const record = await this.requireEnrichment(tenantId, productId);
    const attr = record.enrichment.attributes[attributeName];
    if (!attr) {
      throw new ProductValidationError(
        `Attribute '${attributeName}' not found in enrichment layer`,
        attributeName
      );
    }
    const updated: EnrichedAttribute = {
      ...attr,
      flaggedForReview: false,
      approvedBy,
      approvedAt: new Date().toISOString(),
    };
    const enrichment: EnrichmentLayer = {
      ...record.enrichment,
      attributes: { ...record.enrichment.attributes, [attributeName]: updated },
    };
    return this.repository.putEnrichment(tenantId, productId, {
      uiLifecycleState: record.uiLifecycleState,
      enrichment,
      lifecycleHistory: record.lifecycleHistory,
    });
  }

  /**
   * Override an enriched attribute with a seller-provided value: sets the value,
   * marks source 'manual', clears the review flag. Creates the attribute entry
   * if it did not exist (a seller-supplied field). Also writes the value through
   * to canonical content for the known top-level fields.
   */
  async overrideAttribute(
    tenantId: string,
    productId: string,
    attributeName: string,
    newValue: string | number | boolean,
    actor: string
  ): Promise<ProductEnrichmentRecord> {
    const product = await this.repository.get(tenantId, productId);
    if (!product) {
      throw new ProductNotFoundError(tenantId, productId);
    }
    const existing = await this.repository.getEnrichment(tenantId, productId);
    const base: ProductEnrichmentRecord =
      existing ?? {
        uiLifecycleState: 'DRAFT',
        enrichment: { attributes: {}, channelContent: {}, detectedLanguage: 'en', enrichedAt: '' },
        lifecycleHistory: [],
        updatedAt: '',
      };

    const updated: EnrichedAttribute = {
      value: newValue,
      confidence: 1, // manual values are fully trusted
      source: 'manual',
      flaggedForReview: false,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
    };
    const enrichment: EnrichmentLayer = {
      ...base.enrichment,
      attributes: { ...base.enrichment.attributes, [attributeName]: updated },
    };

    // Write through to canonical content for known top-level fields.
    const content = { ...product.content, attributes: { ...product.content.attributes } };
    if (attributeName === 'title' && typeof newValue === 'string') content.title = newValue;
    else if (attributeName === 'description' && typeof newValue === 'string') content.longDescription = newValue;
    else if (attributeName === 'brand' && typeof newValue === 'string') content.brand = newValue;
    else content.attributes[attributeName] = newValue;
    await this.repository.update(tenantId, productId, { ...product, content });

    return this.repository.putEnrichment(tenantId, productId, {
      uiLifecycleState: base.uiLifecycleState,
      enrichment,
      lifecycleHistory: base.lifecycleHistory,
    });
  }

  /**
   * Confirm the marketplace category the engine recommended: clears the
   * `category` attribute's review flag and records the confirmed node id onto
   * the attribute value + approver. A confirmed category is required before
   * EXPORT_READY.
   */
  async confirmCategory(
    tenantId: string,
    productId: string,
    categoryNodeId: string,
    actor: string
  ): Promise<ProductEnrichmentRecord> {
    const record = await this.requireEnrichment(tenantId, productId);
    const updated: EnrichedAttribute = {
      value: categoryNodeId,
      confidence: 1,
      source: 'manual',
      flaggedForReview: false,
      approvedBy: actor,
      approvedAt: new Date().toISOString(),
    };
    const enrichment: EnrichmentLayer = {
      ...record.enrichment,
      attributes: { ...record.enrichment.attributes, category: updated },
    };
    return this.repository.putEnrichment(tenantId, productId, {
      uiLifecycleState: record.uiLifecycleState,
      enrichment,
      lifecycleHistory: record.lifecycleHistory,
    });
  }

  /** Reasons a product is not yet eligible for EXPORT_READY. */
  private exportReadinessBlockers(record: ProductEnrichmentRecord): string[] {
    const blockers: string[] = [];
    const attrs = record.enrichment.attributes;
    const flagged = Object.entries(attrs)
      .filter(([, a]) => a.flaggedForReview)
      .map(([name]) => name);
    if (flagged.length > 0) {
      blockers.push(`Fields awaiting review: ${flagged.join(', ')}`);
    }
    // Category must be confirmed (present and not flagged).
    const category = attrs['category'];
    if (!category || category.flaggedForReview) {
      blockers.push('Marketplace category not confirmed');
    }
    return blockers;
  }

  /**
   * Transition a product's lifecycle state. Enforces the allowed-transition
   * table (via assertTransition) and, for a move to EXPORT_READY, the extra
   * gate: no fields flagged for review and the category confirmed. Marketplace
   * validation (Phase 3) is layered on top of this gate when available.
   */
  async transitionLifecycle(
    tenantId: string,
    productId: string,
    targetState: LifecycleState,
    actor: string,
    reason?: string
  ): Promise<ProductEnrichmentRecord> {
    const record = await this.requireEnrichment(tenantId, productId);
    const fromState = record.uiLifecycleState;

    // Structural rule check.
    assertTransition(fromState, targetState);

    // Extra gate for EXPORT_READY.
    if (targetState === 'EXPORT_READY') {
      const blockers = this.exportReadinessBlockers(record);
      if (blockers.length > 0) {
        throw new InvalidProductLifecycleError(
          `Cannot mark product export-ready: ${blockers.join('; ')}.`
        );
      }
    }

    const transition: LifecycleTransition = {
      fromState,
      toState: targetState,
      transitionedAt: new Date().toISOString(),
      actor,
      ...(reason ? { reason } : {}),
    };
    return this.repository.appendLifecycleTransition(
      tenantId,
      productId,
      transition,
      targetState
    );
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
