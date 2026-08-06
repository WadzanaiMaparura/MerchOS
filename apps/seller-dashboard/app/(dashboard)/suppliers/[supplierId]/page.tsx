'use client';

import React, { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  useSupplierDetail,
  useSupplierVersions,
  useSupplierImports,
} from '@merch-os/api-client';
import type { SupplierVersion, ImportJobSummary } from '@merch-os/api-client';
import { Badge, Skeleton, Tabs, DataTable, FileUpload, Input } from '@merch-os/ui';
import type { BadgeVariant, ColumnDef, TabItem } from '@merch-os/ui';

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

function getStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
      return 'error';
    case 'PROCESSING':
    case 'VALIDATING':
    case 'PERSISTING':
      return 'info';
    case 'QUEUED':
    default:
      return 'neutral';
  }
}

// ─── Import History Columns ──────────────────────────────────────────────────

const importColumns: ColumnDef<ImportJobSummary>[] = [
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <Badge variant={getStatusBadgeVariant(row.status)}>
        {formatStatus(row.status)}
      </Badge>
    ),
    sortable: false,
    width: 'w-[120px]',
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
    cell: (row) => {
      if (!row.results) return '—';
      return `${row.results.totalExtracted} extracted, ${row.results.created} created`;
    },
    sortable: false,
  },
];

// ─── Detail Row Component ────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="text-sm font-medium text-gray-500 sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

// ─── Import Trigger Section ──────────────────────────────────────────────────

function ImportTriggerSection({ supplierId }: { supplierId: string }) {
  const [urlValue, setUrlValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setIsSubmitting(true);
      try {
        // POST /suppliers/{supplierId}/imports/file
        // This would use the api client, simplified for now
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));
        // Trigger handled by parent form/mutation — placeholder for wiring
        console.info('[ImportTrigger] File import triggered', { supplierId, fileCount: files.length });
      } finally {
        setIsSubmitting(false);
      }
    },
    [supplierId]
  );

  const handleImageUpload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setIsSubmitting(true);
      try {
        console.info('[ImportTrigger] Image import triggered', { supplierId, fileCount: files.length });
      } finally {
        setIsSubmitting(false);
      }
    },
    [supplierId]
  );

  const handleUrlImport = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!urlValue.trim()) return;
      setIsSubmitting(true);
      try {
        console.info('[ImportTrigger] URL import triggered', { supplierId, url: urlValue });
      } finally {
        setIsSubmitting(false);
        setUrlValue('');
      }
    },
    [supplierId, urlValue]
  );

  const importTabs: TabItem[] = [
    {
      value: 'file',
      label: 'File Upload',
      content: (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Upload CSV, Excel, PDF, or ZIP files containing product data.
          </p>
          <FileUpload
            label="Product data file"
            acceptedTypes={[
              'text/csv',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/pdf',
              'application/zip',
            ]}
            maxSizeBytes={50 * 1024 * 1024}
            multiple
            onFilesSelected={handleFileUpload}
            disabled={isSubmitting}
            hint="CSV, Excel, PDF, or ZIP up to 50 MB"
          />
        </div>
      ),
    },
    {
      value: 'image',
      label: 'Image Upload',
      content: (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Upload product images for OCR extraction. Text will be extracted
            using optical character recognition.
          </p>
          <FileUpload
            label="Product images"
            acceptedTypes={['image/jpeg', 'image/png', 'image/webp']}
            maxSizeBytes={20 * 1024 * 1024}
            multiple
            onFilesSelected={handleImageUpload}
            disabled={isSubmitting}
            hint="JPEG, PNG, or WebP up to 20 MB each"
          />
        </div>
      ),
    },
    {
      value: 'url',
      label: 'URL Import',
      content: (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-600">
            Provide a supplier website URL to crawl and extract product data
            automatically.
          </p>
          <form onSubmit={handleUrlImport} className="flex flex-col gap-3">
            <Input
              label="Supplier website URL"
              type="text"
              placeholder="https://supplier-website.com/products"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              disabled={isSubmitting}
              aria-label="Supplier website URL for import"
            />
            <div>
              <button
                type="submit"
                disabled={isSubmitting || !urlValue.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
              >
                {isSubmitting ? 'Starting import…' : 'Start Import'}
              </button>
            </div>
          </form>
        </div>
      ),
    },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="mb-4 text-sm font-medium text-gray-900">Import Products</h2>
      <Tabs tabs={importTabs} defaultValue="file" ariaLabel="Import method" />
    </div>
  );
}

