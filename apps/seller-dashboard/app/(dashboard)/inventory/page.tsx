'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  useInventory,
  useTransactionHistory,
} from '@merch-os/api-client';
import type { InventoryTransaction } from '@merch-os/api-client';
import type { InventorySummary } from '@merch-os/types';
import { DataTable, Select, Badge } from '@merch-os/ui';
import type { ColumnDef, SelectOption } from '@merch-os/ui';
import { StockAdjustmentForm } from './components/StockAdjustmentForm';

/** Default low-stock threshold — configurable */
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

/**
 * InventoryPage — Displays inventory records with warehouse filtering,
 * visual indicators for stock levels, and transaction history on row click.
 *
 * Requirements: 7.1, 7.2, 7.5, 7.7
 */
export default function InventoryPage() {
  const [warehouseFilter, setWarehouseFilter] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<InventorySummary | null>(null);
  const [lowStockThreshold] = useState(DEFAULT_LOW_STOCK_THRESHOLD);

  // Fetch inventory, optionally filtered by warehouse
  const {
    data: inventoryData,
    isLoading,
  } = useInventory(
    warehouseFilter ? { warehouseId: warehouseFilter } : undefined
  );

  const inventory = inventoryData ?? [];

  // Sort by SKU ascending (Requirement 7.1)
  const sortedInventory = useMemo(() => {
    return [...inventory].sort((a, b) => a.sku.localeCompare(b.sku));
  }, [inventory]);

  // Extract unique warehouse IDs for filter dropdown
  const warehouseOptions: SelectOption[] = useMemo(() => {
    const warehouses = new Set(inventory.map((r) => r.warehouseId));
    const options: SelectOption[] = [
      { value: '', label: 'All Warehouses' },
    ];
    Array.from(warehouses)
      .sort()
      .forEach((wh) => {
        options.push({ value: wh, label: wh });
      });
    return options;
  }, [inventory]);

  // Fetch transaction history for selected record
  const {
    data: transactions,
    isLoading: isLoadingTransactions,
  } = useTransactionHistory({
    sku: selectedRecord?.sku ?? '',
    warehouseId: selectedRecord?.warehouseId,
  });

  const handleRowClick = useCallback((row: InventorySummary) => {
    setSelectedRecord((prev) =>
      prev?.sku === row.sku && prev?.warehouseId === row.warehouseId ? null : row
    );
  }, []);

  const handleWarehouseChange = useCallback((value: string) => {
    setWarehouseFilter(value);
    setSelectedRecord(null);
  }, []);

  // Column definitions for inventory table
  const columns: ColumnDef<InventorySummary>[] = useMemo(
    () => [
      {
        id: 'sku',
        header: 'SKU',
        cell: (row) => <span className="font-medium">{row.sku}</span>,
        sortable: true,
      },
      {
        id: 'warehouseId',
        header: 'Warehouse',
        cell: (row) => row.warehouseId,
      },
      {
        id: 'onHand',
        header: 'On-Hand',
        cell: (row) => row.onHand.toLocaleString(),
      },
      {
        id: 'reserved',
        header: 'Reserved',
        cell: (row) => row.reserved.toLocaleString(),
      },
      {
        id: 'available',
        header: 'Available',
        cell: (row) => (
          <AvailableQuantityCell
            available={row.available}
            lowStockThreshold={lowStockThreshold}
          />
        ),
      },
    ],
    [lowStockThreshold]
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">
            View stock levels across warehouses
          </p>
        </div>

        {/* Warehouse filter */}
        <div className="w-full sm:w-64">
          <Select
            label="Warehouse"
            value={warehouseFilter}
            onValueChange={handleWarehouseChange}
            options={warehouseOptions}
            placeholder="All Warehouses"
            id="warehouse-filter"
          />
        </div>
      </div>

      {/* Inventory Table */}
      <DataTable<InventorySummary>
        columns={columns}
        data={sortedInventory}
        getRowKey={(row) => `${row.sku}-${row.warehouseId}`}
        isLoading={isLoading}
        onRowClick={handleRowClick}
        emptyMessage="No inventory records found."
        caption="Inventory stock levels"
        totalItems={sortedInventory.length}
        pageSize={sortedInventory.length || 25}
      />

      {/* Stock Adjustment Form — shown when a record is selected */}
      {selectedRecord && (
        <StockAdjustmentForm
          record={selectedRecord}
          onSuccess={() => {
            // Quantities refresh automatically via React Query cache invalidation
          }}
        />
      )}

      {/* Transaction History Slide-out Panel */}
      {selectedRecord && (
        <TransactionHistoryPanel
          record={selectedRecord}
          transactions={transactions ?? []}
          isLoading={isLoadingTransactions}
          onClose={() => setSelectedRecord(null)}
        />
      )}
    </div>
  );
}

