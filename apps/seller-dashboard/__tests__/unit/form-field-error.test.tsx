// Regression test for Issue 2: duplicate validation messages.
//
// Previously, a FormField wrapping an Input where the Input also received an
// `error` prop rendered the SAME validation message twice (once from
// FormField, once from Input). FormField is the single owner of the error
// message for controls it manages; Input must suppress its own error when
// managed by FormField, while still rendering its error when used standalone.

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';
import { FormField, Input } from '@merch-os/ui';

const ERROR_MESSAGE = 'Password must be at least 12 characters';

/**
 * Renders a FormField-wrapped Input with a forced error, mirroring the
 * registration form pattern that exhibited the duplicate-message bug.
 */
function FieldWithForcedError() {
  const form = useForm<{ password: string }>({
    defaultValues: { password: '' },
  });

  // Force a field error so the message renders without triggering validation.
  React.useEffect(() => {
    form.setError('password', { type: 'manual', message: ERROR_MESSAGE });
  }, [form]);

  return (
    <FormProvider {...form}>
      <FormField<{ password: string }> name="password" label="Password" required>
        {({ field, fieldState }) => (
          <Input
            {...field}
            type="password"
            // Intentionally also passing error — the historical anti-pattern.
            // FormField should remain the sole renderer of the message.
            error={fieldState.error?.message}
          />
        )}
      </FormField>
    </FormProvider>
  );
}

describe('FormField + Input error rendering (Issue 2 regression)', () => {
  it('renders a validation error exactly once when Input is managed by FormField', () => {
    render(<FieldWithForcedError />);

    const matches = screen.getAllByText(ERROR_MESSAGE);
    expect(matches).toHaveLength(1);
  });

  it('exposes exactly one alert for the error message', () => {
    render(<FieldWithForcedError />);

    const alerts = screen
      .getAllByRole('alert')
      .filter((el) => el.textContent === ERROR_MESSAGE);
    expect(alerts).toHaveLength(1);
  });

  it('does not forward the internal FormField marker onto the rendered input', () => {
    const { container } = render(<FieldWithForcedError />);

    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    // The internal signal must be consumed by Input, never leaked to the DOM.
    expect(input!.hasAttribute('data-form-field-managed')).toBe(false);
  });

  it('still renders its own error when Input is used standalone (no FormField)', () => {
    render(<Input type="text" aria-label="Standalone" error={ERROR_MESSAGE} />);

    expect(screen.getAllByText(ERROR_MESSAGE)).toHaveLength(1);
  });
});
