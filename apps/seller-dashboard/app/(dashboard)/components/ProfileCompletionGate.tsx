'use client';

/**
 * ProfileCompletionGate
 *
 * Checks the authenticated user's registration/profile status once and routes a
 * genuine self-registration owner with an incomplete profile to the recovery
 * screen (/complete-profile).
 *
 * Design constraints:
 *  - Only `needs_profile_completion` triggers a redirect. Invited users,
 *    complete users, and conflicts are NOT routed into owner creation here.
 *  - A failed/unavailable status check does NOT block unrelated authenticated
 *    users: it surfaces a controlled, dismissible error with a retry and lets
 *    the app render. It never silently bypasses authorization.
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
  const { user, isLoading, refreshSession } = useAuth();

  const [checkError, setCheckError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const redirectingRef = useRef(false);

  const getAccessToken = useCallback(async () => refreshSession(), [refreshSession]);

  useEffect(() => {
    // Don't gate the completion route itself (prevents redirect loops), and
    // only run once auth is resolved and a user exists.
    if (isLoading || !user) return;
    if (pathname === COMPLETION_PATH) return;

    let cancelled = false;
    setCheckError(false);

    (async () => {
      try {
        const status: ProfileStatusState = await getProfileStatus(getAccessToken);
        if (cancelled) return;

        if (status === 'needs_profile_completion' && !redirectingRef.current) {
          redirectingRef.current = true;
          router.replace(COMPLETION_PATH);
        }
        // 'complete' | 'invited' | 'not_verified' | 'conflict' → do not redirect
        // into owner creation; let the normal app flow continue.
      } catch {
        if (!cancelled) setCheckError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoading, user, pathname, getAccessToken, router, retryKey]);

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
            onClick={() => setRetryKey((k) => k + 1)}
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
