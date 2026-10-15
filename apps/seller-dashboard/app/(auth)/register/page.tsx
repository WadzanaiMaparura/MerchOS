'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { cognitoSignUp } from '@merch-os/auth';
import { Form, FormField, Input } from '@merch-os/ui';
import { createPendingRegistration } from './register-pending-client';

/**
 * International phone number validation.
 *
 * Requires an explicit leading `+` and country code (E.164-style): a non-zero
 * leading digit followed by up to 14 further digits. We deliberately do NOT
 * assume a default country — the seller must supply the full international
 * number. No shared phone-validation helper exists in the codebase at this
 * commit, so the rule is defined here alongside the registration schema.
 */
const INTERNATIONAL_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Registration form Zod schema (approved field set).
 * - fullName: 2-100 characters
 * - email (business email): single email collected at registration
 * - phoneNumber: explicit international format, leading `+`
 * - organisationName: 2-100 characters
 * - password: min 12 chars with uppercase, lowercase, digit, symbol
 * - confirmPassword: must match password
 * - marketingConsent: optional, defaults to false
 *
 * NOTE: the previously-required separate "Contact email" field has been
 * removed. The business email is the single email address collected.
 */
const registrationSchema = z
  .object({
    fullName: z
      .string()
      .min(2, 'Full name must be at least 2 characters')
      .max(100, 'Full name must be at most 100 characters'),
    email: z
      .string()
      .min(1, 'Business email is required')
      .email('Please enter a valid email address'),
    phoneNumber: z
      .string()
      .min(1, 'Phone number is required')
      .regex(
        INTERNATIONAL_PHONE_REGEX,
        'Enter a valid international phone number, including country code (e.g. +27831234567)'
      ),
    organisationName: z
      .string()
      .min(2, 'Organisation name must be at least 2 characters')
      .max(100, 'Organisation name must be at most 100 characters'),
    password: z
      .string()
      .min(12, 'Password must be at least 12 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one digit')
      .regex(/[^A-Za-z0-9]/, 'Password must contain at least one symbol'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    marketingConsent: z.boolean().optional().default(false),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type RegistrationFormData = z.infer<typeof registrationSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    mode: 'onChange',
    defaultValues: {
      fullName: '',
      email: '',
      phoneNumber: '',
      organisationName: '',
      password: '',
      confirmPassword: '',
      marketingConsent: false,
    },
  });

  async function onSubmit(data: RegistrationFormData) {
    setIsSubmitting(true);
    setError(null);

    // Step 1: create the server-side pending-registration record FIRST. It
    // holds the business-profile fields (name, phone, organisation, consent).
    // The password is never sent to this API. If this fails, we must NOT create
    // the Cognito account.
    let registrationId: string;
    try {
      const result = await createPendingRegistration({
        fullName: data.fullName,
        email: data.email,
        phoneNumber: data.phoneNumber,
        organisationName: data.organisationName,
        marketingConsent: data.marketingConsent ?? false,
      });
      registrationId = result.registrationId;
    } catch (err: unknown) {
      // Recoverable: the Cognito account was NOT created, so the user can retry.
      const message =
        err instanceof Error
          ? err.message
          : 'Registration could not be started. Please try again.';
      setError(message);
      setIsSubmitting(false);
      return;
    }

    // Step 2: only now create the Cognito account, threading the opaque
    // registrationId through clientMetadata so PostConfirmation can correlate
    // the verified identity with the pending record.
    try {
      await cognitoSignUp({
        email: data.email,
        password: data.password,
        registrationId,
      });
    } catch (err: unknown) {
      // The pending record exists but the Cognito account was not created.
      // The pending record has a ~1 hour TTL; surface a clear, honest error and
      // do NOT claim success. Retrying creates a fresh pending record.
      const message =
        err instanceof Error ? err.message : 'Account creation failed. Please try again.';
      setError(
        `${message} Your details are held for about an hour — please retry shortly to finish creating your account.`,
      );
      setIsSubmitting(false);
      return;
    }

    // Step 3: carry email + registrationId to the verification page (never the
    // password or verification code).
    const params = new URLSearchParams({
      email: data.email,
      registrationId,
    });
    router.push(`/verify?${params.toString()}`);
    setIsSubmitting(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Create your MerchOS account</h1>
          <p className="mt-2 text-sm text-gray-600">
            Register your business to start managing your product listings
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

        <Form
          form={form}
          onSubmit={onSubmit}
          className="space-y-6"
          aria-label="Registration form"
        >
          <FormField<RegistrationFormData> name="fullName" label="Full name" required>
            {({ field }) => (
              <Input
                {...field}
                value={field.value as string}
                type="text"
                placeholder="Your first and last name"
                disabled={isSubmitting}
                autoComplete="name"
              />
            )}
          </FormField>

          <FormField<RegistrationFormData> name="email" label="Business email" required>
            {({ field }) => (
              <Input
                {...field}
                value={field.value as string}
                type="email"
                placeholder="you@yourcompany.com"
                disabled={isSubmitting}
                autoComplete="email"
              />
            )}
          </FormField>

          <FormField<RegistrationFormData>
            name="phoneNumber"
            label="Phone number"
            required
            hint="Include your country code, e.g. +27831234567"
          >
            {({ field }) => (
              <Input
                {...field}
                value={field.value as string}
                // The shared Input constrains `type` to text/email/password/
                // number, so we use `text` with `inputMode="tel"` to surface a
                // telephone keypad on mobile without widening the shared type.
                type="text"
                placeholder="+27831234567"
                disabled={isSubmitting}
                autoComplete="tel"
                inputMode="tel"
              />
            )}
          </FormField>

          <FormField<RegistrationFormData>
            name="organisationName"
            label="Organisation name"
            required
            hint="2-100 characters"
          >
            {({ field }) => (
              <Input
                {...field}
                value={field.value as string}
                type="text"
                placeholder="Your company or business name"
                disabled={isSubmitting}
                autoComplete="organization"
              />
            )}
          </FormField>

          <FormField<RegistrationFormData>
            name="password"
            label="Password"
            required
            hint="At least 12 characters, with an uppercase letter, a lowercase letter, a digit, and a symbol"
          >
            {({ field }) => (
              <Input
                {...field}
                value={field.value as string}
                type="password"
                placeholder="Create a strong password"
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            )}
          </FormField>

          <FormField<RegistrationFormData> name="confirmPassword" label="Confirm password" required>
            {({ field }) => (
              <Input
                {...field}
                value={field.value as string}
                type="password"
                placeholder="Re-enter your password"
                disabled={isSubmitting}
                autoComplete="new-password"
              />
            )}
          </FormField>

          <FormField<RegistrationFormData> name="marketingConsent">
            {({ field }) => (
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  name={field.name}
                  ref={field.ref}
                  checked={Boolean(field.value)}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.checked)}
                  disabled={isSubmitting}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
                />
                <span>
                  I&apos;d like to receive product updates and marketing emails from MerchOS
                  (optional).
                </span>
              </label>
            )}
          </FormField>

          <button
            type="submit"
            disabled={isSubmitting}
            className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-blue-300"
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </button>
        </Form>

        <p className="text-center text-sm text-gray-600">
          Already have an account?{' '}
          <a
            href="/login"
            className="font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