// --- Available Quantity Cell with Visual Indicators ---

interface AvailableQuantityCellProps {
  available: number;
  lowStockThreshold: number;
}

/**
 * Displays the available quantity with visual indicators:
 * - Red background/badge for zero or negative (Requirement 7.7)
 * - Yellow background/badge for at or below low-stock threshold (Requirement 7.7)
 */
function AvailableQuantityCell({ available, lowStockThreshold }: AvailableQuantityCellProps) {
  if (available <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-red-100 px-2 py-0.5 text-sm font-medium text-red-800">
          {available.toLocaleString()}
        </span>
        <Badge variant="error">Out of Stock</Badge>
      </span>
    );
  }

  if (available <= lowStockThreshold) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-yellow-100 px-2 py-0.5 text-sm font-medium text-yellow-800">
          {available.toLocaleString()}
        </span>
        <Badge variant="warning">Low Stock</Badge>
      </span>
    );
  }

  return <span>{available.toLocaleString()}</span>;
}

// --- Transaction History Panel ---

interface TransactionHistoryPanelProps {
  record: InventorySummary;
  transactions: InventoryTransaction[];
  isLoading: boolean;
  onClose: () => void;
}

/**
 * Slide-out panel showing the most recent 50 transaction history entries
 * in reverse chronological order.
 *
 * Displays: delta quantity, previous quantity, new quantity, source, actor, timestamp
 * Requirement 7.5
 */
function TransactionHistoryPanel({
  record,
  transactions,
  isLoading,
  onClose,
}: TransactionHistoryPanelProps) {
  return (
    <div
      className="fixed inset-y-0 right-0 z-40 w-full max-w-lg transform bg-white shadow-xl transition-transform duration-300 ease-in-out translate-x-0 border-l border-gray-200 overflow-hidden flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={`Transaction history for ${record.sku}`}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Transaction History
          </h2>
          <p className="text-sm text-gray-500">
            {record.sku} · {record.warehouseId}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-2 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label="Close transaction history"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-md bg-gray-100"
              />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-8">
            No transaction history available.
          </p>
        ) : (
          <div className="space-y-3" role="list" aria-label="Transaction entries">
            {transactions.map((tx) => (
              <TransactionEntry key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Transaction Entry ---

interface TransactionEntryProps {
  transaction: InventoryTransaction;
}

function TransactionEntry({ transaction }: TransactionEntryProps) {
  const deltaColor =
    transaction.delta > 0
      ? 'text-green-700 bg-green-50'
      : transaction.delta < 0
      ? 'text-red-700 bg-red-50'
      : 'text-gray-700 bg-gray-50';

  const deltaPrefix = transaction.delta > 0 ? '+' : '';

  return (
    <div
      className="rounded-lg border border-gray-200 p-4"
      role="listitem"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold ${deltaColor}`}
          >
            {deltaPrefix}{transaction.delta.toLocaleString()}
          </span>
          <span className="text-sm text-gray-500">
            {transaction.previousQuantity.toLocaleString()} → {transaction.newQuantity.toLocaleString()}
          </span>
        </div>
        <time
          className="text-xs text-gray-400"
          dateTime={transaction.timestamp}
        >
          {formatTimestamp(transaction.timestamp)}
        </time>
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
        <span>
          <span className="font-medium text-gray-700">Source:</span>{' '}
          {transaction.source}
        </span>
        <span>
          <span className="font-medium text-gray-700">Actor:</span>{' '}
          {transaction.actor}
        </span>
      </div>
    </div>
  );
}

// --- Utility ---

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
