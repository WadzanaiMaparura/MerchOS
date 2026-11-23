'use client';

/**
 * Claims a referral link followed before sign-up (stored by /r/<code>), once
 * the new seller is signed in. Renders nothing. Final answers (claimed, own
 * link, unknown code, already subscribed) clear the stored code; network
 * errors leave it for the next visit.
 */

import { useEffect, useRef } from 'react';
import { EngagementApiError, claimReferral, forgetReferralCode, storedReferralCode } from './engagement-api';

export function ReferralClaim({ ready }: { ready: boolean }) {
  const tried = useRef(false);
  useEffect(() => {
    if (!ready || tried.current) return;
    const code = storedReferralCode();
    if (!code) return;
    tried.current = true;
    claimReferral(code)
      .then(() => forgetReferralCode())
      .catch((err: unknown) => {
        if (err instanceof EngagementApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 429) {
          forgetReferralCode();
        }
      });
  }, [ready]);
  return null;
}
