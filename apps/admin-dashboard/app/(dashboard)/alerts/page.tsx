'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useAlerts, useUnresolvedAlertCount, useResolveAlert } from '@merch-os/api-client';
import type { AlertItem, AlertStatusFilter } from '@merch-os/types';
import { Badge, Card, Alert, Select, Skeleton } from '@merch-os/ui';
import type { BadgeVariant, SelectOption } from '@merch-os/ui';
import { AlertResolutionForm } from './components/AlertResolutionForm';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Alerts' },
  { value: 'unresolved', label: 'Unresolved' },
  { value: 'resolved', label: 'Resolved' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

// ─── Alert Card ───────────────────────────────────────────────────────────────

interface AlertCardProps {
  alert: AlertItem;
  isResolving: boolean;
  resolveError: string | null;
  onResolve: (alertId: string, note: string) => void;
  showResolveForm: boolean;
  onToggleResolveForm: (alertId: string) => void;
}

function AlertCard({
  alert,
  isResolving,
  resolveError,
  onResolve,
  showResolveForm,
  onToggleResolveForm,
}: AlertCardProps) {
  const isResolved = alert.resolved;

  return (
    <div
      className={[
        'rounded-lg border p-4 shadow-sm transition-colors',
        isResolved
          ? 'border-gray-200 bg-gray-50'
          : 'border-red-200 bg-red-50',
      ].join(' ')}
      role="article"
      aria-label={`Alert: ${alert.functionName} — ${isResolved ? 'resolved' : 'unresolved'}`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-gray-900">
              {alert.functionName}
            </h3>
            <Badge variant={isResolved ? 'success' : 'error'}>
              {isResolved ? 'Resolved' : 'Unresolved'}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span>
              Error rate: <strong>{alert.currentErrorRate.toFixed(1)}%</strong>
            </span>
            <span>
              Errors: <strong>{alert.errorCount.toLocaleString()}</strong>
            </span>
            <span>
              Triggered: <time dateTime={alert.triggeredAt}>{formatTimestamp(alert.triggeredAt)}</time>
            </span>
          </div>
        </div>

        {/* Resolve button (only for unresolved alerts) */}
        {!isResolved && !showResolveForm && (
          <button
            type="button"
            onClick={() => onToggleResolveForm(alert.alertId)}
            className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Resolve
          </button>
        )}
      </div>

      {/* Resolution info for already resolved alerts */}
      {isResolved && alert.resolvedAt && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">
            Resolved at{' '}
            <time dateTime={alert.resolvedAt}>{formatTimestamp(alert.resolvedAt)}</time>
          </p>
          {alert.resolutionNote && (
            <p className="mt-1 text-green-700">{alert.resolutionNote}</p>
          )}
        </div>
      )}

      {/* Inline resolution form */}
      {showResolveForm && !isResolved && (
        <AlertResolutionForm
          onSubmit={(note) => onResolve(alert.alertId, note)}
          isSubmitting={isResolving}
          serverError={resolveError}
        />
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AlertListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading alerts">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <Skeleton height={18} width={220} />
              <Skeleton height={14} width={300} />
            </div>
            <Skeleton height={32} width={80} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AlertsPage — Displays platform alerts sorted unresolved-first.
 * Supports status filter and inline resolution forms.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
export default function AlertsPage() {
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all');
  const [resolvingAlertId, setResolvingAlertId] = useState<string | null>(null);
  const [resolveErrors, setResolveErrors] = useState<Record<string, string>>({});

  const { data: alerts, isLoading, isError, refetch } = useAlerts(statusFilter);
  const { data: unresolvedCount = 0 } = useUnresolvedAlertCount();
  const resolveMutation = useResolveAlert();

  // Sort: unresolved first, then by triggeredAt descending
  const sortedAlerts = useMemo(() => {
    if (!alerts) return [];
    return [...alerts].sort((a, b) => {
      // Unresolved first
      if (a.resolved !== b.resolved) {
        return a.resolved ? 1 : -1;
      }
      // Then by most recent
      return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
    });
  }, [alerts]);

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value as AlertStatusFilter);
  }, []);

  const handleToggleResolveForm = useCallback((alertId: string) => {
    setResolvingAlertId((prev) => (prev === alertId ? null : alertId));
    // Clear any previous error for this alert
    setResolveErrors((prev) => {
      const next = { ...prev };
      delete next[alertId];
      return next;
    });
  }, []);

  const handleResolve = useCallback(
    (alertId: string, note: string) => {
      setResolveErrors((prev) => {
        const next = { ...prev };
        delete next[alertId];
        return next;
      });

      resolveMutation.mutate(
        { alertId, note },
        {
          onSuccess: () => {
            setResolvingAlertId(null);
          },
          onError: (err) => {
            setResolveErrors((prev) => ({
              ...prev,
              [alertId]:
                (err as { message?: string })?.message ??
                'Failed to resolve alert. Please try again.',
            }));
          },
        }
      );
    },
    [resolveMutation]
  );

  return (
    <main className="p-6">
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">Alerts</h1>
            {unresolvedCount > 0 && (
              <Badge variant="error" aria-label={`${unresolvedCount} unresolved alerts`}>
                {unresolvedCount}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Monitor and resolve platform alert conditions.
          </p>
        </div>

        {/* Status filter */}
        <div className="w-full sm:w-48">
          <Select
            label="Status"
            value={statusFilter}
            onValueChange={handleStatusFilterChange}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <Alert
          variant="error"
          title="Failed to load alerts"
          className="mb-4"
        >
          Alert data is temporarily unavailable.{' '}
          <button
            onClick={() => refetch()}
            className="font-medium underline hover:no-underline focus-visible:outline-none"
          >
            Retry
          </button>
        </Alert>
      )}

      {/* Alert list */}
      {isLoading ? (
        <AlertListSkeleton />
      ) : sortedAlerts.length === 0 ? (
        <Card>
          <div className="flex h-32 items-center justify-center text-center">
            <p className="text-sm text-gray-500">
              {statusFilter === 'all'
                ? 'No alerts found.'
                : `No ${statusFilter} alerts found.`}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3" aria-label="Alert list" role="list">
          {sortedAlerts.map((alert) => (
            <div key={alert.alertId} role="listitem">
              <AlertCard
                alert={alert}
                isResolving={resolveMutation.isPending && resolvingAlertId === alert.alertId}
                resolveError={resolveErrors[alert.alertId] ?? null}
                onResolve={handleResolve}
                showResolveForm={resolvingAlertId === alert.alertId}
                onToggleResolveForm={handleToggleResolveForm}
              />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
