'use client';

import { useState, useEffect, useRef } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type {
  Product,
  ProductSummary,
  ProductListParams,
  PaginatedResponse,
  ApproveAttributePayload,
  OverrideAttributePayload,
  TransitionPayload,
  TriggerExportPayload,
  ExportSummary,
  CanonicalProduct,
} from '@merch-os/types';
import type { ApiError } from '../errors';
import { useProductClient, useExportClient } from '../context';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params: ProductListParams) => [...productKeys.lists(), params] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
  search: (query: string) => [...productKeys.all, 'search', query] as const,
};

// ─── Configuration ───────────────────────────────────────────────────────────

const STALE_TIME = 30_000; // 30 seconds
const GC_TIME = 5 * 60_000; // 5 minutes (garbage collection / cache time)

// ─── Context type for optimistic mutations ───────────────────────────────────

interface ProductMutationContext {
  previousProduct: Product | undefined;
}

// ─── useProducts: Paginated product list ─────────────────────────────────────

/**
 * Fetches a paginated list of products with filtering and sorting.
 * Validates: Requirements 5.1, 5.3
 */
/**
 * GET /products is cursor-paginated (`{ products, nextToken }`) and has no
 * server-side search, filter or sort. The UI pages by number with a total, so
 * the catalogue summaries are loaded (bounded) and searched / filtered / sorted
 * / paged here. Summaries are small; a trial account has at most 15 products.
 */
const LIST_BATCH = 100;
/** Upper bound on summaries loaded for the list view. */
export const MAX_LISTED_PRODUCTS = 2000;

async function fetchAllSummaries(
  client: ReturnType<typeof useProductClient>
): Promise<ProductSummary[]> {
  const all: ProductSummary[] = [];
  let nextToken: string | undefined;
  do {
    const { data } = await client.get<{ products?: ProductSummary[]; nextToken?: string }>('/products', {
      params: { limit: LIST_BATCH, ...(nextToken ? { nextToken } : {}) },
    });
    all.push(...(data.products ?? []));
    nextToken = data.nextToken;
  } while (nextToken && all.length < MAX_LISTED_PRODUCTS);
  return all;
}

/** Search, filter, sort and page product summaries (exported for tests). */
export function applyListParams(
  items: ProductSummary[],
  params: ProductListParams
): PaginatedResponse<ProductSummary> {
  let rows = items;
  const q = params.search?.trim().toLowerCase();
  if (q) {
    rows = rows.filter((p) =>
      [p.sku, p.title, p.brand]
        .some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
    );
  }
  if (params.lifecycleState) rows = rows.filter((p) => p.lifecycleState === params.lifecycleState);

  // Default: most recently updated first. An explicit sort is ascending unless 'desc'.
  const sortBy = params.sortBy ?? 'updatedAt';
  const dir = params.sortBy ? (params.sortOrder === 'desc' ? -1 : 1) : -1;
  rows = [...rows].sort((a, b) => {
    const av = String((a as unknown as Record<string, unknown>)[sortBy] ?? '');
    const bv = String((b as unknown as Record<string, unknown>)[sortBy] ?? '');
    return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });

  const pageSize = params.pageSize ?? 50;
  const page = Math.max(1, params.page ?? 1);
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    pageSize,
    hasMore: page * pageSize < rows.length,
  };
}

/** One cached copy of the catalogue summaries, shared by list and search. */
function useAllSummaries<T>(select: (items: ProductSummary[]) => T, enabled = true) {
  const client = useProductClient();
  return useQuery<ProductSummary[], ApiError, T>({
    queryKey: [...productKeys.lists(), 'all'],
    queryFn: () => fetchAllSummaries(client),
    select,
    enabled,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData,
  });
}

export function useProducts(
  params: ProductListParams
): UseQueryResult<PaginatedResponse<ProductSummary>, ApiError> {
  return useAllSummaries(
    useCallbackStable(JSON.stringify(params), (items: ProductSummary[]) => applyListParams(items, params))
  );
}

/** Keeps `select` referentially stable per params so React Query memoises it. */
function useCallbackStable<A, R>(key: string, fn: (a: A) => R): (a: A) => R {
  const ref = useRef<{ key: string; fn: (a: A) => R } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, fn };
  return ref.current.fn;
}

