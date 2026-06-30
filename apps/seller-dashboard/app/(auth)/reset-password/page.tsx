'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPassword, confirmResetPassword } from '@aws-amplify/auth';
import { Form, FormField, Input } from '@merch-os/ui';

/**
 * Password reset page — two-step flow:
 * Step 1: User enters email to request a reset code.
 * Step 2: User enters the verification code and a new password.
 *
 * Validates: Requirements 1.6
 */

// --- Step 1 Schema: Request Reset ---
const requestResetSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
});

type RequestResetFormData = z.infer<typeof requestResetSchema>;

// --- Step 2 Schema: Confirm Reset ---
const confirmResetSchema = z.object({
  code: z
    .string()
    .min(1, 'Verification code is required')
    .regex(/^\d{6}$/, 'Code must be a 6-digit number'),
  newPassword: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one digit')
    .regex(
      /[^A-Za-z0-9]/,
      'Password must contain at least one symbol'
    ),
});

type ConfirmResetFormData = z.infer<typeof confirmResetSchema>;

type Step = 'request' | 'confirm';

export default function ResetPasswordPage() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetComplete, setIsResetComplete] = useState(false);

  // Step 1: Request reset form
  const requestForm = useForm<RequestResetFormData>({
    resolver: zodResolver(requestResetSchema),
    defaultValues: { email: '' },
  });

  // Step 2: Confirm reset form
  const confirmForm = useForm<ConfirmResetFormData>({
    resolver: zodResolver(confirmResetSchema),
    defaultValues: { code: '', newPassword: '' },
  });

  /**
   * Step 1 handler: Send reset code to user's email.
   * Transitions to Step 2 within 5 seconds of request per Requirement 1.6.
   */
  async function handleRequestReset(data: RequestResetFormData) {
    setError(null);
    setIsSubmitting(true);

    try {
      await resetPassword({ username: data.email });
      setEmail(data.email);
      setStep('confirm');
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to send reset code. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Step 2 handler: Confirm password reset with code and new password.
   */
  async function handleConfirmReset(data: ConfirmResetFormData) {
    setError(null);
    setIsSubmitting(true);

    try {
      await confirmResetPassword({
        username: email,
        confirmationCode: data.code,
        newPassword: data.newPassword,
      });
      setIsResetComplete(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Unable to reset password. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Success state after password reset
  if (isResetComplete) {
    return (
      <div className="space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">
            Password Reset Successful
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Your password has been updated. You can now sign in with your new password.
          </p>
        </div>
        <a
          href="/login"
          className="block w-full rounded-md bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Back to Login
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          {step === 'request' ? 'Reset Your Password' : 'Enter Reset Code'}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {step === 'request'
            ? 'Enter your email address and we will send you a code to reset your password.'
            : `A verification code has been sent to ${email}. Enter the code and your new password below.`}
        </p>
      </div>

      {error && (
        <div
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          role="alert"
          aria-live="assertive"
        >
          {error}
        </div>
      )}

      {step === 'request' && (
        <Form
          form={requestForm}
          onSubmit={handleRequestReset}
          aria-label="Request password reset"
          className="space-y-6"
        >
          <FormField<RequestResetFormData> name="email" label="Email address" required>
            {({ field }) => (
              <Input
                {...field}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                disabled={isSubmitting}
              />
            )}
          </FormField>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Sending…' : 'Send Reset Code'}
          </button>

          <p className="text-center text-sm text-gray-600">
            <a
              href="/login"
              className="font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Back to Login
            </a>
          </p>
        </Form>
      )}

      {step === 'confirm' && (
        <Form
          form={confirmForm}
          onSubmit={handleConfirmReset}
          aria-label="Confirm password reset"
          className="space-y-6"
        >
          <FormField<ConfirmResetFormData> name="code" label="Verification Code" required>
            {({ field }) => (
              <Input
                {...field}
                type="text"
                placeholder="123456"
                autoComplete="one-time-code"
                disabled={isSubmitting}
              />
            )}
          </FormField>

          <FormField<ConfirmResetFormData>
            name="newPassword"
            label="New Password"
            required
            hint="At least 12 characters with uppercase, lowercase, digit, and symbol"
          >
            {({ field }) => (
              <Input
                {...field}
                type="password"
                placeholder="Enter new password"
                autoComplete="new-password"
                disabled={isSubmitting}
              />
            )}
          </FormField>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Resetting…' : 'Reset Password'}
          </button>

          <p className="text-center text-sm text-gray-600">
            <button
              type="button"
              onClick={() => {
                setStep('request');
                setError(null);
                confirmForm.reset();
              }}
              className="font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
              Use a different email
            </button>
          </p>
        </Form>
      )}
    </div>
  );
}
