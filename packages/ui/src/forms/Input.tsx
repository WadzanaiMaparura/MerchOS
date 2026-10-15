'use client';

import React, { useId } from 'react';

/**
 * Internal marker prop injected by FormField onto the control it renders.
 * When present, Input treats FormField as the owner of label/error rendering
 * and suppresses its own error paragraph to avoid duplicate messages.
 * Not part of the public API — consumers should not set this directly.
 * @internal
 */
export const FORM_FIELD_MANAGED = 'data-form-field-managed' as const;

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Input type */
  type?: 'text' | 'email' | 'password' | 'number';
  /** Label text displayed above the input */
  label?: string;
  /** Error message to display below the input */
  error?: string;
  /** Whether the field is required (shows indicator next to label) */
  required?: boolean;
  /** Optional aria-label for inputs without a visible label */
  'aria-label'?: string;
  /** Optional aria-labelledby for custom label association */
  'aria-labelledby'?: string;
}

/**
 * Input - Accessible form input with label association and validation error display.
 * Associates label using htmlFor/id. Displays validation errors with
 * aria-live="assertive" and aria-invalid for WCAG 2.1 AA compliance.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      type = 'text',
      label,
      error,
      required,
      className,
      id: externalId,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      disabled,
      ...props
    },
    ref
  ) => {
    const generatedId = useId();
    const inputId = externalId || generatedId;
    const errorId = `${inputId}-error`;

    // When rendered inside a FormField, that component owns the label/error
    // display (and the aria-describedby/errorId wiring). Suppress Input's own
    // error paragraph to prevent the same message rendering twice.
    const isFormFieldManaged =
      (props as Record<string, unknown>)[FORM_FIELD_MANAGED] !== undefined;
    const showOwnError = Boolean(error) && !isFormFieldManaged;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-gray-700"
          >
            {label}
            {required && (
              <span className="ml-0.5 text-red-500" aria-hidden="true">
                *
              </span>
            )}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          required={required}
          disabled={disabled}
          aria-label={!label ? ariaLabel : undefined}
          aria-labelledby={ariaLabelledBy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-required={required}
          className={[
            'rounded-md border px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors',
            'placeholder:text-gray-400',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
            error
              ? 'border-red-500 focus-visible:ring-red-500'
              : 'border-gray-300 hover:border-gray-400',
            disabled && 'cursor-not-allowed bg-gray-50 text-gray-500',
            className,
          ]
            .filter(Boolean)
            .join(' ')}
          {...props}
        />
        {showOwnError && (
          <p
            id={errorId}
            className="text-sm text-red-600"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