/** The detail and mutation endpoints wrap the DTO as `{ product }`. */
function unwrapProduct(data: unknown): Product {
  const d = data as { product?: Product } | Product;
  return (d && typeof d === 'object' && 'product' in d && d.product ? d.product : d) as Product;
}

// ─── useProduct: Single product detail ───────────────────────────────────────

/**
 * Fetches a single product by ID with full detail.
 * Validates: Requirements 5.5
 */
export function useProduct(
  productId: string
): UseQueryResult<Product, ApiError> {
  const client = useProductClient();

  return useQuery<Product, ApiError>({
    queryKey: productKeys.detail(productId),
    queryFn: async () => {
      const response = await client.get<{ product: Product }>(`/products/${productId}`);
      return unwrapProduct(response.data);
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: !!productId,
    refetchOnWindowFocus: true,
  });
}

// ─── useUpdateProduct: Update product attribute ──────────────────────────────

interface UpdateProductPayload {
  productId: string;
  attributeName: string;
  value: string | number | boolean;
}

/**
 * Mutation to update a product attribute with optimistic update and rollback.
 * Validates: Requirements 5.6
 */
export function useUpdateProduct(): UseMutationResult<
  Product,
  ApiError,
  UpdateProductPayload,
  ProductMutationContext
> {
  const client = useProductClient();
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, UpdateProductPayload, ProductMutationContext>({
    mutationFn: async (payload) => {
      const response = await client.patch<{ product: Product }>(
        `/products/${payload.productId}/attributes`,
        {
          attributeName: payload.attributeName,
          value: payload.value,
        }
      );
      return unwrapProduct(response.data);
    },
    onMutate: async (payload): Promise<ProductMutationContext> => {
      // Cancel outgoing refetches to avoid overwriting our optimistic update
      await queryClient.cancelQueries({
        queryKey: productKeys.detail(payload.productId),
      });

      // Snapshot previous value for rollback
      const previousProduct = queryClient.getQueryData<Product>(
        productKeys.detail(payload.productId)
      );

      // Optimistically update the cache
      if (previousProduct) {
        // Handle top-level canonical fields vs custom attributes
        const topLevelFields = ['title', 'description', 'brand'];
        let optimistic: Product;
        if (topLevelFields.includes(payload.attributeName)) {
          optimistic = {
            ...previousProduct,
            [payload.attributeName]: payload.value,
            updatedAt: new Date().toISOString(),
          };
        } else {
          optimistic = {
            ...previousProduct,
            attributes: {
              ...previousProduct.attributes,
              [payload.attributeName]: payload.value,
            },
            updatedAt: new Date().toISOString(),
          };
        }
        queryClient.setQueryData<Product>(
          productKeys.detail(payload.productId),
          optimistic
        );
      }

      return { previousProduct };
    },
    onError: (_error, payload, context) => {
      // Rollback to snapshot on failure
      if (context?.previousProduct) {
        queryClient.setQueryData(
          productKeys.detail(payload.productId),
          context.previousProduct
        );
      }
    },
    onSettled: (_data, _error, payload) => {
      // Invalidate to refetch fresh data
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(payload.productId),
      });
      queryClient.invalidateQueries({
        queryKey: productKeys.lists(),
      });
    },
  });
}

// ─── useApproveAttribute: Approve an AI-enriched attribute ───────────────────

/** Extended approve payload including approver identity for optimistic UI updates. */
interface ApproveAttributeVariables extends ApproveAttributePayload {
  /** User ID of the approver — used for optimistic update display (backend extracts from JWT). */
  approvedBy?: string;
}

/**
 * Mutation to approve an AI-enriched attribute flagged for review.
 * Implements optimistic update marking the attribute as approved with the user's identity.
 * Validates: Requirements 5.8
 */
export function useApproveAttribute(): UseMutationResult<
  void,
  ApiError,
  ApproveAttributeVariables,
  ProductMutationContext
