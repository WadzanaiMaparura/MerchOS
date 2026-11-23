'use client';

/**
 * Referral link: merchos.co.za/r/<CODE>. Remembers the code in this browser
 * (30 days) and goes to sign-up. Once the new seller is signed in, the
 * dashboard claims it (components/engagement/ReferralClaim).
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { REFERRAL_CODE, rememberReferralCode } from '../../../components/engagement/engagement-api';

export default function ReferralLinkPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();

  useEffect(() => {
    const code = String(params?.code ?? '').trim().toUpperCase();
    if (REFERRAL_CODE.test(code)) rememberReferralCode(code);
    router.replace('/register');
  }, [params, router]);

  return (
    <section className="py-16">
      <p className="text-center text-sm text-gray-600" role="status">
        Taking you to your free trial…
      </p>
    </section>
  );
}
