'use client';

import React, { useState } from 'react';
import { useAdminBillingDetail, usePlanOverride } from '@merch-os/api-client';
import type { AdminBillingDetail, PlanId } from '@merch-os/types';
import { Badge, Alert, Skeleton, Card } from '@merch-os/ui';
import type { BadgeVariant } from '@merch-os/ui';
import { PlanOverrideModal } from './PlanOverrideModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  past_due: 'warning',
  canceled: 'error',
  trialing: 'info',
  incomplete: 'warning',
  incomplete_expired: 'error',
  unpaid: 'error',
};

function capitalize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function usageBar(used: number, limit: number): { percent: number; color: string } {
  if (limit === 0) return { percent: 0, color: 'bg-gray-300' };
  const percent = Math.min(100, Math.round((used / limit) * 100));
  const color = percent >= 90 ? 'bg-red-500' : percent >= 70 ? 'bg-amber-500' : 'bg-blue-500';
  return { percent, color };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BillingDetailPanelProps {
  tenantId: string;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * BillingDetailPanel — Slide-out panel showing detailed billing information.
 * Includes plan/cycle/status, usage meters, recent invoices, and plan override action.
 *
 * Requirements: 9.3, 9.4, 9.5, 9.6
 */
export function BillingDetailPanel({ tenantId, onClose }: BillingDetailPanelProps) {
  const { data: billing, isLoading, isError, error, refetch } = useAdminBillingDetail(tenantId);
  const planOverride = usePlanOverride();

  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const handleOverrideConfirm = (targetPlan: PlanId, reason: string) => {
    setOverrideError(null);
    planOverride.mutate(
      { tenantId, targetPlan, reason },
      {
        onSuccess: () => {
          setOverrideModalOpen(false);
        },
        onError: (err) => {
          setOverrideError(
            (err as { message?: string })?.message ??
              'Failed to override plan. Please try again.'
          );
        },
      }
    );
  };

  return (
    <>
      <aside
        className="sticky top-0 flex h-[calc(100vh-4rem)] w-full max-w-sm flex-shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        role="complementary"
        aria-label="Billing details"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Billing Details</h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Close billing details"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading && <BillingDetailSkeleton />}

          {isError && (
            <Alert variant="error" title="Failed to load billing details" dismissible={false}>
              <p>
                {(error as { message?: string })?.message ?? 'Billing data is temporarily unavailable.'}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-sm font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1 rounded"
              >
                Retry
              </button>
            </Alert>
          )}

          {!isLoading && !isError && billing && (
            <BillingDetailContent
              billing={billing}
              onOverrideOpen={() => {
                setOverrideError(null);
                setOverrideModalOpen(true);
              }}
            />
          )}
        </div>
      </aside>

      {/* Plan Override Modal */}
      {billing && (
        <PlanOverrideModal
          open={overrideModalOpen}
          currentPlan={billing.plan}
          tenantName={billing.tenantName}
          onConfirm={handleOverrideConfirm}
          onCancel={() => setOverrideModalOpen(false)}
          isLoading={planOverride.isPending}
          serverError={overrideError}
        />
      )}
    </>
  );
}

// ─── BillingDetailContent ─────────────────────────────────────────────────────

interface BillingDetailContentProps {
  billing: AdminBillingDetail;
  onOverrideOpen: () => void;
}

function BillingDetailContent({ billing, onOverrideOpen }: BillingDetailContentProps) {
  const enrichUsage = usageBar(billing.usage.enrichmentCalls, billing.usage.enrichmentLimit);
  const imageUsage = usageBar(billing.usage.imageCalls, billing.usage.imageLimit);
  const csvUsage = usageBar(billing.usage.csvExports, billing.usage.csvExportLimit);

  return (
    <div className="space-y-6">
      {/* Tenant + plan info */}
      <div>
        <h3 className="text-base font-semibold text-gray-900">{billing.tenantName}</h3>
        <p className="mt-0.5 text-xs text-gray-500 font-mono">{billing.tenantId}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="info">{capitalize(billing.plan)}</Badge>
          <Badge variant={STATUS_VARIANT[billing.status] ?? 'default'}>
            {capitalize(billing.status)}
          </Badge>
        </div>
      </div>

      {/* Plan details */}
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="font-medium text-gray-500">Billing Cycle</dt>
          <dd className="text-gray-900 capitalize">{billing.billingCycle}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="font-medium text-gray-500">Current Period End</dt>
          <dd className="text-gray-900">
            <time dateTime={billing.currentPeriodEnd}>{formatDate(billing.currentPeriodEnd)}</time>
          </dd>
        </div>
      </dl>

      {/* Usage meters */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-900">Usage</h4>
        <UsageMeter
          label="Enrichment Calls"
          used={billing.usage.enrichmentCalls}
          limit={billing.usage.enrichmentLimit}
          {...enrichUsage}
        />
        <UsageMeter
          label="Image Calls"
          used={billing.usage.imageCalls}
          limit={billing.usage.imageLimit}
          {...imageUsage}
        />
        <UsageMeter
          label="CSV Exports"
          used={billing.usage.csvExports}
          limit={billing.usage.csvExportLimit}
          {...csvUsage}
        />
      </div>

      {/* Recent invoices */}
      {billing.recentInvoices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-900">Recent Invoices</h4>
          <div className="space-y-1">
            {billing.recentInvoices.map((invoice, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="text-gray-700">
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                </span>
                <span className="font-medium text-gray-900">
                  ${(invoice.amountDue / 100).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan override action */}
      <div className="border-t border-gray-100 pt-4">
        <button
          onClick={onOverrideOpen}
          className="w-full rounded-md border border-blue-600 bg-white px-4 py-2 text-sm font-medium text-blue-600 shadow-sm hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          aria-label="Override subscription plan"
        >
          Override Plan
        </button>
      </div>
    </div>
  );
}

// ─── UsageMeter ───────────────────────────────────────────────────────────────

interface UsageMeterProps {
  label: string;
  used: number;
  limit: number;
  percent: number;
  color: string;
}

function UsageMeter({ label, used, limit, percent, color }: UsageMeterProps) {
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${percent}% used`}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function BillingDetailSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading billing details">
      <div className="space-y-2">
        <Skeleton height={20} width={180} />
        <Skeleton height={14} width={220} />
        <div className="flex gap-2 mt-2">
          <Skeleton height={20} width={70} />
          <Skeleton height={20} width={70} />
        </div>
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-1">
          <Skeleton height={12} width={120} />
          <Skeleton height={8} className="w-full" />
        </div>
      ))}
      <Skeleton height={36} className="mt-4 w-full" />
    </div>
  );
}
