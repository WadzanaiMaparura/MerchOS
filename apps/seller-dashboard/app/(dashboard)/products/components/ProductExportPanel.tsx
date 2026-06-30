'use client';

import React, { useState, useCallback } from 'react';
import { useProductExport } from '@merch-os/api-client';
import { Select, Alert } from '@merch-os/ui';
import type { ChannelId } from '@merch-os/types';

const MAX_EXPORT_SELECTION = 500;

const CHANNEL_OPTIONS = [
  { value: '', label: 'Select channel' },
  { value: 'takealot', label: 'Takealot' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'makro', label: 'Makro' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'woocommerce', label: 'WooCommerce' },
  { value: 'custom', label: 'Custom' },
];

const FORMAT_OPTIONS = [
  { value: '', label: 'Select format' },
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
];

interface ProductExportPanelProps {
  /** Array of currently selected product IDs */
  selectedProductIds: string[];
  /** Callback to clear selection after successful export */
  onExportSuccess?: () => void;
}

/**
 * ProductExportPanel - Export controls for bulk product selection.
 * Allows exporting up to 500 selected products to a channel in CSV or JSON format.
 * Displays error messages on failure while preserving product selection.
 * Requirements: 5.11, 5.12
 */
export function ProductExportPanel({
  selectedProductIds,
  onExportSuccess,
}: ProductExportPanelProps) {
  const [channelId, setChannelId] = useState('');
  const [format, setFormat] = useState('');

  const exportMutation = useProductExport();

  const selectionCount = selectedProductIds.length;
  const isOverLimit = selectionCount > MAX_EXPORT_SELECTION;

  const canExport =
    selectionCount > 0 &&
    !isOverLimit &&
    channelId !== '' &&
    format !== '' &&
    !exportMutation.isPending;

  const handleExport = useCallback(() => {
    if (!canExport) return;

    exportMutation.mutate(
      {
        productIds: selectedProductIds,
        channelId: channelId as ChannelId,
        format: format as 'csv' | 'json',
      },
      {
        onSuccess: () => {
          onExportSuccess?.();
        },
        // On error: selection is preserved (Requirement 5.12)
      }
    );
  }, [canExport, selectedProductIds, channelId, format, exportMutation, onExportSuccess]);

  if (selectionCount === 0) return null;

  return (
    <div
      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
      role="region"
      aria-label="Export selected products"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
        {/* Selection count */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800">
            {selectionCount} selected
          </span>
          {isOverLimit && (
            <span className="text-sm text-red-600" role="alert">
              Max {MAX_EXPORT_SELECTION} products
            </span>
          )}
        </div>

        {/* Channel select */}
        <div className="w-44">
          <Select
            label="Channel"
            value={channelId}
            onValueChange={setChannelId}
            options={CHANNEL_OPTIONS}
            placeholder="Select channel"
          />
        </div>

        {/* Format select */}
        <div className="w-36">
          <Select
            label="Format"
            value={format}
            onValueChange={setFormat}
            options={FORMAT_OPTIONS}
            placeholder="Select format"
          />
        </div>

        {/* Export button */}
        <button
          type="button"
          onClick={handleExport}
          disabled={!canExport}
          className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
          aria-label={`Export ${selectionCount} products`}
        >
          {exportMutation.isPending ? 'Exporting…' : 'Export'}
        </button>
      </div>

      {/* Export error (Requirement 5.12) — preserve selection on failure */}
      {exportMutation.isError && (
        <div className="mt-3">
          <Alert variant="error" title="Export Failed" dismissible onDismiss={() => exportMutation.reset()}>
            {exportMutation.error?.message || 'An error occurred during export. Please try again.'}
          </Alert>
        </div>
      )}

      {/* Export success */}
      {exportMutation.isSuccess && (
        <div className="mt-3">
          <Alert variant="success" title="Export Started" dismissible onDismiss={() => exportMutation.reset()}>
            Your export has been submitted and is being processed. Check the Exports page for download.
          </Alert>
        </div>
      )}
    </div>
  );
}
