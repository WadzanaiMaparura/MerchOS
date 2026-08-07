'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSuppliers } from '@merch-os/api-client';
import type { SupplierSummary } from '@merch-os/api-client';
import { DataTable } from '@merch-os/ui';
import type { ColumnDef } from '@merch-os/ui';

// ─── Constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatDuplicateStrategy(strategy: string): string {
  const map: Record<string, string> = {
    SKIP: 'Skip Duplicates',
    MERGE: 'Merge Duplicates',
    CREATE_FLAGGED: 'Flag Duplicates',
  };
  return map[strategy] ?? strategy;
}

// ─── Column Definitions ──────────────────────────────────────────────────────

const columns: ColumnDef<SupplierSummary>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (row) => (
      <span className="font-medium text-gray-900">{row.name}</span>
    ),
    sortable: false,
  },
  {
    id: 'contactEmail',
    header: 'Email',
    cell: (row) => row.contactEmail ?? '—',
    sortable: false,
  },
  {
    id: 'website',
    header: 'Website',
    cell: (row) =>
      row.website ? (
        <span className="truncate text-sm text-blue-600">{row.website}</span>
      ) : (
        '—'
      ),
    sortable: false,
  },
  {
    id: 'duplicateStrategy',
    header: 'Duplicate Strategy',
    cell: (row) => formatDuplicateStrategy(row.duplicateStrategy),
    sortable: false,
    width: 'w-[160px]',
  },
  {
    id: 'version',
    header: 'Version',
    cell: (row) => `v${row.version}`,
    sortable: false,
    width: 'w-[80px]',
  },
  {
    id: 'updatedAt',
    header: 'Last Updated',
    cell: (row) => formatDate(row.updatedAt),
    sortable: false,
    width: 'w-[180px]',
  },
];

// ─── Page Component ──────────────────────────────────────────────────────────

/**
 * SuppliersPage — Paginated supplier list.
 *
 * Displays all supplier profiles for the tenant with cursor-based pagination.
 *
 * Validates: Requirements 1.1, 1.4
 */
export default function SuppliersPage() {
  const router = useRouter();

  // Cursor-based pagination state
  const [cursors, setCursors] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const currentCursor = cursors[currentPage - 2];

  const queryParams = {
    limit: PAGE_SIZE,
    ...(currentCursor && { lastEvaluatedKey: currentCursor }),
  };

  const { data, isLoading } = useSuppliers(queryParams);

  const suppliers = data?.suppliers ?? [];
  const hasNextPage = !!data?.lastEvaluatedKey;

  const handleNextPage = useCallback(() => {
    if (data?.lastEvaluatedKey) {
      setCursors((prev) => {
        const newCursors = [...prev];
        newCursors[currentPage - 1] = data.lastEvaluatedKey!;
        return newCursors;
      });
      setCurrentPage((p) => p + 1);
    }
  }, [data?.lastEvaluatedKey, currentPage]);

  const handlePreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage((p) => p - 1);
    }
  }, [currentPage]);

  const handleRowClick = useCallback(
    (row: SupplierSummary) => {
      router.push(`/suppliers/${row.supplierId}`);
    },
    [router]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Suppliers</h1>
        <button
          type="button"
          onClick={() => router.push('/suppliers/new')}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Add Supplier
        </button>
      </div>

      {/* Supplier List Table */}
      <DataTable<SupplierSummary>
        columns={columns}
        data={suppliers}
        getRowKey={(row) => row.supplierId}
        isLoading={isLoading}
        skeletonRows={PAGE_SIZE}
        onRowClick={handleRowClick}
        emptyMessage="No suppliers found. Add your first supplier to get started."
        caption="Suppliers"
      />

      {/* Cursor-based Pagination Controls */}
      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-600">
          Page {currentPage}
          {suppliers.length > 0 && ` · ${suppliers.length} results`}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePreviousPage}
            disabled={currentPage <= 1}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            aria-label="Previous page"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={handleNextPage}
            disabled={!hasNextPage}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
