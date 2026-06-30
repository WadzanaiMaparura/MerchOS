'use client';

import React from 'react';
import { Modal } from '../primitives';

export type ConfirmationVariant = 'danger' | 'warning' | 'info';

export interface ConfirmationModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when the modal should close */
  onOpenChange: (open: boolean) => void;
  /** Title text for the confirmation dialog */
  title: string;
  /** Description explaining what will happen */
  description: string;
  /** Text for the confirm button */
  confirmLabel?: string;
  /** Text for the cancel button */
  cancelLabel?: string;
  /** Callback when the user confirms the action */
  onConfirm: () => void;
  /** Callback when the user cancels */
  onCancel?: () => void;
  /** Visual variant indicating severity */
  variant?: ConfirmationVariant;
  /** Whether the confirm action is in progress */
  isLoading?: boolean;
}

const variantStyles: Record<ConfirmationVariant, { button: string; icon: string }> = {
  danger: {
    button:
      'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
    icon: 'text-red-600',
  },
  warning: {
    button:
      'bg-amber-600 text-white hover:bg-amber-700 focus-visible:ring-amber-600',
    icon: 'text-amber-600',
  },
  info: {
    button:
      'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-600',
    icon: 'text-blue-600',
  },
};

/**
 * ConfirmationModal - Accessible confirmation dialog for destructive actions.
 * Used for disconnect channel, remove user, delete webhook, and similar operations.
 * Built on the Modal primitive (Radix Dialog) with focus trap and keyboard support.
 * Focus moves to the cancel button by default to prevent accidental confirmation.
 * Meets requirements 5.9, 5.10, 6.1, 6.2.
 */
export function ConfirmationModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'danger',
  isLoading = false,
}: ConfirmationModalProps) {
  const styles = variantStyles[variant];

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = () => {
    onConfirm();
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
    >
      <div className="mt-2 flex items-start gap-4">
        {/* Warning icon */}
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
            variant === 'danger'
              ? 'bg-red-100'
              : variant === 'warning'
                ? 'bg-amber-100'
                : 'bg-blue-100'
          }`}
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-5 w-5 ${styles.icon}`}
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
        <div className="flex-1">
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={handleCancel}
          disabled={isLoading}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          autoFocus
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isLoading}
          aria-busy={isLoading}
          className={`rounded-md px-4 py-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${styles.button}`}
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
            confirmLabel
          )}
        </button>
      </div>
    </Modal>
  );
}
