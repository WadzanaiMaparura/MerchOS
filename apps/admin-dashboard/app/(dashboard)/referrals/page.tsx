'use client';

/**
 * Referrals: who referred whom, and the free months they earned. A referral
 * qualifies when the referred seller subscribes and is still subscribed 14
 * days later. With REFERRAL_FREE_MONTHS on, billing applies free months
 * automatically; otherwise take the free month off the referrer's next
 * payment and mark it here.
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { ENGAGEMENT_API_URL, engagementApi, type AdminReferral } from '../../../lib/engagement';

const STATUS: Record<AdminReferral['status'], { label: string; tone: string }> = {
  PENDING: { label: 'On free trial', tone: 'bg-gray-100 text-gray-700' },
  SUBSCRIBED: { label: 'Subscribed, not qualified yet', tone: 'bg-blue-50 text-blue-700' },
  QUALIFIED: { label: 'Qualified', tone: 'bg-green-50 text-green-700' },
  LAPSED: { label: 'Did not qualify', tone: 'bg-amber-50 text-amber-800' },
};

const LAPSE_REASON: Record<NonNullable<AdminReferral['lapseReason']>, string> = {
  'stopped-paying': 'Stopped paying',
  'not-active': 'Under 10 products after 90 days',
};

const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

export default function ReferralsPage() {
  return (
    <AdminRouteGuard requiredResource="referrals">
      {ENGAGEMENT_API_URL ? (
        <Referrals />
      ) : (
        <div className="p-6 text-sm text-gray-600">Referrals are not configured for this environment (NEXT_PUBLIC_ENGAGEMENT_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function Referrals() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['referrals'], queryFn: engagementApi.referrals });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = query.data?.referrals;
  const autoApply = query.data?.autoApply === true;
  const owed = rows?.filter((r) => r.reward === 'EARNED').length ?? 0;

  const markApplied = async (r: AdminReferral) => {
    const key = `${r.referrerTenantId}/${r.referredTenantId}`;
    setBusy(key);
    setError(null);
    try {
      await engagementApi.markApplied(r.referrerTenantId, r.referredTenantId);
      await queryClient.invalidateQueries({ queryKey: ['referrals'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Referrals</h1>
        <p className="mt-1 text-sm text-gray-600">
          One free month for each referred seller who subscribes, stays subscribed for 14 days and is actively using
          MerchOS (at least 10 products, checked weekly up to 90 days after paying). Free months owed:{' '}
          <strong>{owed}</strong>.{' '}
          {autoApply ? (
            <>
              Free months are applied automatically: the referrer&apos;s paid-until moves one month later (and a card on
              file is charged a month later). A free month stays owed while the referrer is not paying and is applied
              straight after their next payment. Use Mark as applied only if you gave one by hand.
            </>
          ) : (
            <>
              Free months are not applied automatically yet. Take the free month off the referrer&apos;s next payment,
              then mark it as applied.
            </>
          )}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Referred by</th>
              <th scope="col" className="px-4 py-2 font-medium">New seller</th>
              <th scope="col" className="px-4 py-2 font-medium">Signed up</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 font-medium">Free month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {query.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-gray-500">Loading…</td>
              </tr>
            )}
            {query.isError && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-red-700">{(query.error as Error).message}</td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-gray-500">No referrals yet.</td>
              </tr>
            )}
            {rows?.map((r) => {
              const key = `${r.referrerTenantId}/${r.referredTenantId}`;
              const s = STATUS[r.status];
              return (
                <tr key={key}>
                  <td className="px-4 py-2 text-gray-900">
                    {r.referrerBusiness || r.referrerTenantId}
                    <span className="block text-xs text-gray-500">Code {r.code}</span>
                  </td>
                  <td className="px-4 py-2 text-gray-900">{r.referredBusiness || r.referredTenantId}</td>
                  <td className="px-4 py-2 text-gray-700">{day(r.claimedAt)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded px-2 py-0.5 text-xs ${s.tone}`}>{s.label}</span>
                    {r.status === 'SUBSCRIBED' && r.qualifyAt && r.productsAtLastCheck === undefined && (
                      <span className="block text-xs text-gray-500">First check {day(r.qualifyAt)}</span>
                    )}
                    {r.status === 'SUBSCRIBED' && r.productsAtLastCheck !== undefined && (
                      <span className="block text-xs text-gray-500">
                        {r.productsAtLastCheck} of 10 products ({day(r.lastCheckedAt)}), checked weekly
                      </span>
                    )}
                    {r.status === 'LAPSED' && r.lapseReason && (
                      <span className="block text-xs text-gray-500">{LAPSE_REASON[r.lapseReason]}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.reward === 'EARNED' ? (
                      <button
                        type="button"
                        disabled={busy === key}
                        onClick={() => void markApplied(r)}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:opacity-50"
                      >
                        {busy === key ? 'Saving…' : 'Mark as applied'}
                      </button>
                    ) : r.reward === 'APPLIED' ? (
                      <span className="text-xs text-gray-600">
                        Applied {day(r.rewardAppliedAt)}
                        {r.rewardAppliedBy === 'automatic' && ' (automatic)'}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not earned yet</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
