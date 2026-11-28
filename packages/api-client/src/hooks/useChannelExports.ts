'use client';

/**
 * Store exports (Exports page): Takealot, Shopify and WooCommerce files built on
 * the server from the seller's own products (Export API /exports routes).
 */

import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import type { ApiError } from '../errors';
import { useExportClient } from '../context';

export type ExportChannel = 'takealot' | 'shopify' | 'woocommerce';

export interface ChannelExportOptions {
  shopify?: { status?: 'draft' | 'active'; useRrpAsCompareAt?: boolean };
  woocommerce?: {
    status?: 'draft' | 'published';
    weightUnit?: 'kg' | 'g' | 'lbs' | 'oz';
    dimensionUnit?: 'cm' | 'm' | 'mm' | 'in' | 'yd';
    useRrpAsCompareAt?: boolean;
  };
  takealot?: { category?: string; format?: 'CSV' | 'XLSX' };
}

export interface ChannelExportPayload {
  channel: ExportChannel;
  productIds: string[];
  options?: ChannelExportOptions;
  /** Export the Ready products and leave the rest out. */
  onlyReady?: boolean;
}

export interface ChannelFinding {
  severity: 'ERROR' | 'WARNING';
  code: string;
  field: string;
  message: string;
}

export interface ProductExportCheck {
  productId: string;
  title: string;
  sku: string;
  status: 'ready' | 'needs-fixing';
  findings: ChannelFinding[];
  shopifyCategory: string | null;
  shopifyCategoryPath: string | null;
  woocommerceCategory: string | null;
  categoryPath: string | null;
}

export interface ChannelExportCheck {
  channel: ExportChannel;
  templateVersion: string;
  products: ProductExportCheck[];
  readyCount: number;
  needsFixingCount: number;
  missingProductIds: string[];
}

export interface ExportRecord {
  exportId: string;
  channel: ExportChannel;
  templateVersion: string;
  format: 'CSV' | 'XLSX';
  filename: string;
  createdAt: string;
  createdBy: string | null;
  productCount: number;
  rowCount: number;
  excludedCount: number;
  imageLinksExpireAt: string;
}

export interface CreatedExport {
  export: ExportRecord;
  downloadUrl: string;
  expiresInSeconds: number;
  check: ChannelExportCheck;
}

export interface ShopifyCategoryOption {
  id: string;
  path: string;
}

export const exportKeys = {
  history: ['exports', 'history'] as const,
  shopifyCategories: (q: string) => ['exports', 'shopify-categories', q] as const,
};

/** Check products against a store's rules (Ready / Needs fixing). */
export function useCheckChannelExport(): UseMutationResult<ChannelExportCheck, ApiError, ChannelExportPayload> {
  const client = useExportClient();
  return useMutation<ChannelExportCheck, ApiError, ChannelExportPayload>({
    mutationFn: async (payload) => (await client.post<ChannelExportCheck>('/exports/check', payload)).data,
  });
}

/** Build the file. A 409 NEEDS_FIXING carries the check in error details. */
export function useCreateChannelExport(): UseMutationResult<CreatedExport, ApiError, ChannelExportPayload> {
  const client = useExportClient();
  const queryClient = useQueryClient();
  return useMutation<CreatedExport, ApiError, ChannelExportPayload>({
    mutationFn: async (payload) => (await client.post<CreatedExport>('/exports', payload)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: exportKeys.history }),
  });
}

/** The seller's recent exports (newest first). */
export function useExportHistory(): UseQueryResult<ExportRecord[], ApiError> {
  const client = useExportClient();
  return useQuery<ExportRecord[], ApiError>({
    queryKey: exportKeys.history,
    queryFn: async () => (await client.get<{ exports: ExportRecord[] }>('/exports')).data.exports,
    staleTime: 30_000,
  });
}

/** A fresh short-lived download link for an earlier export. */
export function useExportDownloadLink(): UseMutationResult<{ downloadUrl: string; filename: string }, ApiError, string> {
  const client = useExportClient();
  return useMutation<{ downloadUrl: string; filename: string }, ApiError, string>({
    mutationFn: async (exportId) =>
      (await client.get<{ downloadUrl: string; filename: string }>(`/exports/${encodeURIComponent(exportId)}/download`)).data,
  });
}

/** Remember a product's category for one store (null clears it). */
export function useSaveChannelCategory(): UseMutationResult<
  { productId: string; channel: ExportChannel; value: string | null; path?: string },
  ApiError,
  { productId: string; channel: ExportChannel; value: string | null }
> {
  const client = useExportClient();
  return useMutation({
    mutationFn: async ({ productId, channel, value }) =>
      (await client.put(`/exports/products/${encodeURIComponent(productId)}/category`, { channel, value })).data,
  });
}

/** Search Shopify's official category list (2+ characters). */
export function useShopifyCategorySearch(query: string): UseQueryResult<ShopifyCategoryOption[], ApiError> {
  const client = useExportClient();
  const q = query.trim();
  return useQuery<ShopifyCategoryOption[], ApiError>({
    queryKey: exportKeys.shopifyCategories(q.toLowerCase()),
    enabled: q.length >= 2,
    staleTime: 60 * 60_000,
    queryFn: async () =>
      (await client.get<{ categories: ShopifyCategoryOption[] }>('/exports/shopify-categories', { params: { q } })).data.categories,
  });
}
