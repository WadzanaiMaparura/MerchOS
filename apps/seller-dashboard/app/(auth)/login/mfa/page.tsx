'use client';

/**
 * Seller MFA Page — 6-digit email OTP code entry.
 *
 * Sellers use email OTP as their second factor (ADR-005 split: sellers =
 * low-friction email, admins = TOTP). Reached only when login() returns an
 * MFA challenge. The pending sign-in is held in the shared AuthProvider
 * (Amplify's in-memory challenge state), so completeMfa(code) resolves the
 * same challenge that the login page started. On success the session is
 * established and the user is redirected to the dashboard.
 *
 * If a user lands here without a pending challenge (e.g. a direct URL hit
 * or a page reload that cleared Amplify's in-memory state), completeMfa
 * rejects and we send them back to /login to start over.
 *
 * Validates: Requirements 1.2, 1.4
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@merch-os/auth';
import { Input, Form, FormField } from '@merch-os/ui';

// ─── Validation ──────────────────────────────────────────────────────────────

const mfaSchema = z.object({
  code: z
    .string()
    .min(1, 'Verification code is required')
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

type MfaFormData = z.infer<typeof mfaSchema>;

// ─── Component ───────────────────────────────────────────────────────────────

export default function SellerMfaPage() {
  const router = useRouter();
  const { completeMfa } = useAuth();

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
        // MFA complete — session is now established. Redirect to dashboard.
        router.replace('/dashboard');
      } catch {
        // Generic, non-enumerating message. Covers both a wrong code and a
        // missing/expired challenge (e.g. direct navigation or reload).
        setError('Invalid or expired verification code. Please try again.');
        form.setValue('code', '');
      } finally {
        setIsSubmitting(false);
      }
    },
    [completeMfa, router, form]
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Verify it&apos;s you</h1>
          <p className="mt-2 text-sm text-gray-600">
            We emailed you a 6-digit verification code. Enter it below to finish
            signing in.
          </p>
        </div>

        {/* Error message with aria-live for accessibility */}
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
          Didn&apos;t get it? Check your spam folder, or wait a moment and the code
          may still be on its way.
        </p>
      </div>
    </main>
  );
}
