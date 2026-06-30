'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { InventorySummary, StockAdjustmentPayload } from '@merch-os/types';
import { useApiClient } from '../context';
import type { ApiError } from '../errors';

/** Query key factory for inventory domain */
export const inventoryKeys = {
  all: ['inventory'] as const,
  list: (warehouseId?: string) =>
    warehouseId
      ? ([...inventoryKeys.all, 'list', warehouseId] as const)
      : ([...inventoryKeys.all, 'list'] as const),
  transactions: (sku: string, warehouseId?: string) =>
    [...inventoryKeys.all, 'transactions', sku, warehouseId] as const,
};

export interface InventoryListParams {
  warehouseId?: string;
}

export interface TransactionHistoryParams {
  sku: string;
  warehouseId?: string;
}

export interface InventoryTransaction {
  id: string;
  sku: string;
  delta: number;
  previousQuantity: number;
  newQuantity: number;
  source: string;
  actor: string;
  timestamp: string;
}

/**
 * Fetches the inventory list, optionally filtered by warehouse.
 * Validates: Requirements 7.1
 */
export function useInventory(params?: InventoryListParams) {
  const client = useApiClient();

  return useQuery<InventorySummary[], ApiError>({
    queryKey: inventoryKeys.list(params?.warehouseId),
    queryFn: async () => {
      const queryParams: Record<string, string> = {};
      if (params?.warehouseId) {
        queryParams.warehouseId = params.warehouseId;
      }
      const { data } = await client.get<InventorySummary[]>('/inventory', {
        params: queryParams,
      });
      return data;
    },
  });
}

/**
 * Mutation to submit a manual stock adjustment.
 * Invalidates inventory queries on success.
 * Validates: Requirements 7.3
 */
export function useStockAdjustment() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, StockAdjustmentPayload>({
    mutationFn: async (payload) => {
      await client.post('/inventory/adjustments', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

/**
 * Fetches the transaction history for a specific SKU and optional warehouse.
 * Returns the most recent 50 entries in reverse chronological order.
 * Validates: Requirements 7.5
 */
export function useTransactionHistory(params: TransactionHistoryParams) {
  const client = useApiClient();

  return useQuery<InventoryTransaction[], ApiError>({
    queryKey: inventoryKeys.transactions(params.sku, params.warehouseId),
    queryFn: async () => {
      const queryParams: Record<string, string> = {
        limit: '50',
      };
      if (params.warehouseId) {
        queryParams.warehouseId = params.warehouseId;
      }
      const { data } = await client.get<InventoryTransaction[]>(
        `/inventory/${encodeURIComponent(params.sku)}/transactions`,
        { params: queryParams }
      );
      return data;
    },
    enabled: !!params.sku,
  });
}
