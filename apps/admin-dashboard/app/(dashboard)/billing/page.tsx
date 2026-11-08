'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAdminBillingList } from '@merch-os/api-client';
import type { AdminBillingListParams } from '@merch-os/api-client';
import type { AdminBillingSummary, SubscriptionStatus } from '@merch-os/types';
import { DataTable, Badge, Alert, Select } from '@merch-os/ui';
import type { ColumnDef, BadgeVariant, SelectOption } from '@merch-os/ui';
import { BillingDetailPanel } from './components/BillingDetailPanel';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'past_due', label: 'Past Due' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'unpaid', label: 'Unpaid' },
];

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  past_due: 'warning',
  canceled: 'error',
  trialing: 'info',
  incomplete: 'warning',
  incomplete_expired: 'error',
  unpaid: 'error',
};

const PLAN_VARIANT: Record<string, BadgeVariant> = {
  starter: 'neutral',
  growth: 'info',
  professional: 'warning',
  enterprise: 'default',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * BillingPage — Admin billing management with search, status filter,
 * paginated DataTable, and slide-out detail panel with plan override.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.7
 */
export default function BillingPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  // ── 500ms debounce (2+ chars) ─────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setDebouncedSearch(value.length >= 2 ? value : '');
        setPage(1);
      }, 500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  // Build query params
  const queryParams: AdminBillingListParams = useMemo(() => {
    const params: AdminBillingListParams = {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    };
    if (debouncedSearch) params.search = debouncedSearch;
    if (statusFilter !== 'all') params.status = statusFilter as SubscriptionStatus;
    return params;
  }, [page, debouncedSearch, statusFilter]);

  const { data, isLoading, isError, error, refetch } = useAdminBillingList(queryParams);

  const billingItems = data?.items ?? [];
  const totalItems = data?.total ?? 0;

  // ── Column definitions ────────────────────────────────────────────────────
  const columns: ColumnDef<AdminBillingSummary>[] = useMemo(
    () => [
      {
        id: 'tenantName',
        header: 'Tenant',
        cell: (row) => (
          <span className="font-medium text-gray-900">{row.tenantName}</span>
        ),
        sortable: true,
        width: 'w-48',
      },
      {
        id: 'plan',
        header: 'Plan',
        cell: (row) => (
          <Badge variant={PLAN_VARIANT[row.plan] ?? 'default'}>
            {capitalize(row.plan)}
          </Badge>
        ),
        width: 'w-32',
      },
      {
        id: 'billingCycle',
        header: 'Cycle',
        cell: (row) => (
          <span className="capitalize text-gray-700">{row.billingCycle}</span>
        ),
        width: 'w-24',
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => (
          <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>
            {capitalize(row.status)}
          </Badge>
        ),
        width: 'w-28',
      },
      {
        id: 'currentPeriodEnd',
        header: 'Period End',
        cell: (row) => (
          <time dateTime={row.currentPeriodEnd}>{formatDate(row.currentPeriodEnd)}</time>
        ),
        sortable: true,
        width: 'w-32',
      },
    ],
    []
  );

  const handleRowClick = useCallback((row: AdminBillingSummary) => {
    setSelectedTenantId(row.tenantId);
  }, []);

  const handlePanelClose = useCallback(() => {
    setSelectedTenantId(null);
  }, []);

  return (
    <div className="flex h-full gap-6">
      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-6">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage tenant subscriptions and billing status.
            </p>
          </div>

          {!isLoading && !isError && (
            <p className="text-sm text-gray-500" aria-live="polite">
              {totalItems.toLocaleString()} subscription{totalItems !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {/* Search */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-0 max-w-sm">
            <label
              htmlFor="billing-search"
              className="text-sm font-medium text-gray-700"
            >
              Search
            </label>
            <div className="relative">
              <div
                className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3"
                aria-hidden="true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                  />
                </svg>
              </div>
              <input
                id="billing-search"
                type="text"
                value={searchInput}
                onChange={handleSearchChange}
                placeholder="Search by tenant name…"
                aria-label="Search billing by tenant name"
                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              />
            </div>
          </div>

          {/* Status filter */}
          <div className="w-full sm:w-44">
            <Select
              id="billing-status-filter"
              label="Status"
              value={statusFilter}
              onValueChange={handleStatusChange}
              options={STATUS_OPTIONS}
            />
          </div>
        </div>

        {/* Error */}
        {isError && (
          <Alert variant="error" title="Failed to load billing data" dismissible={false}>
            <p>
              {(error as { message?: string })?.message ?? 'Billing data is temporarily unavailable.'}
            </p>
            <button
              onClick={() => refetch()}
              className="mt-2 text-sm font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1 rounded"
            >
              Retry
            </button>
          </Alert>
        )}

        {/* DataTable */}
        {!isError && (
          <DataTable<AdminBillingSummary>
            columns={columns}
            data={billingItems}
            getRowKey={(row) => row.tenantId}
            isLoading={isLoading}
            skeletonRows={DEFAULT_PAGE_SIZE}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={totalItems}
            onPageChange={setPage}
            onRowClick={handleRowClick}
            emptyMessage={
              debouncedSearch || statusFilter !== 'all'
                ? 'No billing entries match the current filters.'
                : 'No billing entries found.'
            }
            caption="Tenant billing"
          />
        )}
      </div>

      {/* Detail panel */}
      {selectedTenantId && (
        <BillingDetailPanel
          tenantId={selectedTenantId}
          onClose={handlePanelClose}
        />
      )}
    </div>
  );
}
