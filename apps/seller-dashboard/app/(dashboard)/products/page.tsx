'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useProducts, useProductSearch } from '@merch-os/api-client';
import { useRole } from '@merch-os/auth';
import { DataTable, Select, Input, LifecycleBadge } from '@merch-os/ui';
import type { ColumnDef } from '@merch-os/ui';
import type { ProductSummary, LifecycleState } from '@merch-os/types';
import { CSVUploadModal } from './components/CSVUploadModal';
import { ProductExportPanel } from './components/ProductExportPanel';

/**
 * Extended ProductSummary including brand field returned by the list API.
 * The base ProductSummary type may not include brand, but the API includes it
 * per requirement 5.1 for the product list view.
 */
interface ProductListItem extends ProductSummary {
  brand?: string;
}

const PAGE_SIZE = 25;
const MAX_EXPORT_SELECTION = 500;

const LIFECYCLE_OPTIONS = [
  { value: '', label: 'All States' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'INGESTED', label: 'Ingested' },
  { value: 'ENRICHED', label: 'Enriched' },
  { value: 'REVIEW', label: 'Review' },
  { value: 'VALIDATED', label: 'Validated' },
  { value: 'EXPORT_READY', label: 'Export Ready' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const columns: ColumnDef<ProductListItem>[] = [
  {
    id: 'sku',
    header: 'SKU',
    cell: (row) => row.sku,
    sortable: true,
    width: 'w-[140px]',
  },
  {
    id: 'title',
    header: 'Title',
    cell: (row) => row.title,
    sortable: true,
  },
  {
    id: 'brand',
    header: 'Brand',
    cell: (row) => row.brand ?? '—',
    sortable: true,
    width: 'w-[160px]',
  },
  {
    id: 'lifecycleState',
    header: 'State',
    cell: (row) => <LifecycleBadge state={row.lifecycleState} />,
    sortable: true,
    width: 'w-[130px]',
  },
  {
    id: 'updatedAt',
    header: 'Last Updated',
    cell: (row) => formatDate(row.updatedAt),
    sortable: true,
    width: 'w-[160px]',
  },
];

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

export default function ProductsPage() {
  const router = useRouter();
  const role = useRole();

  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('');
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(null);

  // CSV Upload modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Bulk selection state for export (Requirement 5.11)
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  // Determine whether to use search hook or regular products hook
  const isSearching = searchQuery.length >= 2;

  // Regular paginated product list (used when not searching)
  const productsQuery = useProducts({
    page,
    pageSize: PAGE_SIZE,
    lifecycleState: lifecycleFilter ? (lifecycleFilter as LifecycleState) : undefined,
    sortBy: sortColumn as 'title' | 'createdAt' | 'updatedAt' | 'lifecycleState' | undefined,
    sortOrder: sortDirection ?? undefined,
  });

  // Search with debounce (used when searching)
  const searchQuery_ = useProductSearch(searchQuery, {
    page,
    pageSize: PAGE_SIZE,
    lifecycleState: lifecycleFilter ? (lifecycleFilter as LifecycleState) : undefined,
    sortBy: sortColumn as 'title' | 'createdAt' | 'updatedAt' | 'lifecycleState' | undefined,
    sortOrder: sortDirection ?? undefined,
  });

  // Use search results when searching, otherwise regular results
  const activeQuery = isSearching ? searchQuery_ : productsQuery;
  const data = activeQuery.data?.items ?? [];
  const totalItems = activeQuery.data?.total ?? 0;
  const isLoading = activeQuery.isLoading;

  const handleRowClick = useCallback(
    (row: ProductListItem) => {
      router.push(`/products/${row.productId}`);
    },
    [router]
  );

  const handleSort = useCallback(
    (columnId: string, direction: 'asc' | 'desc' | null) => {
      setSortColumn(direction ? columnId : null);
      setSortDirection(direction);
      setPage(1);
    },
    []
  );

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
      setPage(1);
    },
    []
  );

  const handleLifecycleChange = useCallback((value: string) => {
    setLifecycleFilter(value);
    setPage(1);
  }, []);

  // Bulk selection handlers
  const handleSelectProduct = useCallback((productId: string) => {
    setSelectedProductIds((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      }
      if (prev.length >= MAX_EXPORT_SELECTION) return prev;
      return [...prev, productId];
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const currentPageIds = data.map((p) => p.productId);
    setSelectedProductIds((prev) => {
      const allSelected = currentPageIds.every((id) => prev.includes(id));
      if (allSelected) {
        // Deselect all on current page
        return prev.filter((id) => !currentPageIds.includes(id));
      }
      // Select all on current page (respecting max limit)
      const newIds = currentPageIds.filter((id) => !prev.includes(id));
      const remaining = MAX_EXPORT_SELECTION - prev.length;
      return [...prev, ...newIds.slice(0, remaining)];
    });
  }, [data]);

  const handleClearSelection = useCallback(() => {
    setSelectedProductIds([]);
  }, []);

  const handleExportSuccess = useCallback(() => {
    // Optionally clear selection after successful export
    // Per requirement 5.12, we preserve selection on failure; clear on success is a UX choice
    setSelectedProductIds([]);
  }, []);

  const isViewer = role === 'viewer';

  // Determine if all items on current page are selected
  const currentPageIds = data.map((p) => p.productId);
  const allCurrentPageSelected =
    currentPageIds.length > 0 && currentPageIds.every((id) => selectedProductIds.includes(id));

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Products</h1>
        {!isViewer && (
          <div className="flex gap-2">
            {/* Create/edit/delete controls hidden for viewer role */}
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              onClick={() => setIsUploadModalOpen(true)}
            >
              Upload CSV
            </button>
          </div>
        )}
      </div>

      {/* Export Panel - shown when products are selected (editor+ only) */}
      {!isViewer && selectedProductIds.length > 0 && (
        <ProductExportPanel
          selectedProductIds={selectedProductIds}
          onExportSuccess={handleExportSuccess}
        />
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 max-w-md">
          <Input
            label="Search"
            placeholder="Search by SKU, title, or brand (min 2 chars)"
            value={searchQuery}
            onChange={handleSearchChange}
            aria-label="Search products by SKU, title, or brand"
          />
        </div>
        <div className="w-48">
          <Select
            label="Lifecycle State"
            value={lifecycleFilter}
            onValueChange={handleLifecycleChange}
            options={LIFECYCLE_OPTIONS}
            placeholder="All States"
          />
        </div>
        {!isViewer && selectedProductIds.length > 0 && (
          <button
            type="button"
            onClick={handleClearSelection}
            className="text-sm text-gray-600 underline hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Clear selection ({selectedProductIds.length})
          </button>
        )}
      </div>

      {/* Bulk selection header for editor+ */}
      {!isViewer && data.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={allCurrentPageSelected}
              onChange={handleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
              aria-label="Select all products on this page"
            />
            Select all on page
          </label>
          {selectedProductIds.length > 0 && (
            <span className="text-sm text-gray-500">
              {selectedProductIds.length} of {MAX_EXPORT_SELECTION} max selected
            </span>
          )}
        </div>
      )}

      {/* Data Table with selection checkboxes */}
      <DataTable<ProductListItem>
        columns={
          !isViewer
            ? [
                {
                  id: 'select',
                  header: '',
                  cell: (row) => (
                    <input
                      type="checkbox"
                      checked={selectedProductIds.includes(row.productId)}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleSelectProduct(row.productId);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-600"
                      aria-label={`Select product ${row.title}`}
                    />
                  ),
                  sortable: false,
                  width: 'w-[40px]',
                },
                ...columns,
              ]
            : columns
        }
        data={data as ProductListItem[]}
        getRowKey={(row) => row.productId}
        isLoading={isLoading}
        skeletonRows={PAGE_SIZE}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSort}
        onRowClick={handleRowClick}
        page={page}
        pageSize={PAGE_SIZE}
        totalItems={totalItems}
        onPageChange={handlePageChange}
        emptyMessage="No products found."
        caption="Product catalog"
      />

      {/* CSV Upload Modal (Requirement 5.9, 5.10) */}
      {!isViewer && (
        <CSVUploadModal
          open={isUploadModalOpen}
          onOpenChange={setIsUploadModalOpen}
        />
      )}
    </div>
  );
}