> {
  const client = useProductClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, ApproveAttributeVariables, ProductMutationContext>({
    mutationFn: async (payload) => {
      await client.post(
        `/products/${payload.productId}/attributes/${payload.attributeName}/approve`
      );
    },
    onMutate: async (payload): Promise<ProductMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: productKeys.detail(payload.productId),
      });

      const previousProduct = queryClient.getQueryData<Product>(
        productKeys.detail(payload.productId)
      );

      if (previousProduct) {
        const updatedAttributes = { ...previousProduct.enrichmentLayer.attributes };
        const attribute = updatedAttributes[payload.attributeName];
        if (attribute) {
          updatedAttributes[payload.attributeName] = {
            ...attribute,
            flaggedForReview: false,
            approvedBy: payload.approvedBy,
            approvedAt: new Date().toISOString(),
          };
        }

        const optimistic: Product = {
          ...previousProduct,
          enrichmentLayer: {
            ...previousProduct.enrichmentLayer,
            attributes: updatedAttributes,
          },
        };
        queryClient.setQueryData<Product>(
          productKeys.detail(payload.productId),
          optimistic
        );
      }

      return { previousProduct };
    },
    onError: (_error, payload, context) => {
      if (context?.previousProduct) {
        queryClient.setQueryData(
          productKeys.detail(payload.productId),
          context.previousProduct
        );
      }
    },
    onSettled: (_data, _error, payload) => {
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(payload.productId),
      });
    },
  });
}

// ─── useOverrideAttribute: Override an AI-enriched attribute ──────────────────

/**
 * Mutation to override an AI-enriched attribute with a new value.
 * Implements optimistic update with rollback.
 * Validates: Requirements 5.6
 */
export function useOverrideAttribute(): UseMutationResult<
  void,
  ApiError,
  OverrideAttributePayload,
  ProductMutationContext
> {
  const client = useProductClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, OverrideAttributePayload, ProductMutationContext>({
    mutationFn: async (payload) => {
      await client.post(
        `/products/${payload.productId}/attributes/${payload.attributeName}/override`,
        { newValue: payload.newValue }
      );
    },
    onMutate: async (payload): Promise<ProductMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: productKeys.detail(payload.productId),
      });

      const previousProduct = queryClient.getQueryData<Product>(
        productKeys.detail(payload.productId)
      );

      if (previousProduct) {
        const updatedAttributes = { ...previousProduct.enrichmentLayer.attributes };
        const attribute = updatedAttributes[payload.attributeName];
        if (attribute) {
          updatedAttributes[payload.attributeName] = {
            ...attribute,
            value: payload.newValue,
            flaggedForReview: false,
          };
        }

        const optimistic: Product = {
          ...previousProduct,
          enrichmentLayer: {
            ...previousProduct.enrichmentLayer,
            attributes: updatedAttributes,
          },
        };
        queryClient.setQueryData<Product>(
          productKeys.detail(payload.productId),
          optimistic
        );
      }

      return { previousProduct };
    },
    onError: (_error, payload, context) => {
      if (context?.previousProduct) {
        queryClient.setQueryData(
          productKeys.detail(payload.productId),
          context.previousProduct
        );
      }
    },
    onSettled: (_data, _error, payload) => {
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(payload.productId),
      });
    },
  });
}

// ─── useTransitionLifecycle: Transition product lifecycle state ───────────────

/**
 * Mutation to transition a product to a new lifecycle state.
 * Implements optimistic update with rollback on failure.
 * Validates: Requirements 5.6
 */
export function useTransitionLifecycle(): UseMutationResult<
  void,
  ApiError,
  TransitionPayload,
  ProductMutationContext
> {
  const client = useProductClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, TransitionPayload, ProductMutationContext>({
    mutationFn: async (payload) => {
      await client.post(
        `/products/${payload.productId}/lifecycle/transition`,
        {
          targetState: payload.targetState,
          reason: payload.reason,
        }
      );
    },
    onMutate: async (payload): Promise<ProductMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: productKeys.detail(payload.productId),
      });

      const previousProduct = queryClient.getQueryData<Product>(
        productKeys.detail(payload.productId)
      );

      if (previousProduct) {
        const optimistic: Product = {
          ...previousProduct,
          lifecycleState: payload.targetState,
          updatedAt: new Date().toISOString(),
        };
        queryClient.setQueryData<Product>(
          productKeys.detail(payload.productId),
          optimistic
        );
      }

      return { previousProduct };
    },
    onError: (_error, payload, context) => {
      if (context?.previousProduct) {
        queryClient.setQueryData(
          productKeys.detail(payload.productId),
          context.previousProduct
        );
      }
    },
    onSettled: (_data, _error, payload) => {
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(payload.productId),
      });
      queryClient.invalidateQueries({
        queryKey: productKeys.lists(),
      });
    },
  });
}

