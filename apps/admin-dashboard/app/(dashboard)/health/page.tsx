'use client';

import React, { useState, useCallback } from 'react';
import { useHealthMetrics, useHealthSummary } from '@merch-os/api-client';
import { StatCard, Skeleton } from '@merch-os/ui';
import type { TimeRange } from '@merch-os/types';
import { HealthChart } from './components/HealthChart';
import { TimeRangeSelector } from './components/TimeRangeSelector';

// ─── Icons ────────────────────────────────────────────────────────────────────

function UsersIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

// ─── Skeleton Layouts ─────────────────────────────────────────────────────────

function SummaryCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
        >
          <Skeleton className="mb-2 h-4 w-32" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton({ title }: { title: string }) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
      aria-busy="true"
      aria-label={`Loading ${title} chart`}
    >
      <Skeleton className="mb-4 h-5 w-48" />
      <Skeleton className="h-[220px] w-full" />
    </div>
  );
}

// ─── Error Alert ──────────────────────────────────────────────────────────────

interface ErrorAlertProps {
  message: string;
  onRetry: () => void;
}

function ErrorAlert({ message, onRetry }: ErrorAlertProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="rounded-md border border-red-200 bg-red-50 p-4"
    >
      <p className="text-sm font-medium text-red-800">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
      >
        <RefreshIcon />
        Retry
      </button>
    </div>
  );
}

// ─── Health Page ──────────────────────────────────────────────────────────────

/**
 * HealthPage – Platform infrastructure health monitoring dashboard.
 *
 * Displays summary cards (active tenants, products processed today), a time
 * range filter, and Recharts area charts for each metric group.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7
 */
export default function HealthPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('6h');

  // ── Data fetching ──────────────────────────────────────────────────────────

  const {
    data: summaryData,
    isLoading: summaryLoading,
    isError: summaryError,
    refetch: refetchSummary,
  } = useHealthSummary();

  const {
    data: metricsData,
    isLoading: metricsLoading,
    isError: metricsError,
    isFetching: metricsFetching,
    refetch: refetchMetrics,
  } = useHealthMetrics(timeRange);

  // ── Callbacks ──────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(() => {
    refetchSummary();
    refetchMetrics();
  }, [refetchSummary, refetchMetrics]);

  const handleTimeRangeChange = useCallback((range: TimeRange) => {
    setTimeRange(range);
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isRefreshing = metricsFetching && !metricsLoading;

  return (
    <main className="space-y-6 p-6" aria-label="Platform health">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Platform Health</h1>

        <div className="flex items-center gap-3">
          <TimeRangeSelector
            value={timeRange}
            onChange={handleTimeRangeChange}
            disabled={metricsLoading || metricsFetching}
          />

          <button
            type="button"
            onClick={handleRefresh}
            disabled={metricsLoading || metricsFetching || summaryLoading}
            aria-label="Refresh health data"
            aria-busy={isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshIcon spinning={isRefreshing} />
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Summary Cards ───────────────────────────────────────────────── */}
      <section aria-label="Health summary">
        <h2 className="sr-only">Summary</h2>

        {summaryLoading ? (
          <SummaryCardsSkeleton />
        ) : summaryError ? (
          <ErrorAlert
            message="Health summary data is temporarily unavailable."
            onRetry={() => refetchSummary()}
          />
        ) : summaryData ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label="Active Tenants"
              value={summaryData.activeTenantCount.toLocaleString()}
              icon={<UsersIcon />}
            />
            <StatCard
              label="Products Processed Today"
              value={summaryData.productsProcessedToday.toLocaleString()}
              icon={<BoxIcon />}
            />
          </div>
        ) : null}
      </section>

      {/* ── Metric Charts ────────────────────────────────────────────────── */}
      <section aria-label="Infrastructure metrics" aria-live="polite" aria-busy={metricsLoading || metricsFetching}>
        <h2 className="sr-only">Infrastructure metrics</h2>

        {metricsError ? (
          <ErrorAlert
            message="Health metric data is temporarily unavailable."
            onRetry={() => refetchMetrics()}
          />
        ) : metricsLoading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChartSkeleton title="Lambda Error Rates" />
            <ChartSkeleton title="Step Functions Failures" />
            <ChartSkeleton title="SQS Queue Depths" />
            <ChartSkeleton title="DynamoDB Consumed Capacity" />
          </div>
        ) : metricsData ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <HealthChart
              title="Lambda Error Rates"
              series={metricsData.lambdaErrorRates}
              unit="errors/min"
            />
            <HealthChart
              title="Step Functions Failures"
              series={metricsData.stepFunctionsFailures}
              unit="failures"
            />
            <HealthChart
              title="SQS Queue Depths"
              series={metricsData.sqsQueueDepths}
              unit="messages"
            />
            <HealthChart
              title="DynamoDB Consumed Capacity"
              series={metricsData.dynamoConsumedCapacity}
              unit="CU"
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
