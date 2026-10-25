'use client';

/**
 * Admin MFA Enrollment Page.
 *
 * Reached when an operator signs in with a valid password but has no TOTP
 * device enrolled. Admin access is MFA-gated at the application layer because
 * the shared Cognito pool is `Mfa.OPTIONAL` (ADR-002: one pool + RBAC groups)
 * and cannot force a second factor for operators on its own.
 *
 * Flow:
 *  1. On mount, begin TOTP enrollment (setUpTotp) to obtain the shared secret
 *     and an otpauth:// setup URI.
 *  2. Render the URI as a QR code (plus the secret for manual entry) so the
 *     operator can register MerchOS in an authenticator app.
 *  3. The operator enters the 6-digit code; verifyTotp confirms it with Cognito
 *     and marks TOTP as the preferred second factor.
 *  4. On success, send the operator back to /login to sign in again — their
 *     next login will now present the TOTP challenge and reach the dashboard.
 *
 * Requirements: 1.2, 1.5
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@merch-os/auth';
import { Input, Form, FormField } from '@merch-os/ui';

// ─── Validation ──────────────────────────────────────────────────────────────

const verifySchema = z.object({
  code: z
    .string()
    .min(1, 'Verification code is required')
    .regex(/^\d{6}$/, 'Code must be exactly 6 digits'),
});

type VerifyFormData = z.infer<typeof verifySchema>;

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminMfaSetupPage() {
  const router = useRouter();
  const { setUpTotp, verifyTotp } = useAuth();

  const [setupUri, setSetupUri] = useState<string | null>(null);
  const [sharedSecret, setSharedSecret] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isLoadingSetup, setIsLoadingSetup] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);

  // Guard against React 18 StrictMode double-invocation of the effect, which
  // would otherwise start two enrollments.
  const startedRef = useRef(false);

  const form = useForm<VerifyFormData>({
    resolver: zodResolver(verifySchema),
    defaultValues: { code: '' },
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const details = await setUpTotp();
        if (cancelled) return;
        setSetupUri(details.setupUri);
        setSharedSecret(details.sharedSecret);
      } catch {
        if (cancelled) return;
        // Most likely no active session (direct navigation / expired). Send the
        // operator back to sign in rather than showing a broken setup screen.
        setInitError(
          'We could not start two-factor setup. Please sign in again and retry.'
        );
      } finally {
        if (!cancelled) setIsLoadingSetup(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setUpTotp]);

  const onCopySecret = useCallback(async () => {
    if (!sharedSecret) return;
    try {
      await navigator.clipboard.writeText(sharedSecret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 2000);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the secret is still
      // shown on screen for manual entry, so this is non-fatal.
    }
  }, [sharedSecret]);

  const onSubmit = useCallback(
    async (data: VerifyFormData) => {
      setVerifyError(null);
      setIsSubmitting(true);
      try {
        await verifyTotp(data.code);
        // Enrollment complete. Re-authenticate so the next login presents the
        // TOTP challenge and reaches the dashboard.
        router.replace('/login');
      } catch {
        setVerifyError('Invalid or expired code. Please try again.');
        form.setValue('code', '');
      } finally {
        setIsSubmitting(false);
      }
    },
    [verifyTotp, router, form]
  );

  const onBackToLogin = useCallback(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Set Up Two-Factor Authentication
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Admin access requires an authenticator app. Scan the code below to
          register MerchOS, then enter the 6-digit code it generates.
        </p>
      </div>

      {initError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {initError}
          <button
            type="button"
            onClick={onBackToLogin}
            className="mt-3 flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500"
          >
            Back to sign in
          </button>
        </div>
      )}

      {!initError && isLoadingSetup && (
        <p className="text-center text-sm text-gray-500" aria-live="polite">
          Preparing your setup code…
        </p>
      )}

      {!initError && !isLoadingSetup && setupUri && (
        <>
          <div className="flex flex-col items-center space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Authenticator QR code">
              <QRCodeSVG value={setupUri} size={176} includeMargin={false} />
            </div>

            {sharedSecret && (
              <div className="w-full text-center">
                <p className="text-xs text-gray-500">Can&apos;t scan? Enter this key manually:</p>
                <div className="mt-1 flex items-center justify-center gap-2">
                  <code className="break-all rounded bg-gray-100 px-2 py-1 font-mono text-sm text-gray-800">
                    {sharedSecret}
                  </code>
                  <button
                    type="button"
                    onClick={onCopySecret}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    aria-label="Copy setup key"
                  >
                    {secretCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {verifyError && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
            >
              {verifyError}
            </div>
          )}

          <Form
            form={form}
            onSubmit={onSubmit}
            aria-label="Verify authenticator code form"
            className="space-y-6"
          >
            <FormField<VerifyFormData> name="code" label="Verification Code" required>
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
              {isSubmitting ? 'Verifying…' : 'Verify and enable'}
            </button>
          </Form>
        </>
      )}
    </div>
  );
}
