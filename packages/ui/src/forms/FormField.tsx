'use client';

import React, { useId } from 'react';
import {
  useFormContext,
  Controller,
  type FieldValues,
  type Path,
  type ControllerRenderProps,
  type ControllerFieldState,
  type UseFormStateReturn,
} from 'react-hook-form';

export interface FormFieldProps<TFieldValues extends FieldValues = FieldValues> {
  /** Field name matching the Zod schema key */
  name: Path<TFieldValues>;
  /** Label text displayed above the field */
  label?: string;
  /** Whether the field is required */
  required?: boolean;
  /** Hint text displayed below the field */
  hint?: string;
  /** Render function for the field input */
  children: (props: {
    field: ControllerRenderProps<TFieldValues, Path<TFieldValues>>;
    fieldState: ControllerFieldState;
    formState: UseFormStateReturn<TFieldValues>;
  }) => React.ReactNode;
}

/**
 * FormField - Connects React Hook Form with accessible field rendering.
 * Integrates with Zod validation via @hookform/resolvers.
 * Provides proper aria-describedby/aria-invalid attributes and
 * announces errors via aria-live regions (Requirements 5.9, 5.10, 14.3).
 */
export function FormField<TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  required,
  hint,
  children,
}: FormFieldProps<TFieldValues>) {
  const generatedId = useId();
  const fieldId = `${generatedId}-field`;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  const { control } = useFormContext<TFieldValues>();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState, formState }) => {
        const error = fieldState.error?.message;
        const describedByIds = [
          hint ? hintId : null,
          error ? errorId : null,
        ]
          .filter(Boolean)
          .join(' ') || undefined;

        return (
          <div className="flex flex-col gap-1.5">
            {label && (
              <label
                htmlFor={fieldId}
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
            {children({
              field: Object.assign({}, field, {
                id: fieldId,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': describedByIds,
                'aria-required': required,
              }) as unknown as ControllerRenderProps<TFieldValues, Path<TFieldValues>>,
              fieldState,
              formState,
            })}
            {hint && !error && (
              <p id={hintId} className="text-xs text-gray-500">
                {hint}
              </p>
            )}
            {error && (
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
      }}
    />
  );
}
