'use client';

import React, { useState } from 'react';
import { z } from 'zod';
import type { PlanId } from '@merch-os/types';
import { Alert, Select } from '@merch-os/ui';
import type { SelectOption } from '@merch-os/ui';

// ─── Validation ───────────────────────────────────────────────────────────────

const reasonSchema = z
  .string()
  .trim()
  .min(1, 'Reason is required.')
  .max(500, 'Reason must be 500 characters or fewer.');

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAN_OPTIONS: SelectOption[] = [
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'professional', label: 'Professional' },
  { value: 'enterprise', label: 'Enterprise' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PlanOverrideModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Current plan of the tenant (used to disable in the select) */
  currentPlan: PlanId;
  /** Tenant name for display */
  tenantName: string;
  /** Called with targetPlan and reason on confirmed submit */
  onConfirm: (targetPlan: PlanId, reason: string) => void;
  /** Called when the modal is dismissed */
  onCancel: () => void;
  /** Whether the mutation is pending */
  isLoading: boolean;
  /** Optional server error message */
  serverError?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * PlanOverrideModal — Modal for overriding a tenant's subscription plan.
 * Requires selecting a new plan and providing a reason (1-500 chars).
 *
 * Requirements: 9.4, 9.5
 */
export function PlanOverrideModal({
  open,
  currentPlan,
  tenantName,
  onConfirm,
  onCancel,
  isLoading,
  serverError,
}: PlanOverrideModalProps) {
  const [targetPlan, setTargetPlan] = useState<string>('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const [planError, setPlanError] = useState<string | undefined>(undefined);

  if (!open) return null;

  const handleConfirm = () => {
    let hasError = false;

    // Validate plan selection
    if (!targetPlan || targetPlan === currentPlan) {
      setPlanError('Please select a different plan.');
      hasError = true;
    } else {
      setPlanError(undefined);
    }

    // Validate reason
    const result = reasonSchema.safeParse(reason);
    if (!result.success) {
      setReasonError(result.error.issues[0]?.message ?? 'Invalid reason.');
      hasError = true;
    } else {
      setReasonError(undefined);
    }

    if (hasError) return;

    onConfirm(targetPlan as PlanId, reason.trim());
  };

  const handleReasonChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setReason(value);
    if (reasonError) {
      const r = reasonSchema.safeParse(value);
      setReasonError(r.success ? undefined : (r.error.issues[0]?.message ?? undefined));
    }
  };

  const handlePlanChange = (value: string) => {
    setTargetPlan(value);
    if (planError) {
      setPlanError(value && value !== currentPlan ? undefined : planError);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-override-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4">
          <h3 id="plan-override-modal-title" className="text-lg font-semibold text-gray-900">
            Override Plan
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Change the subscription plan for <strong>{tenantName}</strong>.
            Current plan: <strong className="capitalize">{currentPlan}</strong>.
          </p>
        </div>

        {/* Plan selection */}
        <div className="space-y-4">
          <div>
            <Select
              label="Target Plan"
              value={targetPlan}
              onValueChange={handlePlanChange}
              options={PLAN_OPTIONS.filter((o) => o.value !== currentPlan)}
              disabled={isLoading}
            />
            {planError && (
              <p className="mt-1 text-sm text-red-600" role="alert" aria-live="assertive">
                {planError}
              </p>
            )}
          </div>

          {/* Reason textarea */}
          <div className="space-y-1.5">
            <label
              htmlFor="override-reason"
              className="text-sm font-medium text-gray-700"
            >
              Reason <span className="text-red-500" aria-hidden="true">*</span>
            </label>
            <textarea
              id="override-reason"
              value={reason}
              onChange={handleReasonChange}
              rows={3}
              maxLength={500}
              placeholder="Provide the reason for this plan override…"
              disabled={isLoading}
              aria-required="true"
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? 'override-reason-error' : 'override-reason-hint'}
              className={[
                'w-full resize-none rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                reasonError
                  ? 'border-red-500 focus-visible:ring-red-500'
                  : 'border-gray-300 hover:border-gray-400 focus-visible:ring-blue-600',
                isLoading ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
            />
            <div className="flex items-start justify-between">
              {reasonError ? (
                <p
                  id="override-reason-error"
                  className="text-sm text-red-600"
                  role="alert"
                  aria-live="assertive"
                >
                  {reasonError}
                </p>
              ) : (
                <p id="override-reason-hint" className="text-xs text-gray-400">
                  1–500 characters required
                </p>
              )}
              <p className="ml-2 flex-shrink-0 text-xs text-gray-400">
                {reason.trim().length}/500
              </p>
            </div>
          </div>
        </div>

        {/* Server error */}
        {serverError && (
          <div className="mt-3">
            <Alert variant="error">{serverError}</Alert>
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            aria-busy={isLoading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing…
              </span>
            ) : (
              'Override Plan'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
