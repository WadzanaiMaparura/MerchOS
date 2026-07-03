'use client';

import {
  useQuery,
  UseQueryResult,
} from '@tanstack/react-query';
import type {
  HealthMetrics,
  HealthSummary,
  MetricSeries,
  MetricDatapoint,
} from '@merch-os/types';
import type { ApiError } from '../errors';
import { useApiClient } from '../context';

// ─── Time Range Type ──────────────────────────────────────────────────────────

export type TimeRange = '1h' | '6h' | '24h' | '7d';

// ─── Query Keys ──────────────────────────────────────────────────────────────

export const adminHealthKeys = {
  all: ['admin', 'health'] as const,
  metrics: (range: TimeRange) => [...adminHealthKeys.all, 'metrics', range] as const,
  summary: () => [...adminHealthKeys.all, 'summary'] as const,
};

// ─── Configuration ───────────────────────────────────────────────────────────

const STALE_TIME = 30_000; // 30 seconds

// ─── useHealthMetrics ─────────────────────────────────────────────────────────

/**
 * Fetches health metric time-series for the given time range.
 */
export function useHealthMetrics(
  range: TimeRange
): UseQueryResult<HealthMetrics, ApiError> {
  const client = useApiClient();

  return useQuery<HealthMetrics, ApiError>({
    queryKey: adminHealthKeys.metrics(range),
    queryFn: async () => {
      const response = await client.get<HealthMetrics>('/admin/health/metrics', {
        params: { range },
      });
      return response.data;
    },
    staleTime: STALE_TIME,
  });
}

// ─── useHealthSummary ─────────────────────────────────────────────────────────

/**
 * Fetches the platform health summary (active tenants + products processed today).
 */
export function useHealthSummary(): UseQueryResult<HealthSummary, ApiError> {
  const client = useApiClient();

  return useQuery<HealthSummary, ApiError>({
    queryKey: adminHealthKeys.summary(),
    queryFn: async () => {
      const response = await client.get<HealthSummary>('/admin/health/summary');
      return response.data;
    },
    staleTime: STALE_TIME,
  });
}
