'use client';

import React from 'react';
import { Skeleton } from '../feedback/Skeleton';

export type SortDirection = 'asc' | 'desc' | null;

export interface ColumnDef<T> {
  /** Unique column identifier */
  id: string;
  /** Column header label */
  header: string;
  /** Render function for cell content */
  cell: (row: T) => React.ReactNode;
  /** Whether this column is sortable */
  sortable?: boolean;
  /** Column width class (Tailwind) */
  width?: string;
}

export interface DataTableProps<T> {
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Row data */
  data: T[];
  /** Unique key extractor for each row */
  getRowKey: (row: T) => string;
  /** Whether data is currently loading */
  isLoading?: boolean;
  /** Number of skeleton rows to show while loading */
  skeletonRows?: number;
  /** Current sort column id */
  sortColumn?: string | null;
  /** Current sort direction */
  sortDirection?: SortDirection;
  /** Callback when a sortable column header is clicked */
  onSort?: (columnId: string, direction: SortDirection) => void;
  /** Callback when a row is clicked */
  onRowClick?: (row: T) => void;
  /** Current page (1-indexed) */
  page?: number;
  /** Page size (rows per page) */
  pageSize?: number;
  /** Total number of items */
  totalItems?: number;
  /** Callback to change page */
  onPageChange?: (page: number) => void;
  /** Empty state message */
  emptyMessage?: string;
  /** Table caption for accessibility */
  caption?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * DataTable - Accessible paginated data table with sort indicators, loading skeleton,
 * and ARIA labels. Supports configurable page size and keyboard navigation.
 */
export function DataTable<T>({
  columns,
  data,
  getRowKey,
  isLoading = false,
  skeletonRows = 5,
  sortColumn = null,
  sortDirection = null,
  onSort,
  onRowClick,
  page = 1,
  pageSize = 25,
  totalItems = 0,
  onPageChange,
  emptyMessage = 'No data available.',
  caption,
  className = '',
}: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const handleSort = (columnId: string) => {
    if (!onSort) return;
    let newDirection: SortDirection;
    if (sortColumn === columnId) {
      newDirection = sortDirection === 'asc' ? 'desc' : sortDirection === 'desc' ? null : 'asc';
    } else {
      newDirection = 'asc';
    }
    onSort(columnId, newDirection);
  };

  const handleKeyDown = (e: React.KeyboardEvent, columnId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSort(columnId);
    }
  };

  const handleRowKeyDown = (e: React.KeyboardEvent, row: T) => {
    if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className={`overflow-hidden rounded-lg border border-gray-200 ${className}`}>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200" aria-label={caption}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-gray-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 ${col.width ?? ''} ${
                    col.sortable ? 'cursor-pointer select-none hover:bg-gray-100' : ''
                  }`}
                  aria-sort={
                    sortColumn === col.id && sortDirection
                      ? sortDirection === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : undefined
                  }
                  {...(col.sortable
                    ? {
                        tabIndex: 0,
                        role: 'columnheader',
                        onClick: () => handleSort(col.id),
                        onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, col.id),
                      }
                    : {})}
                >
                  <div className="flex items-center gap-1">
                    <span>{col.header}</span>
                    {col.sortable && (
                      <SortIndicator
                        active={sortColumn === col.id}
                        direction={sortColumn === col.id ? sortDirection : null}
                      />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {isLoading
              ? Array.from({ length: skeletonRows }).map((_, rowIdx) => (
                  <tr key={`skeleton-${rowIdx}`}>
                    {columns.map((col) => (
                      <td key={col.id} className="px-4 py-3">
                        <Skeleton height={16} className="w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : data.length === 0
              ? (
                  <tr>
                    <td
                      colSpan={columns.length}
                      className="px-4 py-8 text-center text-sm text-gray-500"
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                )
              : data.map((row) => (
                  <tr
                    key={getRowKey(row)}
                    className={onRowClick ? 'cursor-pointer hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600' : ''}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    onKeyDown={onRowClick ? (e) => handleRowKeyDown(e, row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    role={onRowClick ? 'button' : undefined}
                    aria-label={onRowClick ? `View details` : undefined}
                  >
                    {columns.map((col) => (
                      <td key={col.id} className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalItems > 0 && onPageChange && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={totalItems}
          pageSize={pageSize}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}

// --- Sort Indicator ---

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  return (
    <span className="inline-flex flex-col" aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`h-3 w-3 ${active && direction === 'asc' ? 'text-gray-900' : 'text-gray-300'}`}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path fillRule="evenodd" d="M10 5l-5 5h10l-5-5z" clipRule="evenodd" />
      </svg>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`-mt-1 h-3 w-3 ${active && direction === 'desc' ? 'text-gray-900' : 'text-gray-300'}`}
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path fillRule="evenodd" d="M10 15l5-5H5l5 5z" clipRule="evenodd" />
      </svg>
    </span>
  );
}

// --- Pagination ---

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function Pagination({ page, totalPages, totalItems, pageSize, onPageChange }: PaginationProps) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <nav
      className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3"
      aria-label="Table pagination"
    >
      <p className="text-sm text-gray-500">
        Showing <span className="font-medium">{start}</span> to{' '}
        <span className="font-medium">{end}</span> of{' '}
        <span className="font-medium">{totalItems}</span> results
      </p>
      <div className="flex gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          aria-label="Previous page"
        >
          Previous
        </button>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
