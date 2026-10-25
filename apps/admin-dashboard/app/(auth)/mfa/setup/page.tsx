'use client';

/**
 * Admin MFA Setup Required Page.
 *
 * Reached when an operator signs in with a valid password but has no TOTP
 * device enrolled. Admin access is MFA-gated at the application layer because
 * the shared Cognito pool is `Mfa.OPTIONAL` (ADR-002: one pool + RBAC groups)
 * and cannot force a second factor for operators on its own.
 *
 * This page blocks dashboard access and directs the operator to enroll a TOTP
 * device. The full in-app enrollment flow (AssociateSoftwareToken /
 * VerifySoftwareToken via the /auth/mfa/setup API) is a separate feature; until
 * it ships, operators enroll via the documented onboarding runbook.
 *
 * Requirements: 1.2, 1.5
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminMfaSetupPage() {
  const router = useRouter();

  const onBackToLogin = useCallback(() => {
    router.replace('/login');
  }, [router]);

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">
          Two-Factor Authentication Required
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Admin access requires a registered authenticator app.
        </p>
      </div>

      <div
        role="alert"
        aria-live="polite"
        className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
      >
        <p>
          Your account signed in successfully, but no two-factor authentication
          device is enrolled. For security, the admin dashboard cannot be
          accessed without a second factor.
        </p>
        <p className="mt-3">
          Enroll a TOTP authenticator (e.g. Google Authenticator or Authy) by
          following the operator onboarding runbook, then sign in again to
          complete the two-factor challenge.
        </p>
      </div>

      <button
        type="button"
        onClick={onBackToLogin}
        className="flex w-full justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        Back to sign in
      </button>
    </div>
  );
}
