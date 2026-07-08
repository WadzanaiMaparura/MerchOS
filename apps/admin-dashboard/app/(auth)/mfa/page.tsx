'use client';

/**
 * Admin MFA Page — 6-digit TOTP code entry.
 *
 * After a successful email + password login, the operator is redirected here
 * to complete the mandatory TOTP challenge. On success, redirects to /health.
 *
 * Requirements: 1.3, 1.4, 1.5
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input, Form, FormField } from '@merch-os/ui';
import { useAdminAuth } from '../../../hooks/useAdminAuth';

// ─── Validation ──────────────────────────────────────────────────────────────

const mfaSchema = z.object({
  code: z
    .string()
    .min(1, 'Verification code is required')
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

type MfaFormData = z.infer<typeof mfaSchema>;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminMfaPage() {
  const router = useRouter();
  const { completeMfa } = useAdminAuth();

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<MfaFormData>({
    resolver: zodResolver(mfaSchema),
    defaultValues: { code: '' },
  });

  const onSubmit = useCallback(
    async (data: MfaFormData) => {
      setError(null);
      setIsSubmitting(true);

      try {
        await completeMfa(data.code);
        // MFA complete — session is now established. Redirect to health page.
        router.replace('/health');
      } catch {
        setError('Invalid verification code. Please try again.');
        form.setValue('code', '');
      } finally {
        setIsSubmitting(false);
      }
    },
    [completeMfa, router, form]
  );

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter the 6-digit code from your authenticator app
        </p>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <Form
        form={form}
        onSubmit={onSubmit}
        aria-label="MFA verification form"
        className="space-y-6"
      >
        <FormField<MfaFormData> name="code" label="Verification Code" required>
          {({ field }) => (
            <Input
              {...field}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
              disabled={isSubmitting}
              className="text-center text-lg tracking-widest"
            />
          )}
        </FormField>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Verifying…' : 'Verify'}
        </button>
      </Form>

      <p className="text-center text-xs text-gray-500">
        Open your authenticator app (e.g., Google Authenticator, Authy) to retrieve your code.
      </p>
    </div>
  );
}
