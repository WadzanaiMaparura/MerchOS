'use client';

/**
 * Admin password reset: two steps.
 *   1. Enter the staff email; Cognito emails a 6-digit reset code.
 *   2. Enter the code and a new password, then sign in again (TOTP still
 *      required, so a reset alone never grants access).
 *
 * Cognito does not reveal whether an email has an account (the pool uses
 * preventUserExistenceErrors), so step 1 always moves on.
 */

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import { Form, FormField, Input } from '@merch-os/ui';

const requestSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
});
type RequestData = z.infer<typeof requestSchema>;

const confirmSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from the email'),
    newPassword: z
      .string()
      .min(12, 'Use at least 12 characters')
      .regex(/[a-z]/, 'Add a lowercase letter')
      .regex(/[A-Z]/, 'Add an uppercase letter')
      .regex(/[0-9]/, 'Add a number')
      .regex(/[^A-Za-z0-9]/, 'Add a symbol'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
type ConfirmData = z.infer<typeof confirmSchema>;

/** Plain-language versions of Cognito's errors. */
function friendlyResetError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'CodeMismatchException') return 'That code is not right. Check the latest email and try again.';
  if (name === 'ExpiredCodeException') return 'That code has expired. Send a new code and use the latest email.';
  if (name === 'LimitExceededException' || name === 'TooManyRequestsException')
    return 'Too many attempts. Please wait 15 minutes and try again.';
  if (name === 'InvalidPasswordException')
    return 'That password was not accepted. Use at least 12 characters with upper and lowercase letters, a number and a symbol.';
  return 'Something went wrong. Please try again.';
}

const button =
  'flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300';
const link =
  'font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 rounded';

export default function AdminResetPasswordPage() {
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestForm = useForm<RequestData>({ resolver: zodResolver(requestSchema), defaultValues: { email: '' } });
  const confirmForm = useForm<ConfirmData>({
    resolver: zodResolver(confirmSchema),
    defaultValues: { code: '', newPassword: '', confirmPassword: '' },
  });

  const sendCode = async (address: string) => {
    setError(null);
    setBusy(true);
    try {
      await resetPassword({ username: address.trim().toLowerCase() });
      setEmail(address.trim().toLowerCase());
      setStep('confirm');
      setNotice(`If ${address.trim()} is a staff account, a 6-digit code is on its way. It can take a minute to arrive; check spam too.`);
    } catch (err) {
      setError(friendlyResetError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (data: ConfirmData) => {
    setError(null);
    setBusy(true);
    try {
      await confirmResetPassword({ username: email, confirmationCode: data.code, newPassword: data.newPassword });
      setStep('done');
    } catch (err) {
      setError(friendlyResetError(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div key="done" className="space-y-8 text-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Password updated</h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign in with your new password. You will still be asked for the code from your authenticator app.
          </p>
        </div>
        <a href="/login" className={button}>
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    // A different key per step gives each form fresh fields (see the login page).
    <div key={step} className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          {step === 'request' ? 'Reset your password' : 'Enter your reset code'}
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          {step === 'request'
            ? 'Enter your staff email address and we will email you a 6-digit code.'
            : `Enter the code we emailed to ${email}, then choose a new password.`}
        </p>
      </div>

      {notice && step === 'confirm' && !error && (
        <div role="status" className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" aria-live="assertive" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {step === 'request' ? (
        <Form form={requestForm} onSubmit={(d) => sendCode(d.email)} aria-label="Request password reset" className="space-y-6">
          <FormField<RequestData> name="email" label="Email address" required>
            {({ field }) => (
              <Input {...field} type="email" placeholder="admin@merchos.co.za" autoComplete="email" disabled={busy} />
            )}
          </FormField>
          <button type="submit" className={button} disabled={busy} aria-busy={busy}>
            {busy ? 'Sending…' : 'Send reset code'}
          </button>
          <p className="text-center text-sm">
            <a href="/login" className={link}>
              Back to sign in
            </a>
          </p>
        </Form>
      ) : (
        <Form form={confirmForm} onSubmit={confirm} aria-label="Choose a new password" className="space-y-6">
          <FormField<ConfirmData> name="code" label="6-digit code" required>
            {({ field }) => (
              <Input {...field} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} disabled={busy} />
            )}
          </FormField>
          <FormField<ConfirmData>
            name="newPassword"
            label="New password"
            required
            hint="At least 12 characters, with upper and lowercase letters, a number and a symbol."
          >
            {({ field }) => <Input {...field} type="password" autoComplete="new-password" disabled={busy} />}
          </FormField>
          <FormField<ConfirmData> name="confirmPassword" label="Confirm new password" required>
            {({ field }) => <Input {...field} type="password" autoComplete="new-password" disabled={busy} />}
          </FormField>
          <button type="submit" className={button} disabled={busy} aria-busy={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className={link} disabled={busy} onClick={() => void sendCode(email)}>
              Send a new code
            </button>
            <button
              type="button"
              className={link}
              onClick={() => {
                setStep('request');
                setError(null);
                confirmForm.reset();
              }}
            >
              Use a different email
            </button>
          </div>
        </Form>
      )}
    </div>
  );
}
