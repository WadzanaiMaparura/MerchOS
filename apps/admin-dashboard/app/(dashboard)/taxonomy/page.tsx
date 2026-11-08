'use client';

import React, { useState } from 'react';
import { useTaxonomyList, useTriggerTaxonomyRefresh } from '@merch-os/api-client';
import type { TaxonomyStatus } from '@merch-os/types';
import { Badge, Card, Alert, Skeleton } from '@merch-os/ui';

// ─── Taxonomy Status Badge ────────────────────────────────────────────────────

function TaxonomyStatusBadge({ status }: { status: TaxonomyStatus['status'] }) {
  if (status === 'CURRENT') {
    return <Badge variant="success">CURRENT</Badge>;
  }
  if (status === 'STALE') {
    return <Badge variant="warning">STALE</Badge>;
  }
  // REFRESHING
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg
        className="h-4 w-4 animate-spin text-blue-500"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <Badge variant="info">REFRESHING</Badge>
    </span>
  );
}

// ─── Taxonomy Row ─────────────────────────────────────────────────────────────

interface TaxonomyRowProps {
  taxonomy: TaxonomyStatus;
  onRefresh: (channelId: string) => void;
  isRefreshing: boolean;
  refreshError: string | null;
}

function TaxonomyRow({ taxonomy, onRefresh, isRefreshing, refreshError }: TaxonomyRowProps) {
  const isDisabled = taxonomy.status === 'REFRESHING' || isRefreshing;

  return (
    <tr
      className={
        taxonomy.status === 'REFRESHING'
          ? 'bg-blue-50'
          : taxonomy.status === 'STALE'
          ? 'bg-amber-50'
          : 'bg-white hover:bg-gray-50'
      }
    >
      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
        {taxonomy.channelName}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
        {taxonomy.version}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
        {new Date(taxonomy.lastRefreshDate).toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
        {taxonomy.nodeCount.toLocaleString()}
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <TaxonomyStatusBadge status={taxonomy.status} />
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onRefresh(taxonomy.channelId)}
            disabled={isDisabled}
            aria-label={`Refresh taxonomy for ${taxonomy.channelName}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRefreshing ? (
              <>
                <svg
                  className="h-3 w-3 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Requesting…
              </>
            ) : (
              <>
                <svg
                  className="h-3 w-3"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </>
            )}
          </button>
          {refreshError && (
            <p className="text-xs text-red-600" role="alert" aria-live="assertive">
              {refreshError}
            </p>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function TaxonomyTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="px-4 py-3">
              <Skeleton height={16} className="w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TaxonomyPage() {
  const { data: taxonomies, isLoading, isError, refetch } = useTaxonomyList();
  const triggerRefresh = useTriggerTaxonomyRefresh();

  // Track per-channel refresh state and errors
  const [refreshingChannels, setRefreshingChannels] = useState<Set<string>>(new Set());
  const [channelErrors, setChannelErrors] = useState<Record<string, string>>({});

  const handleRefresh = async (channelId: string) => {
    setRefreshingChannels((prev) => new Set(prev).add(channelId));
    setChannelErrors((prev) => {
      const next = { ...prev };
      delete next[channelId];
      return next;
    });

    try {
      await triggerRefresh.mutateAsync({ channelId });
    } catch (err) {
      const channelName =
        taxonomies?.find((t) => t.channelId === channelId)?.channelName ?? channelId;
      setChannelErrors((prev) => ({
        ...prev,
        [channelId]: `Failed to refresh ${channelName}. Please try again.`,
      }));
    } finally {
      setRefreshingChannels((prev) => {
        const next = new Set(prev);
        next.delete(channelId);
        return next;
      });
    }
  };

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Taxonomy Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Monitor channel taxonomy status and trigger refreshes to keep category mappings current.
        </p>
      </div>

      {isError && (
        <Alert
          variant="error"
          title="Failed to load taxonomy data"
          className="mb-4"
        >
          Taxonomy data is temporarily unavailable.{' '}
          <button
            onClick={() => refetch()}
            className="font-medium underline hover:no-underline focus-visible:outline-none"
          >
            Retry
          </button>
        </Alert>
      )}

      <Card padding="none">
        <div className="overflow-x-auto">
          <table
            className="min-w-full divide-y divide-gray-200"
            aria-label="Channel taxonomy status"
          >
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Channel
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Version
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Last Refresh
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Node Count
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Status
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <TaxonomyTableSkeleton />
              ) : !isError && taxonomies?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    No taxonomy channels found.
                  </td>
                </tr>
              ) : (
                taxonomies?.map((taxonomy) => (
                  <TaxonomyRow
                    key={taxonomy.channelId}
                    taxonomy={taxonomy}
                    onRefresh={handleRefresh}
                    isRefreshing={refreshingChannels.has(taxonomy.channelId)}
                    refreshError={channelErrors[taxonomy.channelId] ?? null}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
