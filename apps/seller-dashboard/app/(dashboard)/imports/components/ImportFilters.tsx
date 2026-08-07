'use client';

import React, { useCallback } from 'react';
import { Select, Input } from '@merch-os/ui';
import type { ImportJobStatus, SourceType } from '@merch-os/api-client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportFiltersState {
  status: ImportJobStatus | '';
  supplierId: string;
  sourceType: SourceType | '';
  startDate: string;
  endDate: string;
}

export interface ImportFiltersProps {
  filters: ImportFiltersState;
  onFiltersChange: (filters: ImportFiltersState) => void;
}

// ─── Options ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'VALIDATING', label: 'Validating' },
  { value: 'PERSISTING', label: 'Persisting' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
];

const SOURCE_TYPE_OPTIONS = [
  { value: '', label: 'All Sources' },
  { value: 'FILE_CSV', label: 'CSV' },
  { value: 'FILE_EXCEL', label: 'Excel' },
  { value: 'FILE_PDF', label: 'PDF' },
  { value: 'FILE_ZIP', label: 'ZIP' },
  { value: 'IMAGE', label: 'Image / OCR' },
  { value: 'URL', label: 'URL Crawl' },
];

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * ImportFilters — Filter controls for the import job list page.
 *
 * Provides filtering by:
 * - Status (select dropdown)
 * - Supplier ID (text input)
 * - Source type (select dropdown)
 * - Date range (start/end date inputs)
 *
 * Validates: Requirements 9.1, 9.3, 9.5
 */
export function ImportFilters({ filters, onFiltersChange }: ImportFiltersProps) {
  const handleStatusChange = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, status: value as ImportJobStatus | '' });
    },
    [filters, onFiltersChange]
  );

  const handleSourceTypeChange = useCallback(
    (value: string) => {
      onFiltersChange({ ...filters, sourceType: value as SourceType | '' });
    },
    [filters, onFiltersChange]
  );

  const handleSupplierChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, supplierId: e.target.value });
    },
    [filters, onFiltersChange]
  );

  const handleStartDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, startDate: e.target.value });
    },
    [filters, onFiltersChange]
  );

  const handleEndDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, endDate: e.target.value });
    },
    [filters, onFiltersChange]
  );

  const handleClearFilters = useCallback(() => {
    onFiltersChange({
      status: '',
      supplierId: '',
      sourceType: '',
      startDate: '',
      endDate: '',
    });
  }, [onFiltersChange]);

  const hasActiveFilters =
    filters.status !== '' ||
    filters.supplierId !== '' ||
    filters.sourceType !== '' ||
    filters.startDate !== '' ||
    filters.endDate !== '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:flex-wrap">
        <div className="w-full sm:w-44">
          <Select
            label="Status"
            value={filters.status}
            onValueChange={handleStatusChange}
            options={STATUS_OPTIONS}
            placeholder="All Statuses"
          />
        </div>

        <div className="w-full sm:w-44">
          <Select
            label="Source Type"
            value={filters.sourceType}
            onValueChange={handleSourceTypeChange}
            options={SOURCE_TYPE_OPTIONS}
            placeholder="All Sources"
          />
        </div>

        <div className="w-full sm:w-52">
          <Input
            label="Supplier ID"
            placeholder="Filter by supplier"
            value={filters.supplierId}
            onChange={handleSupplierChange}
            aria-label="Filter by supplier ID"
          />
        </div>

        <div className="w-full sm:w-44">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Start Date
          </label>
          <input
            type="date"
            value={filters.startDate}
            onChange={handleStartDateChange}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="Filter by start date"
          />
        </div>

        <div className="w-full sm:w-44">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            End Date
          </label>
          <input
            type="date"
            value={filters.endDate}
            onChange={handleEndDateChange}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="Filter by end date"
          />
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-sm text-gray-600 underline hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 self-end pb-2"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
