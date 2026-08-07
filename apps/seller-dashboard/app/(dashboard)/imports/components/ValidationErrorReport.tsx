'use client';

import React, { useCallback, useMemo } from 'react';
import type { FieldError } from '@merch-os/api-client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationErrorReportProps {
  errors: FieldError[];
  importJobId: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCsv(errors: FieldError[]): string {
  const headers = ['Record Index', 'Field', 'Message', 'Value'];
  const rows = errors.map((err) => [
    String(err.recordIndex),
    escapeCsvField(err.field),
    escapeCsvField(err.message),
    escapeCsvField(err.value ?? ''),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ValidationErrorReport — Displays a table of validation errors
 * with CSV download capability.
 *
 * Shows field-level error details for failed import records, allowing
 * sellers to identify and fix issues in their source data.
 *
 * Validates: Requirements 9.4
 */
export function ValidationErrorReport({ errors, importJobId }: ValidationErrorReportProps) {
  const sortedErrors = useMemo(
    () => [...errors].sort((a, b) => a.recordIndex - b.recordIndex || a.field.localeCompare(b.field)),
    [errors]
  );

  const handleDownload = useCallback(() => {
    const csv = generateCsv(sortedErrors);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `validation-errors-${importJobId}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [sortedErrors, importJobId]);

  if (errors.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900">
          Validation Errors ({errors.length})
        </h3>
        <button
          type="button"
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          aria-label="Download validation errors as CSV"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Download CSV
        </button>
      </div>

      {/* Error Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm" role="table">
          <caption className="sr-only">Validation error details</caption>
          <thead>
            <tr className="bg-gray-50">
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              >
                Row
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              >
                Field
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              >
                Error
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {sortedErrors.map((error, index) => (
              <tr key={`${error.recordIndex}-${error.field}-${index}`}>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {error.recordIndex + 1}
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">
                  {error.field}
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {error.message}
                </td>
                <td className="max-w-[200px] truncate px-3 py-2 text-gray-500">
                  {error.value ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sortedErrors.length > 50 && (
        <p className="text-xs text-gray-500">
          Showing all {sortedErrors.length} errors. Download the CSV for easier review.
        </p>
      )}
    </div>
  );
}