// ─── Version History Section ─────────────────────────────────────────────────

function VersionHistorySection({ supplierId }: { supplierId: string }) {
  const { data, isLoading } = useSupplierVersions(supplierId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const versions = data?.versions ?? [];

  if (versions.length === 0) {
    return (
      <p className="text-sm text-gray-500">No version history available.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {versions.map((version: SupplierVersion) => (
        <div
          key={version.version}
          className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-3"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-gray-900">
              Version {version.version}
            </span>
            <span className="text-xs text-gray-500">
              {formatDate(version.createdAt)}
            </span>
          </div>
          <span className="text-sm text-gray-600">{version.snapshot.name}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Import History Section ──────────────────────────────────────────────────

function ImportHistorySection({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const { data, isLoading } = useSupplierImports(supplierId, { limit: 10 });

  const importJobs = data?.importJobs ?? [];

  const handleRowClick = useCallback(
    (row: ImportJobSummary) => {
      router.push(`/imports/${row.importJobId}`);
    },
    [router]
  );

  return (
    <DataTable<ImportJobSummary>
      columns={importColumns}
      data={importJobs}
      getRowKey={(row) => row.importJobId}
      isLoading={isLoading}
      skeletonRows={5}
      onRowClick={handleRowClick}
      emptyMessage="No imports yet for this supplier."
      caption="Supplier import history"
    />
  );
}

// ─── Page Component ──────────────────────────────────────────────────────────

/**
 * SupplierDetailPage — Shows supplier info, import trigger, import history,
 * and version history.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 10.3
 */
export default function SupplierDetailPage() {
  const params = useParams<{ supplierId: string }>();
  const router = useRouter();
  const supplierId = params.supplierId;

  const { data: supplier, isLoading, error } = useSupplierDetail(supplierId);

  // ─── Loading State ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // ─── Error State ─────────────────────────────────────────────────────────

  if (error || !supplier) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <p className="text-sm text-gray-600">
          {error?.message ?? 'Supplier not found.'}
        </p>
        <button
          type="button"
          onClick={() => router.push('/suppliers')}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Back to Suppliers
        </button>
      </div>
    );
  }

  // ─── Detail Tabs ─────────────────────────────────────────────────────────

  const detailTabs: TabItem[] = [
    {
      value: 'imports',
      label: 'Import History',
      content: <ImportHistorySection supplierId={supplierId} />,
    },
    {
      value: 'versions',
      label: 'Version History',
      content: <VersionHistorySection supplierId={supplierId} />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/suppliers')}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            aria-label="Back to suppliers list"
          >
            <svg
              className="mr-1 h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Suppliers
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">{supplier.name}</h1>
        </div>
        <Badge variant="neutral">v{supplier.version}</Badge>
      </div>

      {/* Supplier Details */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-4 text-sm font-medium text-gray-900">Supplier Details</h2>
        <dl className="flex flex-col gap-3">
          <DetailRow label="Name" value={supplier.name} />
          {supplier.contactEmail && (
            <DetailRow label="Email" value={supplier.contactEmail} />
          )}
          {supplier.contactPhone && (
            <DetailRow label="Phone" value={supplier.contactPhone} />
          )}
          {supplier.website && (
            <DetailRow
              label="Website"
              value={
                <a
                  href={supplier.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {supplier.website}
                </a>
              }
            />
          )}
          {supplier.notes && <DetailRow label="Notes" value={supplier.notes} />}
          <DetailRow
            label="Duplicate Strategy"
            value={formatDuplicateStrategy(supplier.duplicateStrategy)}
          />
          <DetailRow label="Created" value={formatDate(supplier.createdAt)} />
          <DetailRow label="Last Updated" value={formatDate(supplier.updatedAt)} />
        </dl>
      </div>

      {/* Import Trigger */}
      <ImportTriggerSection supplierId={supplierId} />

      {/* Import History & Version History */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <Tabs tabs={detailTabs} defaultValue="imports" ariaLabel="Supplier history" />
      </div>
    </div>
  );
}
