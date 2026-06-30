'use client';

import React, { useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useStockAdjustment } from '@merch-os/api-client';
import { useRole } from '@merch-os/auth';
import { Form, FormField, Input } from '@merch-os/ui';
import { Alert } from '@merch-os/ui';
import type { InventorySummary } from '@merch-os/types';

/**
 * Zod schema for stock adjustment form.
 * - delta: integer between -999,999 and 999,999 (non-zero)
 * - reason: 1 to 200 characters
 */
const stockAdjustmentSchema = z.object({
  delta: z
    .number({
      required_error: 'Adjustment quantity is required',
      invalid_type_error: 'Must be a whole number',
    })
    .int('Must be a whole number')
    .min(-999999, 'Must be at least -999,999')
    .max(999999, 'Must be at most 999,999')
    .refine((val) => val !== 0, 'Adjustment cannot be zero'),
  reason: z
    .string()
    .min(1, 'Reason is required')
    .max(200, 'Reason must be 200 characters or fewer'),
});

type StockAdjustmentFormData = z.infer<typeof stockAdjustmentSchema>;

export interface StockAdjustmentFormProps {
  /** The inventory record to adjust */
  record: InventorySummary;
  /** Callback fired after a successful adjustment */
  onSuccess?: () => void;
}

/**
 * StockAdjustmentForm — Manual stock adjustment form for a selected inventory record.
 *
 * Validates:
 * - delta is integer between -999,999 and 999,999, non-zero
 * - reason is 1-200 characters
 * - Adjustment won't cause on-hand to go negative
 * - Form is disabled for viewer role
 * - On failure: displays error, preserves entered values
 * - On success: refreshes displayed quantities via cache invalidation
 *
 * Requirements: 7.3, 7.4, 7.6, 7.8
 */
export function StockAdjustmentForm({ record, onSuccess }: StockAdjustmentFormProps) {
  const role = useRole();
  const isViewer = role === 'viewer';

  const form = useForm<StockAdjustmentFormData>({
    resolver: zodResolver(stockAdjustmentSchema),
    defaultValues: {
      delta: undefined as unknown as number,
      reason: '',
    },
    mode: 'onSubmit',
  });

  const {
    mutate: submitAdjustment,
    isPending,
    isError,
    error: mutationError,
    reset: resetMutation,
  } = useStockAdjustment();

  // Reset mutation error state when form values change
  useEffect(() => {
    const subscription = form.watch(() => {
      if (isError) {
        resetMutation();
      }
    });
    return () => subscription.unsubscribe();
  }, [form, isError, resetMutation]);

  const onSubmit = useCallback(
    (data: StockAdjustmentFormData) => {
      // Validate that adjustment won't cause on-hand to go negative (Requirement 7.8)
      const newOnHand = record.onHand + data.delta;
      if (newOnHand < 0) {
        form.setError('delta', {
          type: 'manual',
          message: `On-hand quantity cannot go below zero. Current on-hand is ${record.onHand.toLocaleString()}.`,
        });
        return;
      }

      submitAdjustment(
        {
          sku: record.sku,
          newQuantity: newOnHand,
          reason: data.reason,
          source: 'manual',
        },
        {
          onSuccess: () => {
            form.reset();
            onSuccess?.();
          },
          // On failure: error state is set by React Query,
          // form values are preserved automatically (Requirement 7.4)
        }
      );
    },
    [record, form, submitAdjustment, onSuccess]
  );

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-base font-semibold text-gray-900 mb-4">
        Manual Stock Adjustment
      </h3>

      {isViewer && (
        <Alert variant="info" className="mb-4">
          You have view-only access. Stock adjustments require editor or higher permissions.
        </Alert>
      )}

      {isError && mutationError && (
        <Alert variant="error" className="mb-4" dismissible onDismiss={resetMutation}>
          {mutationError.message || 'The adjustment could not be saved. Please try again.'}
        </Alert>
      )}

      <Form
        form={form}
        onSubmit={onSubmit}
        aria-label={`Stock adjustment for ${record.sku}`}
        className="space-y-4"
      >
        {/* SKU display (read-only context) */}
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-700">SKU:</span> {record.sku}
          <span className="ml-4 font-medium text-gray-700">On-Hand:</span>{' '}
          {record.onHand.toLocaleString()}
        </div>

        {/* Delta field */}
        <FormField<StockAdjustmentFormData>
          name="delta"
          label="Adjustment Quantity"
          required
          hint="Enter a positive number to add stock, or a negative number to remove stock."
        >
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="number"
              placeholder="e.g. -10 or 50"
              disabled={isViewer || isPending}
              error={fieldState.error?.message}
              onChange={(e) => {
                const value = e.target.value;
                field.onChange(value === '' ? undefined : parseInt(value, 10));
              }}
              value={field.value === undefined ? '' : field.value}
              min={-999999}
              max={999999}
              step={1}
            />
          )}
        </FormField>

        {/* Reason field */}
        <FormField<StockAdjustmentFormData>
          name="reason"
          label="Reason"
          required
          hint="Provide a reason for this adjustment (1-200 characters)."
        >
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="text"
              placeholder="e.g. Damaged goods, inventory count correction"
              disabled={isViewer || isPending}
              error={fieldState.error?.message}
              maxLength={200}
            />
          )}
        </FormField>

        {/* Submit button */}
        <button
          type="submit"
          disabled={isViewer || isPending}
          className={[
            'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
            isViewer || isPending
              ? 'cursor-not-allowed bg-gray-400'
              : 'bg-blue-600 hover:bg-blue-700',
          ].join(' ')}
          aria-disabled={isViewer || isPending}
        >
          {isPending ? 'Submitting…' : 'Submit Adjustment'}
        </button>
      </Form>
    </div>
  );
}
