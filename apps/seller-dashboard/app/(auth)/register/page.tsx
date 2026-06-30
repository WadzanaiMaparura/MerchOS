'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { cognitoSignUp } from '@merch-os/auth';
import { Form, FormField, Input } from '@merch-os/ui';

/**
 * Registration form Zod schema.
 * Password policy: min 12 chars, at least 1 uppercase, 1 lowercase, 1 digit, 1 symbol.
 * Organisation name: 2-100 characters.
 */
const registrationSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one symbol'),
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password'),
  organisationName: z
    .string()
    .min(2, 'Organisation name must be at least 2 characters')
    .max(100, 'Organisation name must be at most 100 characters'),
  contactEmail: z
    .string()
    .min(1, 'Contact email is required')
    .email('Please enter a valid contact email address'),
}).refine((data) => data.password === data.confirmPassword, {
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
      email: '',
      password: '',
      confirmPassword: '',
      organisationName: '',
      contactEmail: '',
    },
  });

  async function onSubmit(data: RegistrationFormData) {
    setIsSubmitting(true);
    setError(null);

    try {
      await cognitoSignUp({
        email: data.email,
        password: data.password,
        organisationName: data.organisationName,
        contactEmail: data.contactEmail,
      });

      // Redirect to verification page with email in query params
      router.push(`/verify?email=${encodeURIComponent(data.email)}`);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Registration failed. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-900">Create an account</h1>
        <p className="mt-2 text-sm text-gray-600">
          Register your organisation to start selling on MerchOS
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
        aria-label="Registration form"
      >
        <FormField<RegistrationFormData> name="email" label="Email" required>
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="email"
              placeholder="you@example.com"
              error={fieldState.error?.message}
              disabled={isSubmitting}
              autoComplete="email"
            />
          )}
        </FormField>

        <FormField<RegistrationFormData> name="password" label="Password" required hint="Min 12 characters with uppercase, lowercase, digit, and symbol">
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="password"
              placeholder="Create a strong password"
              error={fieldState.error?.message}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
          )}
        </FormField>

        <FormField<RegistrationFormData> name="confirmPassword" label="Confirm password" required>
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="password"
              placeholder="Confirm your password"
              error={fieldState.error?.message}
              disabled={isSubmitting}
              autoComplete="new-password"
            />
          )}
        </FormField>

        <FormField<RegistrationFormData> name="organisationName" label="Organisation name" required hint="2-100 characters">
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="text"
              placeholder="Your company name"
              error={fieldState.error?.message}
              disabled={isSubmitting}
              autoComplete="organization"
            />
          )}
        </FormField>

        <FormField<RegistrationFormData> name="contactEmail" label="Contact email" required>
          {({ field, fieldState }) => (
            <Input
              {...field}
              type="email"
              placeholder="contact@yourcompany.com"
              error={fieldState.error?.message}
              disabled={isSubmitting}
              autoComplete="email"
            />
          )}
        </FormField>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Creating account...' : 'Create account'}
        </button>
      </Form>

      <p className="mt-4 text-center text-sm text-gray-600">
        Already have an account?{' '}
        <a
          href="/login"
          className="font-medium text-blue-600 hover:text-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          Sign in
        </a>
      </p>
    </div>
  );
}
