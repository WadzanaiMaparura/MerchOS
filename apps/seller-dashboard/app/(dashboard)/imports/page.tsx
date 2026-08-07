'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useImportJobs } from '@merch-os/api-client';
import type { ImportJobSummary } from '@merch-os/api-client';
import { DataTable } from '@merch-os/ui';
import type { ColumnDef } from '@merch-os/ui';
import { ImportFilters } from './components/ImportFilters';
import type { ImportFiltersState } from './components/ImportFilters';

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

function formatSourceType(sourceType: string): string {
  const map: Record<string, string> = {
    FILE_CSV: 'CSV',
    FILE_EXCEL: 'Excel',
    FILE_PDF: 'PDF',
    FILE_ZIP: 'ZIP',
    IMAGE: 'Image / OCR',
    URL: 'URL Crawl',
  };
  return map[sourceType] ?? sourceType;
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    QUEUED: 'Queued',
    PROCESSING: 'Processing',
    VALIDATING: 'Validating',
    PERSISTING: 'Persisting',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
  };
  return map[status] ?? status;
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-green-100 text-green-800';
    case 'FAILED':
      return 'bg-red-100 text-red-800';
    case 'PROCESSING':
    case 'VALIDATING':
    case 'PERSISTING':
      return 'bg-blue-100 text-blue-800';
    case 'QUEUED':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function formatResultSummary(job: ImportJobSummary): string {
  if (!job.results) {
    if (job.status === 'QUEUED') return 'Waiting…';
    if (job.status === 'FAILED') return 'Failed';
    if (job.progress) return `${job.progress.percentage}%`;
    return '—';
  }

  const { totalExtracted, created, updated, duplicates, validationFailed } = job.results;
  const parts: string[] = [];
  parts.push(`${totalExtracted} extracted`);
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (duplicates > 0) parts.push(`${duplicates} dupes`);
  if (validationFailed > 0) parts.push(`${validationFailed} failed`);
  return parts.join(', ');
}

// ─── Status Badge Component ──────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getStatusColor(status)}`}
    >
      {formatStatus(status)}
    </span>
  );
}

// ─── Column Definitions ──────────────────────────────────────────────────────

const columns: ColumnDef<ImportJobSummary>[] = [
  {
    id: 'status',
    header: 'Status',
    cell: (row) => <StatusBadge status={row.status} />,
    sortable: false,
    width: 'w-[120px]',
  },
  {
    id: 'supplierId',
    header: 'Supplier',
    cell: (row) => row.supplierName ?? row.supplierId,
    sortable: false,
  },
  {
    id: 'sourceType',
    header: 'Source',
    cell: (row) => formatSourceType(row.sourceType),
    sortable: false,
    width: 'w-[120px]',
  },
  {
    id: 'createdAt',
    header: 'Created',
    cell: (row) => formatDate(row.createdAt),
    sortable: false,
    width: 'w-[180px]',
  },
  {
    id: 'results',
    header: 'Results',
    cell: (row) => (
      <span className="text-sm text-gray-600">{formatResultSummary(row)}</span>
    ),
    sortable: false,
  },
];

// ─── Page Component ──────────────────────────────────────────────────────────

/**
 * ImportsPage — Paginated import job list with filters.
 *
 * Displays all import jobs for the tenant with filtering by status,
 * supplier, source type, and date range. Supports cursor-based pagination.
 *
 * Validates: Requirements 9.1, 9.3, 9.5
 */
export default function ImportsPage() {
  const router = useRouter();

  // Filter state
  const [filters, setFilters] = useState<ImportFiltersState>({
    status: '',
    supplierId: '',
    sourceType: '',
    startDate: '',
    endDate: '',
  });

  // Cursor-based pagination state
  const [cursors, setCursors] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  // Build query params from filters and current cursor
  const currentCursor = cursors[currentPage - 2]; // cursors[0] is the key to page 2

  const queryParams = {
    ...(filters.status && { status: filters.status }),
    ...(filters.supplierId && { supplierId: filters.supplierId }),
    ...(filters.sourceType && { sourceType: filters.sourceType }),
    ...(filters.startDate && { startDate: filters.startDate }),
    ...(filters.endDate && { endDate: filters.endDate }),
    limit: PAGE_SIZE,
    ...(currentCursor && { lastEvaluatedKey: currentCursor }),
  };

  const { data, isLoading } = useImportJobs(queryParams);

  const importJobs = data?.importJobs ?? [];
  const hasNextPage = !!data?.lastEvaluatedKey;

  // Pagination handlers for cursor-based pagination
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

  // Reset pagination when filters change
  const handleFiltersChange = useCallback((newFilters: ImportFiltersState) => {
    setFilters(newFilters);
    setCursors([]);
    setCurrentPage(1);
  }, []);

  const handleRowClick = useCallback(
    (row: ImportJobSummary) => {
      router.push(`/imports/${row.importJobId}`);
    },
    [router]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Imports</h1>
      </div>

      {/* Filters */}
      <ImportFilters filters={filters} onFiltersChange={handleFiltersChange} />

      {/* Import Job List Table */}
      <DataTable<ImportJobSummary>
        columns={columns}
        data={importJobs}
        getRowKey={(row) => row.importJobId}
        isLoading={isLoading}
        skeletonRows={PAGE_SIZE}
        onRowClick={handleRowClick}
        emptyMessage="No import jobs found."
        caption="Import jobs"
      />

      {/* Cursor-based Pagination Controls */}
      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-600">
          Page {currentPage}
          {importJobs.length > 0 && ` · ${importJobs.length} results`}
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
