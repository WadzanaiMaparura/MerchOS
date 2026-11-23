'use client';

/**
 * Refer a seller: the seller's personal link (copy / WhatsApp / email) and
 * how their referrals are doing. One free month for each referred seller who
 * subscribes and stays subscribed for 14 days. No limit.
 */

import React, { useEffect, useState } from 'react';
import { Card } from '@merch-os/ui';
import { fetchMyReferrals, type MyReferrals } from '../../components/engagement/engagement-api';

const STATUS_LABEL: Record<MyReferrals['referrals'][number]['status'], string> = {
  PENDING: 'Signed up, on free trial',
  SUBSCRIBED: 'Subscribed, counting 14 days',
  QUALIFIED: 'Qualified: free month earned',
  LAPSED: 'Stopped within 14 days',
};

export default function ReferralsPage() {
  const [data, setData] = useState<MyReferrals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMyReferrals()
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load your referral link.'));
  }, []);

  const shareText = data
    ? `I use MerchOS to write and export my marketplace listings. Try it free (15 products, no card needed): ${data.link}`
    : '';

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900">Refer a seller, get a month free</h1>
        <p className="text-sm text-gray-500">Know another seller who could use MerchOS? Share your personal link.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <Card padding="lg">
        <h2 className="text-sm font-semibold text-gray-900">Your personal link</h2>
        <div className="mt-3 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-3">
          <p className="break-all text-base font-semibold text-gray-900">{data?.linkLabel ?? 'Loading…'}</p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!data}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {copied ? 'Copied' : 'Copy my link'}
          </button>
          <a
            href={data ? `https://wa.me/?text=${encodeURIComponent(shareText)}` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!data}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Share on WhatsApp
          </a>
          <a
            href={data ? `mailto:?subject=${encodeURIComponent('Try MerchOS free')}&body=${encodeURIComponent(shareText)}` : undefined}
            aria-disabled={!data}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Share by email
          </a>
        </div>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Link copied' : ''}
        </span>
      </Card>

      <Card padding="lg">
        <h2 className="text-sm font-semibold text-gray-900">How it works</h2>
        <ol className="mt-3 space-y-3 text-sm text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">1. Share your personal link.</span> Send it to a seller on
            WhatsApp, email or anywhere you like.
          </li>
          <li>
            <span className="font-semibold text-gray-900">2. They try MerchOS free.</span> They get their first 15
            products free, no card needed.
          </li>
          <li>
            <span className="font-semibold text-gray-900">3. You get a month free.</span> When they subscribe and stay
            for 14 days, your next monthly payment is skipped.
          </li>
        </ol>
        <p className="mt-4 text-xs text-gray-500">
          One free month for each seller who subscribes through your link and stays subscribed for 14 days. There is no
          limit. Free months are applied to your next payments in order.
        </p>
      </Card>

      <Card padding="lg">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Your referrals</h2>
          {data && (
            <p className="text-sm text-gray-600">
              Free months earned: <span className="font-semibold text-gray-900">{data.freeMonthsEarned}</span>
              {data.freeMonthsApplied > 0 && <> ({data.freeMonthsApplied} used)</>}
            </p>
          )}
        </div>
        {!data ? (
          <p className="mt-3 text-sm text-gray-500">Loading…</p>
        ) : data.referrals.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No one has signed up through your link yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th scope="col" className="py-2 font-medium">Signed up</th>
                <th scope="col" className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.referrals.map((r, i) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-2 text-gray-700">
                    {new Date(r.claimedAt).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="py-2 text-gray-900">
                    {STATUS_LABEL[r.status]}
                    {r.reward === 'APPLIED' && <span className="text-gray-500"> (used)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