// ─── useProductSearch: Search with 500ms debounce ────────────────────────────

/**
 * Debounced product search hook for search-as-you-type.
 * Waits 500ms after the last keystroke before issuing the request.
 * Validates: Requirements 5.2
 */
export function useProductSearch(
  query: string,
  params?: Omit<ProductListParams, 'search'>
): UseQueryResult<PaginatedResponse<ProductSummary>, ApiError> {
  const [debouncedQuery, setDebouncedQuery] = useState(query);

  useEffect(() => {
    // Only search if there are at least 2 characters (per requirement 5.2)
    if (query.length < 2) {
      setDebouncedQuery('');
      return;
    }

    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 500);

    return () => clearTimeout(timer);
  }, [query]);

  // Searches the same cached summaries as useProducts (the API has no search).
  const merged = { ...params, search: debouncedQuery };
  return useAllSummaries(
    useCallbackStable(JSON.stringify(merged), (items: ProductSummary[]) => applyListParams(items, merged)),
    debouncedQuery.length >= 2
  );
}

// ─── useCanonicalProduct: Full canonical product for export/validation ───────

/**
 * Fetches a product as the full `CanonicalProduct` (enrichment merged into
 * content.attributes), the shape the export/validation pipeline consumes.
 * Unlike the `Product` DTO, this preserves variants, platformSpecific, and the
 * full typed content. Served by GET /products/{id}/canonical.
 */
export function useCanonicalProduct(
  productId: string,
  options?: { enabled?: boolean }
): UseQueryResult<CanonicalProduct, ApiError> {
  const client = useProductClient();

  return useQuery<CanonicalProduct, ApiError>({
    queryKey: [...productKeys.detail(productId), 'canonical'],
    queryFn: async () => {
      const response = await client.get<{ product: CanonicalProduct }>(
        `/products/${productId}/canonical`
      );
      return response.data.product;
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    enabled: (options?.enabled ?? true) && !!productId,
  });
}

// ─── useProductExport: Export selected products ──────────────────────────────

interface ProductExportPayload {
  productIds: string[];
  channelId: TriggerExportPayload['channelId'];
  format: 'csv' | 'json';
}

/**
 * Mutation to export selected products to a channel.
 * Validates: Requirements 5.11
 */
export function useProductExport(): UseMutationResult<
  ExportSummary,
  ApiError,
  ProductExportPayload
> {
  const client = useExportClient();
  const queryClient = useQueryClient();

  return useMutation<ExportSummary, ApiError, ProductExportPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<ExportSummary>('/exports', {
        productIds: payload.productIds,
        channelId: payload.channelId,
        format: payload.format,
      });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate exports list to reflect the new export
      queryClient.invalidateQueries({ queryKey: ['exports'] });
    },
  });
}

// NOTE: Image upload + hero designation moved to the Image Intelligence Engine
// hooks (`useImageIntelligence.ts`: useRequestUploadUrl / useStartImageProcessing
// / useImageJob / useImageSignedUrl). The old synchronous multipart upload
// (`useImageUpload`) and `useSetHeroImage` were removed when the engine's async
// pipeline replaced them (Phase 7). Hero selection is now a product update.

// NOTE: CSV upload goes through supplier imports (useImportFiles /
// useStartFileImport): the old POST /products/upload never existed server-side.

// ─── useCreateProduct: POST /products ────────────────────────────────────────

