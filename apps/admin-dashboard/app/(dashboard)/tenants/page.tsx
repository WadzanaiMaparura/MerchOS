'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useAdminTenants } from '@merch-os/api-client';
import type { TenantListParams } from '@merch-os/api-client';
import type { TenantSummary } from '@merch-os/types';
import { DataTable, Badge, Alert, Select } from '@merch-os/ui';
import type { ColumnDef, BadgeVariant, SelectOption } from '@merch-os/ui';
import { TenantDetailPanel } from './components/TenantDetailPanel';

/** Default page size per requirements 4.1 */
const DEFAULT_PAGE_SIZE = 25;

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const PLAN_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Plans' },
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];

/** Map tenant status → Badge variant */
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  suspended: 'error',
};

/** Map plan → Badge variant */
const PLAN_VARIANT: Record<string, BadgeVariant> = {
  starter: 'neutral',
  growth: 'info',
  professional: 'warning',
  enterprise: 'default',
};

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

/**
 * TenantsPage — Paginated tenant list with search, status and plan filters.
 * Row click opens TenantDetailPanel.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.9
 */
export default function TenantsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);

  // ── 500ms debounce on search input (Requirement 4.2) ──────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setSearchInput(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Only send search to API when 2+ chars; otherwise clear
        setDebouncedSearch(value.length >= 2 ? value : '');
        setPage(1);
      }, 500);
    },
    []
  );

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Reset to page 1 on filter changes
  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const handlePlanChange = useCallback((value: string) => {
    setPlanFilter(value);
    setPage(1);
  }, []);

  // Build query params
  const queryParams: TenantListParams = useMemo(() => {
    const params: TenantListParams = {
      page,
      pageSize: DEFAULT_PAGE_SIZE,
    };
    if (debouncedSearch) params.search = debouncedSearch;
    if (statusFilter !== 'all') params.status = statusFilter as 'active' | 'suspended';
    if (planFilter !== 'all') params.plan = planFilter;
    return params;
  }, [page, debouncedSearch, statusFilter, planFilter]);

  const { data, isLoading, isError, error, refetch } = useAdminTenants(queryParams);

  const tenants = data?.items ?? [];
  const totalItems = data?.total ?? 0;

  // Column definitions (Requirement 4.1)
  const columns: ColumnDef<TenantSummary>[] = useMemo(
    () => [
      {
        id: 'name',
        header: 'Tenant Name',
        cell: (row) => (
          <span className="font-medium text-gray-900">{row.name}</span>
        ),
        sortable: true,
        width: 'w-48',
      },
      {
        id: 'plan',
        header: 'Plan',
        cell: (row) => (
          <Badge variant={PLAN_VARIANT[row.plan] ?? 'default'}>
            {row.plan.charAt(0).toUpperCase() + row.plan.slice(1)}
          </Badge>
        ),
        width: 'w-32',
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => (
          <Badge variant={STATUS_VARIANT[row.status] ?? 'default'}>
            {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
          </Badge>
        ),
        width: 'w-28',
      },
      {
        id: 'userCount',
        header: 'Users',
        cell: (row) => row.userCount.toLocaleString(),
        width: 'w-20',
      },
      {
        id: 'productCount',
        header: 'Products',
        cell: (row) => row.productCount.toLocaleString(),
        width: 'w-24',
      },
      {
        id: 'registeredAt',
        header: 'Registered',
        cell: (row) => (
          <time dateTime={row.registeredAt}>{formatDate(row.registeredAt)}</time>
        ),
        sortable: true,
        width: 'w-36',
      },
    ],
    []
  );

  const handleRowClick = useCallback((row: TenantSummary) => {
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
            <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage all platform tenants
            </p>
          </div>

          {/* Total count */}
          {!isLoading && !isError && (
            <p className="text-sm text-gray-500" aria-live="polite">
              {totalItems.toLocaleString()} tenant{totalItems !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Filters row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {/* Search — Requirement 4.2 */}
          <div className="flex flex-col gap-1.5 flex-1 min-w-0 max-w-sm">
            <label
              htmlFor="tenant-search"
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
                id="tenant-search"
                type="text"
                value={searchInput}
                onChange={handleSearchChange}
                placeholder="Search by name or tenant ID…"
                aria-label="Search tenants by name or ID"
                className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              />
            </div>
          </div>

          {/* Status filter — Requirement 4.3 */}
          <div className="w-full sm:w-44">
            <Select
              id="status-filter"
              label="Status"
              value={statusFilter}
              onValueChange={handleStatusChange}
              options={STATUS_OPTIONS}
            />
          </div>

          {/* Plan filter — Requirement 4.4 */}
          <div className="w-full sm:w-44">
            <Select
              id="plan-filter"
              label="Plan"
              value={planFilter}
              onValueChange={handlePlanChange}
              options={PLAN_OPTIONS}
            />
          </div>
        </div>

        {/* Error state with retry — Requirement 4.9 */}
        {isError && (
          <Alert
            variant="error"
            title="Failed to load tenants"
            dismissible={false}
          >
            <p>
              {(error as { message?: string })?.message ??
                'Tenant data is temporarily unavailable.'}
            </p>
            <button
              onClick={() => refetch()}
              className="mt-2 text-sm font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1 rounded"
            >
              Retry
            </button>
          </Alert>
        )}

        {/* DataTable — Requirements 4.1, 4.5 */}
        {!isError && (
          <DataTable<TenantSummary>
            columns={columns}
            data={tenants}
            getRowKey={(row) => row.tenantId}
            isLoading={isLoading}
            skeletonRows={DEFAULT_PAGE_SIZE}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            totalItems={totalItems}
            onPageChange={setPage}
            onRowClick={handleRowClick}
            emptyMessage={
              debouncedSearch || statusFilter !== 'all' || planFilter !== 'all'
                ? 'No tenants match the current filters.'
                : 'No tenants found.'
            }
            caption="Platform tenants"
          />
        )}
      </div>

      {/* Tenant detail panel — Requirement 4.5 */}
      {selectedTenantId && (
        <TenantDetailPanel
          tenantId={selectedTenantId}
          onClose={handlePanelClose}
        />
      )}
    </div>
  );
}
