'use client';

import {
  useQuery,
  UseQueryResult,
} from '@tanstack/react-query';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImportJobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'VALIDATING'
  | 'PERSISTING'
  | 'COMPLETED'
  | 'FAILED';

export type SourceType =
  | 'FILE_CSV'
  | 'FILE_EXCEL'
  | 'FILE_PDF'
  | 'FILE_ZIP'
  | 'IMAGE'
  | 'URL';

export interface ImportJobSummary {
  importJobId: string;
  tenantId: string;
  supplierId: string;
  supplierName?: string;
  sourceType: SourceType;
  sourceReference: string;
  status: ImportJobStatus;
  progress?: {
    percentage: number;
    currentStep: string;
    estimatedTimeRemaining?: number;
  };
  results?: {
    totalExtracted: number;
    created: number;
    updated: number;
    duplicates: number;
    validationFailed: number;
  };
  createdAt: string;
  completedAt?: string;
}

export interface FieldError {
  field: string;
  message: string;
  recordIndex: number;
  value?: string;
}

export interface ImportJobDetail {
  importJobId: string;
  tenantId: string;
  supplierId: string;
  supplierName?: string;
  sourceType: SourceType;
  sourceReference: string;
  status: ImportJobStatus;
  progress?: {
    percentage: number;
    currentStep: string;
    estimatedTimeRemaining?: number;
  };
  results?: {
    totalExtracted: number;
    created: number;
    updated: number;
    duplicates: number;
    validationFailed: number;
  };
  errors?: FieldError[];
  validationSummary?: {
    totalRecords: number;
    passed: number;
    failed: number;
    fieldErrorCounts: Record<string, number>;
  };
  crawlStats?: {
    pagesCrawled: number;
    pagesSkipped: number;
    productsExtracted: number;
    imagesDownloaded: number;
    errorsEncountered: number;
    durationMs: number;
  };
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface ImportJobListParams {
  status?: ImportJobStatus;
  supplierId?: string;
  sourceType?: SourceType;
  startDate?: string;
  endDate?: string;
  limit?: number;
  lastEvaluatedKey?: string;
}

export interface ImportJobListResponse {
  importJobs: ImportJobSummary[];
  lastEvaluatedKey?: string;
}

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const importJobKeys = {
  all: ['importJobs'] as const,
  lists: () => [...importJobKeys.all, 'list'] as const,
  list: (params: ImportJobListParams) => [...importJobKeys.lists(), params] as const,
  details: () => [...importJobKeys.all, 'detail'] as const,
  detail: (id: string) => [...importJobKeys.details(), id] as const,
};

// ─── Configuration ───────────────────────────────────────────────────────────

const STALE_TIME = 15_000; // 15 seconds — imports update frequently
const GC_TIME = 5 * 60_000; // 5 minutes

// ─── useImportJobs: Paginated import job list with filters ───────────────────

/**
 * Fetches a paginated list of import jobs with filtering by status, supplier,
 * source type, and date range.
 * Validates: Requirements 9.1, 9.3, 9.5
 */
export function useImportJobs(
  params: ImportJobListParams
): UseQueryResult<ImportJobListResponse, ApiError> {
  const client = useApiClient();

  return useQuery<ImportJobListResponse, ApiError>({
    queryKey: importJobKeys.list(params),
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {};

      if (params.status) queryParams['status'] = params.status;
      if (params.supplierId) queryParams['supplierId'] = params.supplierId;
      if (params.sourceType) queryParams['sourceType'] = params.sourceType;
      if (params.startDate) queryParams['startDate'] = params.startDate;
      if (params.endDate) queryParams['endDate'] = params.endDate;
      if (params.limit) queryParams['limit'] = params.limit;
      if (params.lastEvaluatedKey) queryParams['lastEvaluatedKey'] = params.lastEvaluatedKey;

      const response = await client.get<ImportJobListResponse>('/imports', {
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

// ─── useImportJobDetail: Single import job detail with polling ────────────────

const POLL_INTERVAL = 3_000; // 3 seconds for in-progress jobs

/**
 * Fetches detailed information for a single import job.
 * Polls every 3 seconds while the job is still in progress (QUEUED, PROCESSING, VALIDATING, PERSISTING).
 * Validates: Requirements 9.2, 9.4, 8.4
 */
export function useImportJobDetail(
  importJobId: string
): UseQueryResult<ImportJobDetail, ApiError> {
  const client = useApiClient();

  return useQuery<ImportJobDetail, ApiError>({
    queryKey: importJobKeys.detail(importJobId),
    queryFn: async () => {
      const response = await client.get<ImportJobDetail>(`/imports/${importJobId}`);
      return response.data;
    },
    enabled: !!importJobId,
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (
        status === 'QUEUED' ||
        status === 'PROCESSING' ||
        status === 'VALIDATING' ||
        status === 'PERSISTING'
      ) {
        return POLL_INTERVAL;
      }
      return false;
    },
  });
}
