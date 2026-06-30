'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useApiClient } from '@merch-os/api-client';
import { useToast, StatCard, Card, Badge, LifecycleBadge, Alert } from '@merch-os/ui';
import type { LifecycleState, EventType } from '@merch-os/types';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardMetrics {
  totalProducts: number;
  pendingReview: number;
  activeListings: number;
  lowStockItems: number;
}

interface LifecycleDistribution {
  state: LifecycleState;
  count: number;
}

interface RecentEvent {
  id: string;
  type: EventType;
  timestamp: string;
  productId?: string;
  productTitle?: string;
  entityId?: string;
}

interface DashboardData {
  metrics: DashboardMetrics;
  lifecycleDistribution: LifecycleDistribution[];
  recentEvents: RecentEvent[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRODUCT_EVENT_PREFIXES = [
  'product.',
  'compliance.',
  'listing.',
  'ingestion.',
  'image.',
] as const;

function isProductRelatedEvent(eventType: EventType): boolean {
  return PRODUCT_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix));
}

function formatEventType(eventType: EventType): string {
  return eventType
    .split('.')
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' · ');
}

const ALL_LIFECYCLE_STATES: LifecycleState[] = [
  'DRAFT',
  'INGESTED',
  'ENRICHED',
  'REVIEW',
  'VALIDATED',
  'EXPORT_READY',
  'PUBLISHED',
  'ARCHIVED',
];

// ─── Dashboard Query ─────────────────────────────────────────────────────────

const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: () => [...dashboardKeys.all, 'summary'] as const,
};

function useDashboard() {
  const client = useApiClient();

  return useQuery<DashboardData>({
    queryKey: dashboardKeys.summary(),
    queryFn: async () => {
      const response = await client.get<DashboardData>('/dashboard');
      return response.data;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

// ─── Dashboard Page ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { data, isLoading, isError, error, refetch } = useDashboard();

  const handleEventClick = async (event: RecentEvent) => {
    if (!isProductRelatedEvent(event.type)) return;

    const productId = event.productId;
    if (!productId) {
      toast({
        title: 'Product unavailable',
        description: 'The associated product no longer exists.',
        variant: 'warning',
      });
      return;
    }

    try {
      router.push(`/products/${productId}`);
    } catch {
      toast({
        title: 'Product unavailable',
        description: 'The associated product could not be found.',
        variant: 'warning',
      });
    }
  };

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (isError) {
    return (
      <div className="space-y-4 p-6">
        <Alert variant="error" title="Failed to load dashboard">
          <p>
            Summary data could not be loaded.{' '}
            {error instanceof Error ? error.message : 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
          >
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  if (!data) return null;

  const { metrics, lifecycleDistribution, recentEvents } = data;

  // Build a map for lifecycle distribution with defaults for all states
  const distributionMap = new Map<LifecycleState, number>();
  ALL_LIFECYCLE_STATES.forEach((state) => distributionMap.set(state, 0));
  lifecycleDistribution.forEach(({ state, count }) =>
    distributionMap.set(state, count)
  );

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Summary Metric Cards */}
      <section aria-label="Summary metrics">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Products"
            value={metrics.totalProducts}
            icon={<PackageIcon />}
          />
          <StatCard
            label="Pending Review"
            value={metrics.pendingReview}
            icon={<ClipboardIcon />}
          />
          <StatCard
            label="Active Listings"
            value={metrics.activeListings}
            icon={<CheckCircleIcon />}
          />
          <StatCard
            label="Low Stock Items"
            value={metrics.lowStockItems}
            icon={<AlertTriangleIcon />}
          />
        </div>
      </section>

      {/* Lifecycle State Distribution */}
      <section aria-label="Lifecycle state distribution">
        <Card title="Lifecycle Distribution">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ALL_LIFECYCLE_STATES.map((state) => (
              <div
                key={state}
                className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <LifecycleBadge state={state} />
                <span className="ml-2 text-sm font-semibold text-gray-900">
                  {distributionMap.get(state) ?? 0}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* Recent Events */}
      <section aria-label="Recent activity">
        <Card title="Recent Activity">
          {recentEvents.length === 0 ? (
            <p className="text-sm text-gray-500">No recent events.</p>
          ) : (
            <ul className="divide-y divide-gray-100" role="list">
              {recentEvents.slice(0, 5).map((event) => {
                const isClickable = isProductRelatedEvent(event.type);
                const displayName =
                  event.productTitle || event.entityId || event.productId || '—';
                const formattedTime = new Date(event.timestamp).toLocaleString();

                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => handleEventClick(event)}
                      disabled={!isClickable}
                      className={`flex w-full items-center justify-between gap-4 px-2 py-3 text-left transition-colors ${
                        isClickable
                          ? 'cursor-pointer rounded-md hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2'
                          : 'cursor-default'
                      }`}
                      aria-label={`${formatEventType(event.type)} - ${displayName} at ${formattedTime}`}
                    >
                      <div className="flex flex-1 items-center gap-3 overflow-hidden">
                        <Badge variant="info" className="shrink-0">
                          {formatEventType(event.type)}
                        </Badge>
                        <span className="truncate text-sm text-gray-700">
                          {displayName}
                        </span>
                      </div>
                      <time
                        dateTime={event.timestamp}
                        className="shrink-0 text-xs text-gray-500"
                      >
                        {formattedTime}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-8 w-40 animate-pulse rounded bg-gray-200" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-lg border border-gray-200 bg-gray-100"
          />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
      <div className="h-64 animate-pulse rounded-lg border border-gray-200 bg-gray-100" />
    </div>
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function PackageIcon() {
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

function ClipboardIcon() {
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
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function CheckCircleIcon() {
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
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function AlertTriangleIcon() {
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
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
      />
    </svg>
  );
}
