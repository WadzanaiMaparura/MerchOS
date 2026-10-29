'use client';

/**
 * ProfileCompletionGate
 *
 * Checks the authenticated user's registration/profile status and routes a
 * genuine self-registration owner with an incomplete profile to the recovery
 * screen (/complete-profile).
 *
 * Design constraints:
 *  - On the INITIAL authenticated evaluation, dashboard children are withheld
 *    until the status check settles, so an incomplete owner is redirected
 *    without first flashing the dashboard.
 *  - Only `needs_profile_completion` triggers a redirect. Invited, complete,
 *    not-verified and conflict states are NOT routed into owner creation.
 *  - Fail-open on error: a failed/unavailable status check does NOT block
 *    authenticated users. It surfaces a dismissible warning with a Retry and
 *    renders the app. The gate is a navigation convenience; the backend is the
 *    real authorization boundary. It never silently bypasses authorization.
 *  - After the initial evaluation settles, subsequent retries preserve the
 *    fail-open availability behaviour; a retry that resolves to
 *    `needs_profile_completion` still redirects.
 *  - The /complete-profile route itself is exempt from the gate to avoid loops.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@merch-os/auth';
import { getProfileStatus, type ProfileStatusState } from '../lib/profile-api';

interface ProfileCompletionGateProps {
  children: React.ReactNode;
}

const COMPLETION_PATH = '/complete-profile';

export function ProfileCompletionGate({ children }: ProfileCompletionGateProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, accessToken } = useAuth();

  // The initial status check has resolved or failed (false only while the very
  // first authenticated evaluation is still pending). Once settled it stays
  // settled, so later retries keep rendering the dashboard (fail-open).
  const [initialSettled, setInitialSettled] = useState(false);
  const [checkError, setCheckError] = useState(false);
  // True while we have decided to redirect to /complete-profile and are waiting
  // for navigation to take effect — used to keep children withheld (no flash).
  const [redirecting, setRedirecting] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const redirectingRef = useRef(false);

  // Use the access token already held in auth state for the profile-status
  // call. Must NOT call refreshSession(): that forces a token refresh and
  // hard-redirects to /login on any failure, which — running on dashboard
  // mount right after login/MFA — bounced the user back to /login (post-OTP
  // loop). The gate fails open on a status-check error anyway.
  const getAccessToken = useCallback(async () => accessToken ?? '', [accessToken]);

  useEffect(() => {
    // Only evaluate once auth is resolved and a user exists. Until then we do
    // not withhold children here (the surrounding RouteGuard handles auth).
    if (isLoading || !user) return;

    if (pathname === COMPLETION_PATH) {
      // On the completion route the gate does not evaluate. Clear the redirect
      // flag so a later evaluation (after the user returns) can route correctly
      // rather than being blocked by a stale flag, and consider the gate
      // settled so children (the recovery screen) render normally.
      redirectingRef.current = false;
      setRedirecting(false);
      setInitialSettled(true);
      return;
    }

    let cancelled = false;
    setCheckError(false);
    // The flag only guards against a double-redirect within a single
    // evaluation; it must never persist across evaluations.
    redirectingRef.current = false;

    (async () => {
      try {
        const status: ProfileStatusState = await getProfileStatus(getAccessToken);
        if (cancelled) return;

        if (status === 'needs_profile_completion' && !redirectingRef.current) {
          redirectingRef.current = true;
          // Keep children withheld until navigation occurs (no dashboard flash).
          setRedirecting(true);
          router.replace(COMPLETION_PATH);
          return;
        }
        // 'complete' | 'invited' | 'not_verified' | 'conflict' → do not redirect
        // into owner creation; let the normal app flow render.
        setRedirecting(false);
      } catch {
        if (!cancelled) setCheckError(true);
      } finally {
        // The initial check has now settled (resolved or failed). This is a
        // no-op on later retries, so retries keep the dashboard rendered.
        if (!cancelled) setInitialSettled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, user, pathname, getAccessToken, router, retryKey]);

  const onRetry = useCallback(() => setRetryKey((k) => k + 1), []);

  // Withhold dashboard children only while the INITIAL authenticated evaluation
  // is still in flight, or while a redirect to /complete-profile is pending.
  // This applies when a user is present and we are not on the exempt route.
  const authResolvedWithUser = !isLoading && !!user;
  const onCompletionRoute = pathname === COMPLETION_PATH;
  const withholdForInitial =
    authResolvedWithUser && !onCompletionRoute && !initialSettled && !checkError;
  const withholdForRedirect = authResolvedWithUser && !onCompletionRoute && redirecting;

  if (withholdForInitial || withholdForRedirect) {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="text-sm text-gray-500">Checking your account setup…</span>
      </div>
    );
  }

  return (
    <>
      {checkError && (
        <div
          role="alert"
          aria-live="polite"
          className="flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          <span>We couldn&apos;t verify your account setup status.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            Retry
          </button>
        </div>
      )}
      {children}
    </>
  );
}
