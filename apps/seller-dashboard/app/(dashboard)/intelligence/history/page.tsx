'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';

// ─── Types ───────────────────────────────────────────────────────────────────

type GenerationType =
  | 'title'
  | 'description'
  | 'bullets'
  | 'seo'
  | 'category'
  | 'brand'
  | 'attributes'
  | 'keywords'
  | 'compliance';

interface HistoryItem {
  resultId: string;
  type: GenerationType;
  status: 'completed' | 'failed';
  confidenceScore: number;
  reviewRecommended: boolean;
  metadata: {
    tokenUsage: { inputTokens: number; outputTokens: number };
    cached: boolean;
    modelId: string;
    latencyMs: number;
    marketplace?: string;
    marketplaceCompliance?: 'compliant' | 'warnings' | 'non_compliant';
  };
  createdAt: string;
}

interface HistoryResponse {
  results: HistoryItem[];
  lastEvaluatedKey?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const GENERATION_TYPE_LABELS: Record<GenerationType, string> = {
  title: 'Product Title',
  description: 'Product Description',
  bullets: 'Bullet Points',
  seo: 'SEO Optimization',
  category: 'Category Prediction',
  brand: 'Brand Detection',
  attributes: 'Attribute Extraction',
  keywords: 'Keyword Generation',
  compliance: 'Compliance Validation',
};

const PAGE_SIZE = 20;

/** Approximate cost per 1000 tokens (input + output combined) in USD */
const COST_PER_1K_TOKENS = 0.003;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function estimateCost(inputTokens: number, outputTokens: number): string {
  const totalTokens = inputTokens + outputTokens;
  const cost = (totalTokens / 1000) * COST_PER_1K_TOKENS;
  return cost < 0.01 ? `<$0.01` : `$${cost.toFixed(3)}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Data Fetching ───────────────────────────────────────────────────────────

async function fetchHistory(params: {
  limit: number;
  lastEvaluatedKey?: string;
  type?: GenerationType;
}): Promise<HistoryResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('limit', String(params.limit));
  if (params.lastEvaluatedKey) {
    searchParams.set('lastEvaluatedKey', params.lastEvaluatedKey);
  }
  if (params.type) {
    searchParams.set('type', params.type);
  }

  const response = await fetch(`/api/intelligence/history?${searchParams.toString()}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error?.message ?? `Request failed with status ${response.status}`);
  }

  return response.json();
}

// ─── Page Component ──────────────────────────────────────────────────────────

/**
 * IntelligenceHistoryPage — Displays paginated generation history for the seller.
 *
 * Shows past generation requests with type, status, confidence score,
 * token usage, cost estimate, and creation date. Supports filtering by
 * generation type and cursor-based pagination.
 *
 * Validates: Requirements 18.5
 */
export default function IntelligenceHistoryPage() {
  const [typeFilter, setTypeFilter] = useState<GenerationType | ''>('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, error, isFetching } = useQuery<HistoryResponse, Error>({
    queryKey: ['intelligence-history', typeFilter, currentCursor],
    queryFn: () =>
      fetchHistory({
        limit: PAGE_SIZE,
        lastEvaluatedKey: currentCursor,
        type: typeFilter || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const handleTypeFilterChange = useCallback((newType: GenerationType | '') => {
    setTypeFilter(newType);
    setCursorStack([]);
    setCurrentCursor(undefined);
  }, []);

  const handleNextPage = useCallback(() => {
    if (data?.lastEvaluatedKey) {
      setCursorStack((prev) => [...prev, currentCursor ?? '']);
      setCurrentCursor(data.lastEvaluatedKey);
    }
  }, [data?.lastEvaluatedKey, currentCursor]);

  const handlePrevPage = useCallback(() => {
    setCursorStack((prev) => {
      const newStack = [...prev];
      const prevCursor = newStack.pop();
      setCurrentCursor(prevCursor || undefined);
      return newStack;
    });
  }, []);

  const currentPage = cursorStack.length + 1;

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Generation History</h1>
          <p className="mt-1 text-sm text-gray-600">
            View past AI content generation requests with status, cost, and results.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="typeFilter" className="text-sm font-medium text-gray-700">
              Filter by Type:
            </label>
            <select
              id="typeFilter"
              value={typeFilter}
              onChange={(e) => handleTypeFilterChange(e.target.value as GenerationType | '')}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              {(Object.entries(GENERATION_TYPE_LABELS) as [GenerationType, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </select>
          </div>
          {isFetching && !isLoading && (
            <span className="text-xs text-gray-500">Updating...</span>
          )}
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <svg
            className="animate-spin h-6 w-6 text-blue-600"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="ml-2 text-sm text-gray-600">Loading history...</span>
        </div>
      )}

      {/* Error State */}
      {isError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">
            <span className="font-medium">Error loading history:</span>{' '}
            {error?.message ?? 'An unexpected error occurred'}
          </p>
        </div>
      )}

      {/* Results Table */}
      {!isLoading && data && (
        <>
          {data.results.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-12 text-center shadow-sm">
              <p className="text-sm text-gray-500">
                No generation history found.
                {typeFilter && ' Try changing the filter.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Type
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Confidence
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Tokens Used
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Est. Cost
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                    >
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {data.results.map((item) => {
                    const confidenceColor =
                      item.confidenceScore >= 0.7
                        ? 'bg-green-100 text-green-800'
                        : item.confidenceScore >= 0.5
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800';

                    const statusColor =
                      item.status === 'completed'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800';

                    const totalTokens =
                      item.metadata.tokenUsage.inputTokens +
                      item.metadata.tokenUsage.outputTokens;

                    return (
                      <tr key={item.resultId} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                          {GENERATION_TYPE_LABELS[item.type] ?? item.type}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${confidenceColor}`}
                          >
                            {(item.confidenceScore * 100).toFixed(0)}%
                          </span>
                          {item.reviewRecommended && (
                            <span
                              className="ml-1 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                              title="Review recommended"
                            >
                              ⚠
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {totalTokens.toLocaleString()}
                          <span className="ml-1 text-xs text-gray-400">
                            ({item.metadata.tokenUsage.inputTokens} in /{' '}
                            {item.metadata.tokenUsage.outputTokens} out)
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                          {estimateCost(
                            item.metadata.tokenUsage.inputTokens,
                            item.metadata.tokenUsage.outputTokens
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                          {formatDate(item.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              Page {currentPage}
              {data.results.length > 0 && (
                <span className="ml-1 text-gray-400">
                  · Showing {data.results.length} result{data.results.length !== 1 ? 's' : ''}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={cursorStack.length === 0}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                aria-label="Previous page"
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={!data.lastEvaluatedKey}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                aria-label="Next page"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
