'use client';

import React, { useState } from 'react';
import { z } from 'zod';
import {
  useAdminTenantDetail,
  useSuspendTenant,
  useActivateTenant,
} from '@merch-os/api-client';
import type { TenantDetail } from '@merch-os/types';
import { Badge, Alert, Skeleton, ConfirmationModal, Input } from '@merch-os/ui';
import type { BadgeVariant } from '@merch-os/ui';

// ── Zod schema for suspension reason (Requirement 4.6) ─────────────────────
const suspendReasonSchema = z
  .string()
  .trim()
  .min(1, 'Reason is required.')
  .max(500, 'Reason must be 500 characters or fewer.');

// ── Helpers ────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  active: 'success',
  suspended: 'error',
};

const PLAN_VARIANT: Record<string, BadgeVariant> = {
  starter: 'neutral',
  growth: 'info',
  professional: 'warning',
  enterprise: 'default',
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
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

// ── Props ──────────────────────────────────────────────────────────────────

export interface TenantDetailPanelProps {
  /** ID of the tenant to display */
  tenantId: string;
  /** Callback to close the panel */
  onClose: () => void;
}

/**
 * TenantDetailPanel — Slide-out panel showing full tenant information.
 * Includes Suspend (active tenants) and Activate (suspended tenants) actions
 * with confirmation modals and Zod-validated reason input.
 *
 * Requirements: 4.5, 4.6, 4.7, 4.8
 */
export function TenantDetailPanel({ tenantId, onClose }: TenantDetailPanelProps) {
  const { data: tenant, isLoading, isError, error, refetch } = useAdminTenantDetail(tenantId);

  const suspendMutation = useSuspendTenant();
  const activateMutation = useActivateTenant();

  // ── Suspend modal state ─────────────────────────────────────────────────
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');
  const [suspendReasonError, setSuspendReasonError] = useState<string | undefined>(undefined);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  // ── Activate modal state ────────────────────────────────────────────────
  const [activateModalOpen, setActivateModalOpen] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // ── Suspend handlers ────────────────────────────────────────────────────
  const handleSuspendOpen = () => {
    setSuspendReason('');
    setSuspendReasonError(undefined);
    setSuspendError(null);
    setSuspendModalOpen(true);
  };

  const handleSuspendConfirm = () => {
    const result = suspendReasonSchema.safeParse(suspendReason);
    if (!result.success) {
      setSuspendReasonError(result.error.issues[0]?.message ?? 'Invalid reason.');
      return;
    }

    setSuspendError(null);
    suspendMutation.mutate(
      { tenantId, reason: result.data },
      {
        onSuccess: () => {
          setSuspendModalOpen(false);
          setSuspendReason('');
        },
        onError: (err) => {
          // Requirement 4.8: display error, leave status unchanged
          setSuspendError(
            (err as { message?: string })?.message ??
              'Failed to suspend tenant. Please try again.'
          );
        },
      }
    );
  };

  const handleSuspendCancel = () => {
    setSuspendModalOpen(false);
    setSuspendReason('');
    setSuspendReasonError(undefined);
    setSuspendError(null);
  };

  // ── Activate handlers ───────────────────────────────────────────────────
  const handleActivateOpen = () => {
    setActivateError(null);
    setActivateModalOpen(true);
  };

  const handleActivateConfirm = () => {
    setActivateError(null);
    activateMutation.mutate(
      { tenantId },
      {
        onSuccess: () => {
          setActivateModalOpen(false);
        },
        onError: (err) => {
          // Requirement 4.8: display error, leave status unchanged
          setActivateError(
            (err as { message?: string })?.message ??
              'Failed to activate tenant. Please try again.'
          );
        },
      }
    );
  };

  const handleActivateCancel = () => {
    setActivateModalOpen(false);
    setActivateError(null);
  };

  return (
    <>
      {/* Slide-out panel */}
      <aside
        className="sticky top-0 flex h-[calc(100vh-4rem)] w-full max-w-sm flex-shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
        role="complementary"
        aria-label="Tenant details"
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Tenant Details</h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-gray-400 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Close tenant details"
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

        {/* Panel body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading && <TenantDetailSkeleton />}

          {isError && (
            <Alert
              variant="error"
              title="Failed to load tenant details"
              dismissible={false}
            >
              <p>
                {(error as { message?: string })?.message ??
                  'Tenant data is temporarily unavailable.'}
              </p>
              <button
                onClick={() => refetch()}
                className="mt-2 text-sm font-medium underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-1 rounded"
              >
                Retry
              </button>
            </Alert>
          )}

          {!isLoading && !isError && tenant && (
            <TenantDetailContent
              tenant={tenant}
              suspendError={suspendError}
              activateError={activateError}
              onSuspendOpen={handleSuspendOpen}
              onActivateOpen={handleActivateOpen}
            />
          )}
        </div>
      </aside>

      {/* Suspend confirmation modal — Requirement 4.6 */}
      <ConfirmationModal
        open={suspendModalOpen}
        onOpenChange={(open) => {
          if (!open) handleSuspendCancel();
        }}
        title="Suspend Tenant"
        description={`Suspending this tenant will immediately restrict their access to the platform. Please provide a reason.`}
        confirmLabel="Suspend Tenant"
        cancelLabel="Cancel"
        onConfirm={handleSuspendConfirm}
        onCancel={handleSuspendCancel}
        variant="danger"
        isLoading={suspendMutation.isPending}
      >
        {/* Extra content injected into the modal via children */}
      </ConfirmationModal>

      {/* We render the reason input outside ConfirmationModal since it doesn't
          accept children — use a separate inline modal pattern instead */}
      {suspendModalOpen && (
        <SuspendReasonModal
          open={suspendModalOpen}
          reason={suspendReason}
          reasonError={suspendReasonError}
          onReasonChange={(v) => {
            setSuspendReason(v);
            if (suspendReasonError) {
              const r = suspendReasonSchema.safeParse(v);
              setSuspendReasonError(
                r.success ? undefined : (r.error.issues[0]?.message ?? undefined)
              );
            }
          }}
          onConfirm={handleSuspendConfirm}
          onCancel={handleSuspendCancel}
          isLoading={suspendMutation.isPending}
          serverError={suspendError}
        />
      )}

      {/* Activate confirmation modal — Requirement 4.7 */}
      {activateModalOpen && (
        <ActivateModal
          open={activateModalOpen}
          onConfirm={handleActivateConfirm}
          onCancel={handleActivateCancel}
          isLoading={activateMutation.isPending}
          serverError={activateError}
        />
      )}
    </>
  );
}

// ── TenantDetailContent ────────────────────────────────────────────────────

interface TenantDetailContentProps {
  tenant: TenantDetail;
  suspendError: string | null;
  activateError: string | null;
  onSuspendOpen: () => void;
  onActivateOpen: () => void;
}

function TenantDetailContent({
  tenant,
  suspendError,
  activateError,
  onSuspendOpen,
  onActivateOpen,
}: TenantDetailContentProps) {
  return (
    <div className="space-y-6">
      {/* Name + status badges */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{tenant.name}</h3>
          <p className="mt-0.5 text-xs text-gray-500 font-mono">{tenant.tenantId}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={PLAN_VARIANT[tenant.plan] ?? 'default'}>
            {capitalize(tenant.plan)}
          </Badge>
          <Badge variant={STATUS_VARIANT[tenant.status] ?? 'default'}>
            {capitalize(tenant.status)}
          </Badge>
        </div>
      </div>

      {/* Detail fields */}
      <dl className="space-y-3 text-sm">
        <DetailRow label="Tenant ID" value={<span className="font-mono text-xs">{tenant.tenantId}</span>} />
        <DetailRow label="Plan" value={capitalize(tenant.plan)} />
        <DetailRow label="Status" value={capitalize(tenant.status)} />
        <DetailRow label="Users" value={tenant.userCount.toLocaleString()} />
        <DetailRow label="Products" value={tenant.productCount.toLocaleString()} />
        <DetailRow
          label="Registered"
          value={
            <time dateTime={tenant.registeredAt}>{formatDate(tenant.registeredAt)}</time>
          }
        />
        <DetailRow
          label="Last Activity"
          value={
            <time dateTime={tenant.lastActivityAt}>{formatDate(tenant.lastActivityAt)}</time>
          }
        />
      </dl>

      {/* Mutation error alerts — Requirement 4.8 */}
      {suspendError && (
        <Alert variant="error" title="Suspend failed">
          {suspendError}
        </Alert>
      )}
      {activateError && (
        <Alert variant="error" title="Activate failed">
          {activateError}
        </Alert>
      )}

      {/* Action buttons */}
      <div className="border-t border-gray-100 pt-4">
        {tenant.status === 'active' && (
          <button
            onClick={onSuspendOpen}
            className="w-full rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
            aria-label="Suspend this tenant"
          >
            Suspend Tenant
          </button>
        )}
        {tenant.status === 'suspended' && (
          <button
            onClick={onActivateOpen}
            className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
            aria-label="Activate this tenant"
          >
            Activate Tenant
          </button>
        )}
      </div>
    </div>
  );
}

// ── DetailRow ──────────────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="w-28 flex-shrink-0 font-medium text-gray-500">{label}</dt>
      <dd className="flex-1 text-gray-900">{value}</dd>
    </div>
  );
}