/** Body accepted by POST /products (services/product/api/schemas.ts, strict). */
export interface CreateProductPayload {
  title: string;
  sku: string;
  brand: string;
  shortDescription?: string;
  longDescription?: string;
  bulletPoints?: string[];
  manufacturer?: string;
  barcode?: string;
  mpn?: string;
  weight?: number;
  weightUnit?: 'g' | 'kg' | 'lb' | 'oz';
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: 'cm' | 'in' | 'mm';
  materials?: string[];
  attributes?: Record<string, string | number | boolean>;
  stockQuantity?: number;
}

/** Creates a DRAFT product. Fails with 402 TRIAL_LIMIT_REACHED past the free trial. */
export function useCreateProduct(): UseMutationResult<{ productId: string }, ApiError, CreateProductPayload> {
  const client = useProductClient();
  const queryClient = useQueryClient();
  return useMutation<{ productId: string }, ApiError, CreateProductPayload>({
    mutationFn: async (payload) => {
      const { data } = await client.post<{ product: { productId: string } }>('/products', payload);
      return { productId: data.product.productId };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: trialKeys.usage });
    },
  });
}

// ─── AI generation on a product (server-side, via the product API) ──────────

export type SynthesisType = 'title' | 'description' | 'bullets' | 'attributes' | 'category';

export interface SynthesizeResult {
  product: Product;
  /** True when some of the requested types failed (the rest were saved). */
  partial?: boolean;
}

/**
 * POST /products/{id}/synthesize: generates title, description, bullets,
 * attributes and category with AI and moves the product to REVIEW.
 */
export function useSynthesizeProduct(): UseMutationResult<
  SynthesizeResult,
  ApiError,
  { productId: string; types?: SynthesisType[] }
> {
  const client = useProductClient();
  const queryClient = useQueryClient();
  return useMutation<SynthesizeResult, ApiError, { productId: string; types?: SynthesisType[] }>({
    mutationFn: async ({ productId, types }) => {
      const { data } = await client.post<SynthesizeResult>(
        `/products/${encodeURIComponent(productId)}/synthesize`,
        types ? { types } : {},
        // Several model calls in a row: allow well over the default timeout.
        { timeout: 120_000 }
      );
      return { ...data, product: unwrapProduct(data) };
    },
    onSuccess: (result, { productId }) => {
      queryClient.setQueryData(productKeys.detail(productId), result.product);
    },
    onSettled: (_d, _e, { productId }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) });
      void queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}

/** POST /products/{id}/attributes/{name}/regenerate (product must be in REVIEW). */
export function useRegenerateAttribute(): UseMutationResult<
  Product,
  ApiError,
  { productId: string; attributeName: string; reason?: string }
> {
  const client = useProductClient();
  const queryClient = useQueryClient();
  return useMutation<Product, ApiError, { productId: string; attributeName: string; reason?: string }>({
    mutationFn: async ({ productId, attributeName, reason }) => {
      const { data } = await client.post<{ product: Product }>(
        `/products/${encodeURIComponent(productId)}/attributes/${encodeURIComponent(attributeName)}/regenerate`,
        reason ? { reason } : {},
        { timeout: 60_000 }
      );
      return unwrapProduct(data);
    },
    onSuccess: (product, { productId }) => {
      queryClient.setQueryData(productKeys.detail(productId), product);
    },
    onSettled: (_d, _e, { productId }) => {
      void queryClient.invalidateQueries({ queryKey: productKeys.detail(productId) });
    },
  });
}

// ─── useTrialUsage: GET /entitlements/trial ─────────────────────────────────

export interface TrialUsage {
  /** False until the free-trial limit is switched on for the platform. */
  enforced: boolean;
  /** 'paused' = a paid plan ran out more than 3 days ago (no new products until paid). */
  status: 'not_started' | 'trial' | 'subscribed' | 'exempt' | 'paused';
  productsUsed: number;
  productLimit: number;
  remaining: number;
  subscribedUntil?: string;
}

export const trialKeys = { usage: ['entitlements', 'trial'] as const };

export function useTrialUsage(): UseQueryResult<TrialUsage, ApiError> {
  const client = useProductClient();
  return useQuery<TrialUsage, ApiError>({
    queryKey: trialKeys.usage,
    queryFn: async () => (await client.get<TrialUsage>('/entitlements/trial')).data,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    // The banner is informational: never retry-storm or block the page on it.
    retry: 1,
  });
}
