'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';
import type { ImportJobSummary } from './useImportJobs';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DuplicateStrategy = 'SKIP' | 'MERGE' | 'CREATE_FLAGGED';

export interface SupplierSummary {
  supplierId: string;
  tenantId: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  duplicateStrategy: DuplicateStrategy;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierVersion {
  supplierId: string;
  tenantId: string;
  version: number;
  snapshot: SupplierSummary;
  createdAt: string;
}

export interface SupplierListParams {
  limit?: number;
  lastEvaluatedKey?: string;
}

export interface SupplierListResponse {
  suppliers: SupplierSummary[];
  lastEvaluatedKey?: string;
}

export interface SupplierVersionsResponse {
  versions: SupplierVersion[];
}

export interface SupplierImportsParams {
  limit?: number;
  lastEvaluatedKey?: string;
  startDate?: string;
  endDate?: string;
}

export interface SupplierImportsResponse {
  importJobs: ImportJobSummary[];
  lastEvaluatedKey?: string;
}

export interface CreateSupplierPayload {
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  duplicateStrategy?: DuplicateStrategy;
}

export interface UpdateSupplierPayload {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  notes?: string;
  duplicateStrategy?: DuplicateStrategy;
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const supplierKeys = {
  all: ['suppliers'] as const,
  lists: () => [...supplierKeys.all, 'list'] as const,
  list: (params: SupplierListParams) => [...supplierKeys.lists(), params] as const,
  details: () => [...supplierKeys.all, 'detail'] as const,
  detail: (id: string) => [...supplierKeys.details(), id] as const,
  versions: (id: string) => [...supplierKeys.all, 'versions', id] as const,
  imports: (id: string, params?: SupplierImportsParams) =>
    [...supplierKeys.all, 'imports', id, params] as const,
};

// ─── Configuration ───────────────────────────────────────────────────────────

const STALE_TIME = 30_000; // 30 seconds
const GC_TIME = 5 * 60_000; // 5 minutes

// ─── useSuppliers: Paginated supplier list ───────────────────────────────────

/**
 * Fetches a paginated list of suppliers scoped to the authenticated tenant.
 * Validates: Requirements 1.4
 */
export function useSuppliers(
  params: SupplierListParams = {}
): UseQueryResult<SupplierListResponse, ApiError> {
  const client = useApiClient();

  return useQuery<SupplierListResponse, ApiError>({
    queryKey: supplierKeys.list(params),
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};

      if (params.limit) queryParams['limit'] = params.limit;
      if (params.lastEvaluatedKey) queryParams['lastEvaluatedKey'] = params.lastEvaluatedKey;

      const response = await client.get<SupplierListResponse>('/suppliers', {
        params: queryParams,
      });
      return response.data;
    },
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData,
  });
}

// ─── useSupplierDetail: Single supplier detail ───────────────────────────────

/**
 * Fetches detailed information for a single supplier.
 * Validates: Requirements 1.1, 1.2
 */
export function useSupplierDetail(
  supplierId: string
): UseQueryResult<SupplierSummary, ApiError> {
  const client = useApiClient();

  return useQuery<SupplierSummary, ApiError>({
    queryKey: supplierKeys.detail(supplierId),
    queryFn: async () => {
      const response = await client.get<SupplierSummary>(`/suppliers/${supplierId}`);
      return response.data;
    },
    enabled: !!supplierId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: true,
  });
}

// ─── useSupplierVersions: Version history for a supplier ─────────────────────

/**
 * Fetches the version history for a supplier.
 * Validates: Requirements 1.2, 1.3
 */
export function useSupplierVersions(
  supplierId: string
): UseQueryResult<SupplierVersionsResponse, ApiError> {
  const client = useApiClient();

  return useQuery<SupplierVersionsResponse, ApiError>({
    queryKey: supplierKeys.versions(supplierId),
    queryFn: async () => {
      const response = await client.get<SupplierVersionsResponse>(
        `/suppliers/${supplierId}/versions`
      );
      return response.data;
    },
    enabled: !!supplierId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  });
}

// ─── useSupplierImports: Import history for a supplier ───────────────────────

/**
 * Fetches import job history for a specific supplier.
 * Validates: Requirements 10.3
 */
export function useSupplierImports(
  supplierId: string,
  params: SupplierImportsParams = {}
): UseQueryResult<SupplierImportsResponse, ApiError> {
  const client = useApiClient();

  return useQuery<SupplierImportsResponse, ApiError>({
    queryKey: supplierKeys.imports(supplierId, params),
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};

      if (params.limit) queryParams['limit'] = params.limit;
      if (params.lastEvaluatedKey) queryParams['lastEvaluatedKey'] = params.lastEvaluatedKey;
      if (params.startDate) queryParams['startDate'] = params.startDate;
      if (params.endDate) queryParams['endDate'] = params.endDate;

      const response = await client.get<SupplierImportsResponse>(
        `/suppliers/${supplierId}/imports`,
        { params: queryParams }
      );
      return response.data;
    },
    enabled: !!supplierId,
    staleTime: 15_000, // Imports update frequently
    gcTime: GC_TIME,
    refetchOnWindowFocus: true,
    placeholderData: (previousData) => previousData,
  });
}

// ─── useCreateSupplier: Create a new supplier ────────────────────────────────

/**
 * Creates a new supplier profile.
 * Validates: Requirements 1.1
 */
export function useCreateSupplier(): UseMutationResult<
  SupplierSummary,
  ApiError,
  CreateSupplierPayload
> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<SupplierSummary, ApiError, CreateSupplierPayload>({
    mutationFn: async (payload) => {
      const response = await client.post<SupplierSummary>('/suppliers', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });
    },
  });
}

// ─── useUpdateSupplier: Update an existing supplier ──────────────────────────

/**
 * Updates an existing supplier profile.
 * Validates: Requirements 1.2, 1.3
 */
export function useUpdateSupplier(
  supplierId: string
): UseMutationResult<SupplierSummary, ApiError, UpdateSupplierPayload> {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<SupplierSummary, ApiError, UpdateSupplierPayload>({
    mutationFn: async (payload) => {
      const response = await client.put<SupplierSummary>(
        `/suppliers/${supplierId}`,
        payload
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: supplierKeys.detail(supplierId) });
      queryClient.invalidateQueries({ queryKey: supplierKeys.versions(supplierId) });
      queryClient.invalidateQueries({ queryKey: supplierKeys.lists() });
    },
  });
}