// ── TenantDetailSkeleton ───────────────────────────────────────────────────

function TenantDetailSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading tenant details">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton height={20} width={160} />
          <Skeleton height={14} width={200} />
        </div>
        <div className="flex gap-2">
          <Skeleton height={20} width={70} />
          <Skeleton height={20} width={70} />
        </div>
      </div>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton height={14} width={100} />
          <Skeleton height={14} width={140} />
        </div>
      ))}
      <Skeleton height={36} className="mt-4 w-full" />
    </div>
  );
}

// ── SuspendReasonModal ─────────────────────────────────────────────────────

interface SuspendReasonModalProps {
  open: boolean;
  reason: string;
  reasonError: string | undefined;
  onReasonChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
  serverError: string | null;
}

/**
 * Custom modal for tenant suspension that includes a validated reason textarea.
 * Requirement 4.6: Reason is required, 1-500 characters (Zod validated).
 */
function SuspendReasonModal({
  open,
  reason,
  reasonError,
  onReasonChange,
  onConfirm,
  onCancel,
  isLoading,
  serverError,
}: SuspendReasonModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suspend-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <div>
            <h3 id="suspend-modal-title" className="text-base font-semibold text-gray-900">
              Suspend Tenant
            </h3>
            <p className="text-sm text-gray-500">
              This will immediately restrict the tenant's platform access.
            </p>
          </div>
        </div>

        {/* Reason input */}
        <div className="space-y-1.5">
          <label
            htmlFor="suspend-reason"
            className="text-sm font-medium text-gray-700"
          >
            Reason <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea
            id="suspend-reason"
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="Enter the reason for suspension…"
            aria-required="true"
            aria-describedby={reasonError ? 'suspend-reason-error' : 'suspend-reason-hint'}
            aria-invalid={reasonError ? true : undefined}
            className={[
              'w-full resize-none rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              reasonError
                ? 'border-red-500 focus-visible:ring-red-500'
                : 'border-gray-300 hover:border-gray-400 focus-visible:ring-blue-600',
            ].join(' ')}
          />
          <div className="flex items-start justify-between">
            {reasonError ? (
              <p
                id="suspend-reason-error"
                className="text-sm text-red-600"
                role="alert"
                aria-live="assertive"
              >
                {reasonError}
              </p>
            ) : (
              <p id="suspend-reason-hint" className="text-xs text-gray-400">
                1–500 characters required
              </p>
            )}
            <p className="text-xs text-gray-400 ml-2 flex-shrink-0">
              {reason.trim().length}/500
            </p>
          </div>
        </div>

        {/* Server error */}
        {serverError && (
          <div className="mt-3">
            <Alert variant="error">
              {serverError}
            </Alert>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            autoFocus
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing…
              </span>
            ) : (
              'Suspend Tenant'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ActivateModal ──────────────────────────────────────────────────────────

interface ActivateModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
  serverError: string | null;
}

/**
 * Confirmation modal for activating a suspended tenant.
 * Requirement 4.7: Requires confirmation before submitting.
 */
function ActivateModal({
  open,
  onConfirm,
  onCancel,
  isLoading,
  serverError,
}: ActivateModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activate-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <h3 id="activate-modal-title" className="text-base font-semibold text-gray-900">
              Activate Tenant
            </h3>
            <p className="text-sm text-gray-500">
              This will restore the tenant's access to the platform.
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600">
          Are you sure you want to activate this tenant? They will immediately regain
          access to all platform features.
        </p>

        {/* Server error */}
        {serverError && (
          <div className="mt-3">
            <Alert variant="error">
              {serverError}
            </Alert>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            autoFocus
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Processing…
              </span>
            ) : (
              'Activate Tenant'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
