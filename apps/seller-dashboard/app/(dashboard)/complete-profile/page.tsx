'use client';

/**
 * Authenticated profile-completion recovery screen.
 *
 * Shown to a genuine self-registration owner whose MerchOS tenant/owner profile
 * was not persisted (e.g. a pending record expired or confirmation-time
 * persistence did not complete). Collects full name, an international phone
 * number, and organisation name. Identity, tenant and email are derived
 * server-side from the authenticated session — they are never sent from here.
 *
 * MARKETING CONSENT: intentionally NOT collected on this screen. The consent
 * copy/version is an outstanding legal/compliance release blocker, so the
 * recovery request always sends `consentGranted: false` and no channels. No
 * marketing consent can be granted implicitly from recovery.
 *
 * PHONE: international numbers are supported (no South-Africa assumption). The
 * user must supply an explicit country code via a leading '+'. Valid input is
 * normalised to compact E.164 form (strip spaces/()/-) WITHOUT inventing or
 * defaulting a country code; unparseable/invalid input is rejected with a clear
 * message and never silently rewritten.
 */

import React, { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useAuth } from '@merch-os/auth';
import { Form, FormField, Input } from '@merch-os/ui';
import { completeProfile, getProfileStatus } from '../lib/profile-api';
import { normalizeToE164, isValidInternationalPhone } from '../lib/phone';

const schema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be at most 100 characters'),
  phone: z
    .string()
    .trim()
    .min(1, 'Phone number is required')
    // International number with an explicit country code. Validation is delegated
    // to libphonenumber-js using its per-country metadata and isValid(); a leading
    // '+' country code is required and no default country is assumed.
    .refine((v) => isValidInternationalPhone(v), {
      message:
        'Enter a valid international phone number including country code, e.g. +27 71 234 5678',
    }),
  organisationName: z
    .string()
    .trim()
    .min(2, 'Organisation name must be at least 2 characters')
    .max(100, 'Organisation name must be at most 100 characters'),
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
    },
  });

  const getAccessToken = useCallback(async () => refreshSession(), [refreshSession]);

  async function onSubmit(data: FormData) {
    setIsSubmitting(true);
    setError(null);

    // Normalise the validated phone to compact E.164 before persistence. This
    // only strips visual formatting from an already-valid international number;
    // it cannot run on invalid input (zod refine blocks submission first).
    const normalisedPhone = normalizeToE164(data.phone);
    if (!normalisedPhone) {
      // Defensive: should be unreachable because validation gates submission.
      setError('Please enter a valid international phone number including the country code.');
      setIsSubmitting(false);
      return;
    }

    try {
      await completeProfile(getAccessToken, {
        fullName: data.fullName,
        phone: normalisedPhone,
        organisationName: data.organisationName,
        // Marketing consent is never granted from the recovery screen.
        consentGranted: false,
        consentChannels: [],
      });

      // Confirm the server actually persisted the profile before proceeding.
      // Only a 'complete' status may advance into the app; anything else is a
      // recoverable error surfaced to the user (we never silently proceed, and
      // we never create tenants or determine ownership in the browser).
      let status: string;
      try {
        status = await getProfileStatus(getAccessToken);
      } catch {
        // Transient status-check failure: the write succeeded but we cannot
        // confirm it right now. Keep the user on this screen with a clear,
        // retryable message instead of advancing on an unconfirmed state.
        setError(
          'Your details were submitted but we could not confirm your account setup. Please try again in a moment.',
        );
        return;
      }

      if (status === 'complete') {
        router.replace('/dashboard');
        return;
      }

      if (status === 'needs_profile_completion') {
        setError(
          'Your account setup is not complete yet. Please review your details and try again.',
        );
        return;
      }

      // invited / not_verified / conflict (or anything unexpected): do not
      // advance into the owner flow. Surface a clear, non-silent message.
      setError(
        'Your account setup could not be completed. Please contact support if this continues.',
      );
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

        <FormField<FormData>
          name="phone"
          label="Phone number"
          required
          hint="Include your country code, e.g. +27 71 234 5678 or +44 20 7946 0958"
        >
          {({ field }) => (
            <Input
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              type="text"
              inputMode="tel"
              placeholder="+country code and number"
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
