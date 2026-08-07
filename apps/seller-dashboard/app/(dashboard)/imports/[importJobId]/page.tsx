'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useImportJobDetail } from '@merch-os/api-client';
import { Badge, Skeleton } from '@merch-os/ui';
import type { BadgeVariant } from '@merch-os/ui';
import { ImportProgress } from '../components/ImportProgress';
import { ValidationErrorReport } from '../components/ValidationErrorReport';

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
    FILE_CSV: 'CSV File',
    FILE_EXCEL: 'Excel File',
    FILE_PDF: 'PDF File',
    FILE_ZIP: 'ZIP Archive',
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

function formatDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const durationMs = end - start;

  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// ─── Detail Row Component ────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="text-sm font-medium text-gray-500 sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

// ─── Page Component ──────────────────────────────────────────────────────────

/**
 * ImportJobDetailPage — Shows full details for a single import job.
 *
 * Displays:
 * - Source file/URL and supplier name
 * - Real-time progress (polling every 3s for in-progress jobs)
 * - Result summary: total extracted, created, updated, duplicates, validation failures
 * - Processing duration
 * - Downloadable validation error report
 *
 * Validates: Requirements 9.2, 9.4, 8.4
 */
export default function ImportJobDetailPage() {
  const params = useParams<{ importJobId: string }>();
  const router = useRouter();
  const importJobId = params.importJobId;

  const { data: job, isLoading, error } = useImportJobDetail(importJobId);

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

  if (error || !job) {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <p className="text-sm text-gray-600">
          {error?.message ?? 'Import job not found.'}
        </p>
        <button
          type="button"
          onClick={() => router.push('/imports')}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Back to Imports
        </button>
      </div>
    );
  }

  // ─── Derived State ───────────────────────────────────────────────────────

  const isInProgress =
    job.status === 'QUEUED' ||
    job.status === 'PROCESSING' ||
    job.status === 'VALIDATING' ||
    job.status === 'PERSISTING';

  const hasValidationErrors = (job.errors?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/imports')}
            className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            aria-label="Back to imports list"
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
            Imports
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">Import Details</h1>
        </div>
        <Badge variant={getStatusBadgeVariant(job.status)}>
          {formatStatus(job.status)}
        </Badge>
      </div>

      {/* Progress Bar (shown for in-progress jobs) */}
      {(isInProgress || job.status === 'COMPLETED' || job.status === 'FAILED') && (
        <ImportProgress status={job.status} progress={job.progress} />
      )}

      {/* Import Details */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="mb-4 text-sm font-medium text-gray-900">Details</h2>
        <dl className="flex flex-col gap-3">
          <DetailRow label="Source" value={formatSourceType(job.sourceType)} />
          <DetailRow
            label="File / URL"
            value={
              <span className="break-all font-mono text-xs">
                {job.sourceReference}
              </span>
            }
          />
          <DetailRow label="Supplier" value={job.supplierName ?? job.supplierId} />
          <DetailRow label="Created" value={formatDate(job.createdAt)} />
          {job.startedAt && (
            <DetailRow label="Started" value={formatDate(job.startedAt)} />
          )}
          {job.completedAt && (
            <DetailRow label="Completed" value={formatDate(job.completedAt)} />
          )}
          <DetailRow
            label="Duration"
            value={formatDuration(job.startedAt, job.completedAt)}
          />
        </dl>
      </div>

      {/* Results Summary */}
      {job.results && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-4 text-sm font-medium text-gray-900">Results</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <ResultStat label="Total Extracted" value={job.results.totalExtracted} />
            <ResultStat label="Created" value={job.results.created} variant="success" />
            <ResultStat label="Updated" value={job.results.updated} variant="info" />
            <ResultStat label="Duplicates" value={job.results.duplicates} variant="warning" />
            <ResultStat
              label="Validation Failed"
              value={job.results.validationFailed}
              variant="danger"
            />
          </div>
        </div>
      )}

      {/* Validation Error Report */}
      {hasValidationErrors && (
        <ValidationErrorReport errors={job.errors!} importJobId={job.importJobId} />
      )}
    </div>
  );
}

// ─── Result Stat Component ───────────────────────────────────────────────────

function ResultStat({
  label,
  value,
  variant = 'neutral',
}: {
  label: string;
  value: number;
  variant?: 'neutral' | 'success' | 'info' | 'warning' | 'danger';
}) {
  const colorMap: Record<string, string> = {
    neutral: 'text-gray-900',
    success: 'text-green-700',
    info: 'text-blue-700',
    warning: 'text-yellow-700',
    danger: 'text-red-700',
  };

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-lg font-semibold ${colorMap[variant]}`}>{value}</span>
    </div>
  );
}
