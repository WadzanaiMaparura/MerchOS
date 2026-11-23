'use client';

/**
 * Health: is MerchOS working right now? One line per part of MerchOS, in plain
 * words, from the last 24 hours or 7 days. Admin and Support (view only).
 */

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { ADMIN_API_URL } from '../../../lib/customers';
import { formatNumber, formatRand } from '../../../lib/format';
import { healthApi, type AreaHealth, type AreaStatus, type HealthRange } from '../../../lib/health';

const STATUS: Record<AreaStatus, { label: string; tone: string }> = {
  working: { label: 'Working', tone: 'bg-green-100 text-green-800' },
  no_activity: { label: 'No activity', tone: 'bg-gray-100 text-gray-700' },
  some_errors: { label: 'Some errors', tone: 'bg-amber-100 text-amber-800' },
  down: { label: 'Down', tone: 'bg-red-100 text-red-800' },
  not_live: { label: 'Not live yet', tone: 'bg-gray-100 text-gray-700' },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

export default function HealthPage() {
  return (
    <AdminRouteGuard requiredResource="infrastructure">
      {ADMIN_API_URL ? (
        <Health />
      ) : (
        <div className="p-6 text-sm text-gray-600">Health is not configured for this environment (NEXT_PUBLIC_ADMIN_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function summaryLine(areas: AreaHealth[], openAlerts: number): { text: string; tone: string } {
  const down = areas.filter((a) => a.status === 'down');
  const errs = areas.filter((a) => a.status === 'some_errors');
  if (down.length) {
    return { text: `${down.map((a) => a.label).join(', ')} ${down.length === 1 ? 'is' : 'are'} down.`, tone: 'border-red-200 bg-red-50 text-red-900' };
  }
  if (errs.length || openAlerts) {
    const n = errs.length;
    return {
      text: `MerchOS is working. ${n} area${n === 1 ? '' : 's'} had errors${openAlerts ? `, ${openAlerts} open alert${openAlerts === 1 ? '' : 's'}` : ''} (see below).`,
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
    };
  }
  return { text: 'All systems working.', tone: 'border-green-200 bg-green-50 text-green-900' };
}

function Health() {
  const [range, setRange] = useState<HealthRange>('24h');
  const q = useQuery({ queryKey: ['health', range], queryFn: () => healthApi.health(range), refetchInterval: 5 * 60_000 });
  const d = q.data;
  const peak = Math.max(1, ...(d?.errorSeries ?? []).map((s) => s.errors));

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Health</h1>
          <p className="mt-1 text-sm text-gray-600">
            Is MerchOS working right now?{d ? ` Checked ${when(d.checkedAt)}.` : ''}
          </p>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Time range">
          {(['24h', '7d'] as HealthRange[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                range === r ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {r === '24h' ? 'Last 24 hours' : 'Last 7 days'}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-gray-500">Checking…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">{(q.error as Error).message}</p>}

      {d && (
        <>
          <p role="status" className={`rounded-lg border px-4 py-3 text-sm font-semibold ${summaryLine(d.areas, d.openAlerts).tone}`}>
            {summaryLine(d.areas, d.openAlerts).text}{' '}
            {d.openAlerts > 0 && (
              <Link href="/alerts" className="font-semibold underline">
                Open Alerts
              </Link>
            )}
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[680px] text-left text-sm">
              <caption className="sr-only">Health of each part of MerchOS</caption>
              <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Area</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Requests</th>
                  <th scope="col" className="px-3 py-2 font-medium">Errors</th>
                  <th scope="col" className="px-3 py-2 font-medium">What it covers</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {d.areas.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-semibold text-gray-900">{a.label}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS[a.status].tone}`}>{STATUS[a.status].label}</span>
                      {a.openAlerts > 0 && <span className="ml-1 text-xs text-amber-800">alert open</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {a.id === 'emails' && a.sent !== undefined ? `${formatNumber(a.sent)} sent` : formatNumber(a.requests)}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {a.id === 'emails' && a.bounced !== undefined
                        ? `${formatNumber(a.errors)} · ${formatNumber(a.bounced)} bounced`
                        : a.errors > 0 && a.requests > 0
                          ? `${formatNumber(a.errors)} (${Math.max(1, Math.round((a.errors / a.requests) * 100))}%)`
                          : formatNumber(a.errors)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{a.covers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Seller businesses" value={formatNumber(d.sellers.businesses)}>
              {formatNumber(d.sellers.newInRange)} new {range === '24h' ? 'in the last 24 hours' : 'in the last 7 days'}
            </Stat>
            <Stat label="Writing requests" value={formatNumber(d.writing.requests)}>
              titles, descriptions and bullets each count
            </Stat>
            <Stat label="Writing cost (approx.)" value={formatRand(d.writing.approxCostCents)}>
              from token use at list prices, R18 to the dollar
            </Stat>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <p className="text-xs text-gray-500">Errors over time</p>
              <div className="mt-2 flex h-10 items-end gap-px" role="img" aria-label={`Errors over time, highest ${peak}`}>
                {d.errorSeries.map((s) => (
                  <span
                    key={s.at}
                    title={`${when(s.at)}: ${s.errors} error${s.errors === 1 ? '' : 's'}`}
                    className={`flex-1 rounded-sm ${s.errors ? 'bg-amber-500' : 'bg-gray-200'}`}
                    style={{ height: `${s.errors ? Math.max(15, (s.errors / peak) * 100) : 8}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{children}</p>
    </div>
  );
}
