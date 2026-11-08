'use client';

import React, { useState, useDeferredValue, useCallback } from 'react';
import { useAuditLog } from '@merch-os/api-client';
import type { AuditEvent, AuditListParams } from '@merch-os/types';
import { Card, Alert, Skeleton, Input, Select } from '@merch-os/ui';

// ─── Action type options ──────────────────────────────────────────────────────

const ACTION_TYPE_OPTIONS = [
  { value: '', label: 'All action types' },
  { value: 'TENANT_SUSPENDED', label: 'Tenant Suspended' },
  { value: 'TENANT_ACTIVATED', label: 'Tenant Activated' },
  { value: 'COMPLIANCE_UPDATED', label: 'Compliance Updated' },
  { value: 'TAXONOMY_REFRESHED', label: 'Taxonomy Refreshed' },
  { value: 'ALERT_RESOLVED', label: 'Alert Resolved' },
  { value: 'PLAN_OVERRIDDEN', label: 'Plan Overridden' },
  { value: 'LOGIN', label: 'Login' },
  { value: 'LOGOUT', label: 'Logout' },
];

// ─── Detail summary helper ────────────────────────────────────────────────────

function detailsSummary(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) return '—';
  // Show the first 2 key=value pairs as a brief summary
  return keys
    .slice(0, 2)
    .map((k) => `${k}: ${String(details[k])}`)
    .join(', ');
}

// ─── Expandable Row ───────────────────────────────────────────────────────────

interface AuditRowProps {
  event: AuditEvent;
  isExpanded: boolean;
  onToggle: () => void;
  colSpan: number;
}

function AuditRow({ event, isExpanded, onToggle, colSpan }: AuditRowProps) {
  const rowId = `audit-row-${event.eventId}`;
  const detailsId = `audit-details-${event.eventId}`;

  return (
    <>
      <tr
        id={rowId}
        className="cursor-pointer hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        tabIndex={0}
        role="button"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        aria-label={`Audit event: ${event.actionType} by ${event.actor}`}
      >
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          {new Date(event.timestamp).toLocaleString()}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          {event.actor}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
            {event.actionType}
          </span>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
          {event.resource}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
          {event.tenantId ?? '—'}
        </td>
        <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-500">
          {detailsSummary(event.details)}
        </td>
        <td className="px-4 py-3 text-center">
          <svg
            className={`mx-auto h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {isExpanded && (
        <tr id={detailsId}>
          <td colSpan={colSpan} className="bg-gray-50 px-8 py-4">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Event Details
              </p>
              <pre className="overflow-x-auto rounded-md border border-gray-200 bg-white p-4 text-xs text-gray-800">
                {JSON.stringify(event, null, 2)}
              </pre>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function AuditLogPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [actionType, setActionType] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Defer search to avoid re-querying on every keystroke; 3+ chars required
  const deferredSearch = useDeferredValue(searchInput);
  const effectiveSearch = deferredSearch.length >= 3 ? deferredSearch : undefined;

  const params: AuditListParams = {
    page,
    pageSize: PAGE_SIZE,
    search: effectiveSearch,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    actionType: actionType || undefined,
  };

  const { data, isLoading, isError, refetch } = useAuditLog(params);

  const events = data?.items ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

  const toggleRow = useCallback((eventId: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  // Reset page when filters change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(e.target.value);
    setPage(1);
  };
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartDate(e.target.value);
    setPage(1);
  };
  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndDate(e.target.value);
    setPage(1);
  };
  const handleActionTypeChange = (value: string) => {
    setActionType(value);
    setPage(1);
  };

  const COLUMNS = 7;

  return (
    <main className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Browse and search the platform audit trail for security and compliance purposes.
        </p>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Search */}
          <div className="min-w-[200px] flex-1">
            <Input
              label="Search"
              placeholder="3+ chars: actor, action, resource, tenant…"
              value={searchInput}
              onChange={handleSearchChange}
              aria-label="Search audit log"
            />
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700" htmlFor="audit-start-date">
              Start date
            </label>
            <input
              id="audit-start-date"
              type="date"
              value={startDate}
              onChange={handleStartDateChange}
              max={endDate || undefined}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-700" htmlFor="audit-end-date">
              End date
            </label>
            <input
              id="audit-end-date"
              type="date"
              value={endDate}
              onChange={handleEndDateChange}
              min={startDate || undefined}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            />
          </div>

          {/* Action type */}
          <div className="min-w-[180px]">
            <Select
              label="Action type"
              value={actionType}
              onValueChange={handleActionTypeChange}
              options={ACTION_TYPE_OPTIONS}
            />
          </div>
        </div>
      </Card>

      {/* Error state */}
      {isError && (
        <Alert
          variant="error"
          title="Failed to load audit data"
          className="mb-4"
        >
          Audit data is temporarily unavailable.{' '}
          <button
            onClick={() => refetch()}
            className="font-medium underline hover:no-underline focus-visible:outline-none"
          >
            Retry
          </button>
        </Alert>
      )}

      {/* Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table
            className="min-w-full divide-y divide-gray-200"
            aria-label="Audit events"
          >
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Timestamp
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Actor
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Action Type
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Resource
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Tenant ID
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Details Summary
                </th>
                <th scope="col" className="w-8 px-4 py-3">
                  <span className="sr-only">Expand</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: COLUMNS }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton height={16} className="w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS} className="px-4 py-8 text-center text-sm text-gray-500">
                    {isError ? '' : 'No audit events match the current filters.'}
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <AuditRow
                    key={event.eventId}
                    event={event}
                    isExpanded={expandedRows.has(event.eventId)}
                    onToggle={() => toggleRow(event.eventId)}
                    colSpan={COLUMNS}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalItems > 0 && (
          <nav
            className="flex items-center justify-between border-t border-gray-200 bg-white px-4 py-3"
            aria-label="Audit log pagination"
          >
            <p className="text-sm text-gray-500">
              Showing{' '}
              <span className="font-medium">{(page - 1) * PAGE_SIZE + 1}</span>
              {' '}to{' '}
              <span className="font-medium">{Math.min(page * PAGE_SIZE, totalItems)}</span>
              {' '}of{' '}
              <span className="font-medium">{totalItems}</span> events
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                aria-label="Previous page"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </Card>
    </main>
  );
}
