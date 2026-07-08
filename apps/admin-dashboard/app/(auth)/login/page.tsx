'use client';

/**
 * Admin Login Page — Email + password form.
 *
 * On success the admin Cognito Pool always returns a TOTP MFA challenge,
 * so we redirect to the /mfa page to complete the second factor.
 *
 * Requirements: 1.2, 1.3, 1.5
 */

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input, Form, FormField } from '@merch-os/ui';
import { useAdminAuth } from '../../../hooks/useAdminAuth';

// ─── Validation ──────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum failed attempts before lockout messaging. */
const MAX_ATTEMPTS = 5;
/** Lockout window in milliseconds (30 minutes). */
const LOCKOUT_WINDOW_MS = 30 * 60 * 1000;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminLoginPage() {
  const router = useRouter();
  const { login } = useAdminAuth();

  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState<number[]>([]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const isAccountLocked = useCallback((): boolean => {
    const now = Date.now();
    const recentAttempts = failedAttempts.filter(
      (ts) => now - ts < LOCKOUT_WINDOW_MS
    );
    return recentAttempts.length >= MAX_ATTEMPTS;
  }, [failedAttempts]);

  const onSubmit = useCallback(
    async (data: LoginFormData) => {
      setError(null);

      if (isAccountLocked()) {
        setIsLocked(true);
        setError(
          'Your account has been temporarily locked due to too many failed attempts. Please try again in 30 minutes.'
        );
        return;
      }

      setIsSubmitting(true);

      try {
        // Admin Cognito Pool mandates TOTP — login always returns MfaChallengeResult
        await login(data.email, data.password);
        // Redirect to MFA page to complete the TOTP challenge
        router.push('/mfa');
      } catch {
        const now = Date.now();
        const updatedAttempts = [...failedAttempts, now].filter(
          (ts) => now - ts < LOCKOUT_WINDOW_MS
        );
        setFailedAttempts(updatedAttempts);

        if (updatedAttempts.length >= MAX_ATTEMPTS) {
          setIsLocked(true);
          setError(
            'Your account has been temporarily locked due to too many failed attempts. Please try again in 30 minutes.'
          );
        } else {
          setError('Invalid email or password. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [login, router, failedAttempts, isAccountLocked]
  );

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Admin Sign In</h1>
        <p className="mt-2 text-sm text-gray-600">
          Enter your credentials to access the MerchOS Admin Dashboard
        </p>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className={`rounded-md p-4 text-sm ${
            isLocked
              ? 'border border-orange-200 bg-orange-50 text-orange-800'
              : 'border border-red-200 bg-red-50 text-red-800'
          }`}
        >
          {error}
        </div>
      )}

      <Form
        form={form}
        onSubmit={onSubmit}
        aria-label="Admin login form"
        className="space-y-6"
      >
        <FormField<LoginFormData> name="email" label="Email address" required>
          {({ field }) => (
            <Input
              {...field}
              type="email"
              placeholder="admin@merchos.io"
              autoComplete="email"
              disabled={isSubmitting || isLocked}
            />
          )}
        </FormField>

        <FormField<LoginFormData> name="password" label="Password" required>
          {({ field }) => (
            <Input
              {...field}
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              disabled={isSubmitting || isLocked}
            />
          )}
        </FormField>

        <button
          type="submit"
          disabled={isSubmitting || isLocked}
          className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </Form>
    </div>
  );
}
