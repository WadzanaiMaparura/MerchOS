'use client';

import React, { useState, Suspense } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { cognitoConfirmSignUp } from '@merch-os/auth';
import { Form, FormField, Input } from '@merch-os/ui';

/**
 * Verification code Zod schema.
 * Code is typically 6 digits from Cognito.
 */
const verificationSchema = z.object({
  code: z
    .string()
    .min(1, 'Verification code is required')
    .regex(/^\d{6}$/, 'Verification code must be 6 digits'),
});

export type VerificationFormData = z.infer<typeof verificationSchema>;

function VerifyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<VerificationFormData>({
    resolver: zodResolver(verificationSchema),
    mode: 'onChange',
    defaultValues: {
      code: '',
    },
  });

  async function onSubmit(data: VerificationFormData) {
    if (!email) {
      setError('Email address is missing. Please go back to registration.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await cognitoConfirmSignUp(email, data.code);

      if (result.isSignUpComplete) {
        setSuccess(true);
        // Redirect to login page after successful verification
        setTimeout(() => {
          router.push('/login');
        }, 1500);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Verification failed. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-6 w-6 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Email verified</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your account has been activated. Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Verify your email</h1>
        <p className="mt-2 text-sm text-gray-600">
          {email ? (
            <>
              We sent a verification code to{' '}
              <span className="font-medium text-gray-900">{email}</span>
            </>
          ) : (
            'Enter the verification code sent to your email'
          )}
        </p>
      </div>

      {error && (
        <div
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      )}

      <Form
        form={form}
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
        aria-label="Email verification form"
      >
        <FormField<VerificationFormData> name="code" label="Verification code" required hint="Enter the 6-digit code from your email">
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="text"
              placeholder="123456"
              error={fieldState.error?.message}
              disabled={isSubmitting}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
            />
          )}
        </FormField>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Verifying...' : 'Verify email'}
        </button>
      </Form>

      <p className="mt-4 text-center text-sm text-gray-600">
        Didn&apos;t receive a code?{' '}
        <a
          href="/register"
          className="font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Register again
        </a>
      </p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Verify your email</h1>
            <p className="mt-2 text-sm text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  );
}
