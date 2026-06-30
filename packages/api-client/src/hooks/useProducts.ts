'use client';

import { useState, useEffect } from 'react';
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
} from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

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
export function useProducts(
  params: ProductListParams
): UseQueryResult<PaginatedResponse<ProductSummary>, ApiError> {
  const client = useApiClient();

  return useQuery<PaginatedResponse<ProductSummary>, ApiError>({
    queryKey: productKeys.list(params),
    queryFn: async () => {
      const response = await client.get<PaginatedResponse<ProductSummary>>(
        '/products',
        { params }
      );
      return response.data;
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData,
  });
}

// ─── useProduct: Single product detail ───────────────────────────────────────

/**
 * Fetches a single product by ID with full detail.
 * Validates: Requirements 5.5
 */
export function useProduct(
  productId: string
): UseQueryResult<Product, ApiError> {
  const client = useApiClient();

  return useQuery<Product, ApiError>({
    queryKey: productKeys.detail(productId),
    queryFn: async () => {
      const response = await client.get<Product>(`/products/${productId}`);
      return response.data;
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
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, UpdateProductPayload, ProductMutationContext>({
    mutationFn: async (payload) => {
      const response = await client.patch<Product>(
        `/products/${payload.productId}/attributes`,
        {
          attributeName: payload.attributeName,
          value: payload.value,
        }
      );
      return response.data;
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
  const client = useApiClient();
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
  const client = useApiClient();
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
  const client = useApiClient();
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
  const client = useApiClient();
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

  return useQuery<PaginatedResponse<ProductSummary>, ApiError>({
    queryKey: productKeys.search(debouncedQuery),
    queryFn: async () => {
      const response = await client.get<PaginatedResponse<ProductSummary>>(
        '/products',
        {
          params: {
            ...params,
            search: debouncedQuery,
          },
        }
      );
      return response.data;
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
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
  const client = useApiClient();
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

// ─── useImageUpload: Upload product image ────────────────────────────────────

interface ImageUploadPayload {
  productId: string;
  file: File;
}

/**
 * Mutation to upload an image to a product's image gallery.
 * Validates: Requirements 6.1
 */
export function useImageUpload(): UseMutationResult<
  Product,
  ApiError,
  ImageUploadPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, ImageUploadPayload>({
    mutationFn: async (payload) => {
      const formData = new FormData();
      formData.append('file', payload.file);

      const response = await client.post<Product>(
        `/products/${payload.productId}/images`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return response.data;
    },
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({
        queryKey: productKeys.detail(payload.productId),
      });
    },
  });
}

// ─── useSetHeroImage: Set hero image designation ─────────────────────────────

interface SetHeroImagePayload {
  productId: string;
  imageId: string;
}

/**
 * Mutation to designate an image as the hero image.
 * Only APPROVED images may be set as hero.
 * Validates: Requirements 6.4
 */
export function useSetHeroImage(): UseMutationResult<
  Product,
  ApiError,
  SetHeroImagePayload,
  ProductMutationContext
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<Product, ApiError, SetHeroImagePayload, ProductMutationContext>({
    mutationFn: async (payload) => {
      const response = await client.put<Product>(
        `/products/${payload.productId}/images/${payload.imageId}/hero`
      );
      return response.data;
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
          images: previousProduct.images.map((img) => ({
            ...img,
            isHero: img.imageId === payload.imageId,
          })),
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

// ─── useProductUpload: CSV upload ────────────────────────────────────────────

interface ProductUploadResult {
  uploadId: string;
  status: 'accepted' | 'rejected';
  rowCount?: number;
  errors?: Array<{ row: number; message: string }>;
}

/**
 * Mutation to upload a CSV file of products.
 * Validates: Requirements 5.9
 */
export function useProductUpload(): UseMutationResult<
  ProductUploadResult,
  ApiError,
  File
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<ProductUploadResult, ApiError, File>({
    mutationFn: async (file) => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await client.post<ProductUploadResult>(
        '/products/upload',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );
      return response.data;
    },
    onSuccess: () => {
      // Invalidate the product list to pick up newly uploaded products
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
    },
  });
}
