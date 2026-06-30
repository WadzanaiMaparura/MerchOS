'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@merch-os/auth';
import { Input, Form, FormField } from '@merch-os/ui';

/**
 * Zod schema for login form validation.
 * Email must be a valid format; password is required.
 */
const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

/** Maximum failed attempts before lockout display */
const MAX_ATTEMPTS = 5;
/** Lockout window in milliseconds (15 minutes) */
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * Login page for the Seller Dashboard.
 * Validates: Requirements 1.2, 1.3, 1.4, 14.3
 */
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState<number[]>([]);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  /**
   * Check if account is locked based on recent failed attempts within the 15-minute window.
   */
  const isAccountLocked = useCallback((): boolean => {
    const now = Date.now();
    const recentAttempts = failedAttempts.filter(
      (timestamp) => now - timestamp < LOCKOUT_WINDOW_MS
    );
    return recentAttempts.length >= MAX_ATTEMPTS;
  }, [failedAttempts]);

  /**
   * Handle form submission — authenticate against Cognito via the auth module.
   * On success: redirect to dashboard within 5 seconds.
   * On failure: display generic error without revealing email existence.
   * After 5 failed attempts in 15 minutes: display lockout message.
   */
  const onSubmit = useCallback(
    async (data: LoginFormData) => {
      setError(null);

      // Check lockout before attempting
      if (isAccountLocked()) {
        setIsLocked(true);
        setError(
          'Your account has been temporarily locked due to too many failed login attempts. Please try again in 15 minutes.'
        );
        return;
      }

      setIsSubmitting(true);

      try {
        const result = await login(data.email, data.password);

        // If MFA challenge is returned, handle accordingly
        if (result && 'challengeType' in result) {
          // MFA flow — for now redirect to MFA page (future task)
          router.push('/login/mfa');
          return;
        }

        // Successful authentication — redirect to dashboard
        router.push('/dashboard');
      } catch {
        // Record failed attempt timestamp
        const now = Date.now();
        const updatedAttempts = [...failedAttempts, now].filter(
          (timestamp) => now - timestamp < LOCKOUT_WINDOW_MS
        );
        setFailedAttempts(updatedAttempts);

        // Check if we've hit the lockout threshold
        if (updatedAttempts.length >= MAX_ATTEMPTS) {
          setIsLocked(true);
          setError(
            'Your account has been temporarily locked due to too many failed login attempts. Please try again in 15 minutes.'
          );
        } else {
          // Generic error message — does not reveal whether email exists (Requirement 1.3)
          setError('Invalid email or password. Please try again.');
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [login, router, failedAttempts, isAccountLocked]
  );

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Sign in to MerchOS
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter your credentials to access your seller dashboard
          </p>
        </div>

        {/* Error / lockout message with aria-live for accessibility */}
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
          aria-label="Login form"
          className="space-y-6"
        >
          <FormField<LoginFormData> name="email" label="Email address" required>
            {({ field }) => (
              <Input
                {...field}
                type="email"
                placeholder="you@example.com"
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

          <div className="flex items-center justify-between">
            <a
              href="/forgot-password"
              className="text-sm font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Forgot your password?
            </a>
          </div>

          <button
            type="submit"
            disabled={isSubmitting || isLocked}
            className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </Form>

        <p className="text-center text-sm text-gray-600">
          Don&apos;t have an account?{' '}
          <a
            href="/register"
            className="font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Create an account
          </a>
        </p>
      </div>
    </main>
  );
}
