'use client';

/**
 * Authenticated profile-completion recovery screen.
 *
 * Shown to a genuine self-registration owner whose MerchOS tenant/owner profile
 * was not persisted (e.g. a pending record expired or confirmation-time
 * persistence did not complete). Collects full name, phone, organisation name,
 * and an OPTIONAL, unchecked-by-default marketing-consent choice. Identity,
 * tenant and email are derived server-side from the authenticated session —
 * they are never sent from here.
 */

import React, { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useAuth } from '@merch-os/auth';
import { Form, FormField, Input } from '@merch-os/ui';
import { completeProfile, getProfileStatus } from '../lib/profile-api';

const schema = z.object({
  fullName: z
    .string()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be at most 100 characters'),
  phone: z
    .string()
    .min(5, 'Phone number is too short')
    .max(20, 'Phone number is too long')
    .regex(/^[+()\-\s0-9]+$/, 'Phone number contains invalid characters'),
  organisationName: z
    .string()
    .min(2, 'Organisation name must be at least 2 characters')
    .max(100, 'Organisation name must be at most 100 characters'),
  // Optional marketing consent — unchecked by default.
  consentGranted: z.boolean().optional().default(false),
  consentEmail: z.boolean().optional().default(false),
  consentSms: z.boolean().optional().default(false),
});

type FormData = z.infer<typeof schema>;

export default function CompleteProfilePage() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      fullName: '',
      phone: '',
      organisationName: '',
      consentGranted: false,
      consentEmail: false,
      consentSms: false,
    },
  });

  const consentGranted = form.watch('consentGranted');
  const getAccessToken = useCallback(async () => refreshSession(), [refreshSession]);

  async function onSubmit(data: FormData) {
    setIsSubmitting(true);
    setError(null);

    const channels: Array<'email' | 'sms'> = [];
    if (data.consentGranted) {
      if (data.consentEmail) channels.push('email');
      if (data.consentSms) channels.push('sms');
    }

    try {
      await completeProfile(getAccessToken, {
        fullName: data.fullName,
        phone: data.phone,
        organisationName: data.organisationName,
        consentGranted: !!data.consentGranted,
        consentChannels: channels,
      });

      // Re-check status before continuing into the app.
      try {
        await getProfileStatus(getAccessToken);
      } catch {
        // Non-fatal — proceed regardless; the gate will re-verify.
      }
      router.replace('/dashboard');
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'REQUEST_FAILED';
      const message =
        code === 'INVITED_ACCOUNT'
          ? 'This account is managed via an invitation and cannot create an organisation here.'
          : code === 'PROFILE_CONFLICT'
            ? 'Your account setup could not be completed due to a conflict. Please contact support.'
            : code === 'NOT_OWNER'
              ? 'Only an account owner can complete this step.'
              : 'Something went wrong. Please try again.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Complete your account setup</h1>
        <p className="mt-2 text-sm text-gray-600">
          We need a few details to finish setting up your organisation.
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

      <Form form={form} onSubmit={onSubmit} className="flex flex-col gap-4" aria-label="Profile completion form">
        <FormField<FormData> name="fullName" label="Full name" required>
          {({ field }) => (
            <Input
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              type="text"
              placeholder="Your full name"
              disabled={isSubmitting}
              autoComplete="name"
            />
          )}
        </FormField>

        <FormField<FormData> name="phone" label="Phone number" required>
          {({ field }) => (
            <Input
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              type="text"
              inputMode="tel"
              placeholder="+27 ..."
              disabled={isSubmitting}
              autoComplete="tel"
            />
          )}
        </FormField>

        <FormField<FormData> name="organisationName" label="Organisation name" required hint="2-100 characters">
          {({ field }) => (
            <Input
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              type="text"
              placeholder="Your company name"
              disabled={isSubmitting}
              autoComplete="organization"
            />
          )}
        </FormField>

        {/* Optional marketing consent — unchecked by default */}
        <fieldset className="rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">Marketing (optional)</legend>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" {...form.register('consentGranted')} disabled={isSubmitting} />
            I agree to receive marketing communications
          </label>
          {consentGranted && (
            <div className="mt-2 flex flex-col gap-1 pl-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" {...form.register('consentEmail')} disabled={isSubmitting} />
                Email
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" {...form.register('consentSms')} disabled={isSubmitting} />
                SMS
              </label>
            </div>
          )}
        </fieldset>

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Complete setup'}
        </button>
      </Form>
    </div>
  );
}
