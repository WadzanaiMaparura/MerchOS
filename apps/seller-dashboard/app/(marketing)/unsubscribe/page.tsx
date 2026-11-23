'use client';

/**
 * Unsubscribe from marketing emails (the review request and referral emails),
 * opened from the footer link (?t=<signed link>). A button press confirms it,
 * so link scanners that open every URL cannot unsubscribe anyone by accident.
 * Account emails (sign-in codes, billing) are not affected.
 */

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { unsubscribe } from '../../components/engagement/engagement-api';

export default function UnsubscribePage() {
  return (
    <section className="py-12 sm:py-16">
      <div className="mx-auto max-w-lg px-6">
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <Unsubscribe />
        </Suspense>
      </div>
    </section>
  );
}

function Unsubscribe() {
  const token = useSearchParams()?.get('t') ?? '';
  const [state, setState] = useState<'ready' | 'busy' | 'done'>('ready');
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setState('busy');
    setError(null);
    try {
      await unsubscribe(token);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setState('ready');
    }
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
      {state === 'done' ? (
        <div role="status">
          <h1 className="text-2xl font-bold text-gray-900">You are unsubscribed</h1>
          <p className="mt-3 text-sm text-gray-600">
            We will not send you review requests or offers again. You will still get emails about your account, such as
            sign-in codes and invoices.
          </p>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold text-gray-900">Unsubscribe from MerchOS offers?</h1>
          <p className="mt-3 text-sm text-gray-600">
            You will stop getting review requests and referral offers. Emails about your account, such as sign-in codes
            and invoices, will still arrive.
          </p>
          {!token && <p className="mt-4 text-sm text-red-700">This link is not complete. Please use the link in your email.</p>}
          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!token || state === 'busy'}
            className="mt-6 rounded-xl bg-[#2563EB] px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60"
          >
            {state === 'busy' ? 'Unsubscribing…' : 'Yes, unsubscribe me'}
          </button>
        </>
      )}
      <a href="/" className="mt-6 block text-sm font-semibold text-blue-700 underline">
        Back to merchos.co.za
      </a>
    </div>
  );
}
