'use client';

/**
 * Alerts: when something breaks it shows here, and an email goes to the alert
 * address. Checks that clear by themselves move to Resolved automatically.
 * Admin and Support see alerts; only Admin adds notes and resolves them.
 */

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { usePlatformRole } from '../../../hooks/usePlatformRole';
import { ADMIN_API_URL } from '../../../lib/customers';
import { healthApi, type Alert, type Check } from '../../../lib/health';

const registry = new PermissionRegistry(defaultPermissionConfig);
type Tab = 'open' | 'resolved' | 'checks';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} days ago`;
}

function lasted(a: Alert): string {
  const m = Math.max(1, Math.round((new Date(a.resolvedAt ?? a.lastSeenAt).getTime() - new Date(a.startedAt).getTime()) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
}

const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export default function AlertsPage() {
  return (
    <AdminRouteGuard requiredResource="alerts">
      {ADMIN_API_URL ? (
        <Alerts />
      ) : (
        <div className="p-6 text-sm text-gray-600">Alerts are not configured for this environment (NEXT_PUBLIC_ADMIN_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function Alerts() {
  const [tab, setTab] = useState<Tab>('open');
  const { platformRole } = usePlatformRole();
  const canManage = !!platformRole && registry.hasPermission(platformRole, 'alerts', 'update').granted;
  const status = tab === 'resolved' ? 'resolved' : 'open';
  const q = useQuery({ queryKey: ['alerts', status], queryFn: () => healthApi.alerts(status), refetchInterval: 60_000 });
  const checks = q.data?.checks ?? [];

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'open', label: `Open${q.data ? ` ${q.data.openCount}` : ''}` },
    { id: 'resolved', label: 'Resolved' },
    { id: 'checks', label: `All checks${checks.length ? ` (${checks.length})` : ''}` },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Alerts</h1>
        <p className="mt-1 text-sm text-gray-600">
          When something breaks, it shows here and an email goes to the alert address. Checks run every 15 minutes.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              tab === t.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {q.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">{(q.error as Error).message}</p>}

      {q.data && tab !== 'checks' && (
        <div className="space-y-3">
          {q.data.alerts.length === 0 && (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">
              {tab === 'open' ? 'Nothing is wrong right now.' : 'No resolved alerts yet.'}
            </p>
          )}
          {q.data.alerts.map((a) => (
            <AlertCard key={a.alertId} alert={a} canManage={canManage} />
          ))}
          {!canManage && tab === 'open' && q.data.alerts.length > 0 && (
            <p className="text-xs text-gray-500">Adding notes and resolving alerts are for Admin staff.</p>
          )}
        </div>
      )}

      {q.data && tab === 'checks' && <Checks checks={checks} />}
    </div>
  );
}

function AlertCard({ alert: a, canManage }: { alert: Alert; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'note' | 'resolve' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = a.status === 'OPEN';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'note') await healthApi.addNote(a.alertId, text.trim());
      else await healthApi.resolve(a.alertId, text.trim());
      setMode(null);
      setText('');
      await queryClient.invalidateQueries({ queryKey: ['alerts'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`rounded-lg border p-4 ${open ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">
          <span className={`mr-2 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${open ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
            {open ? 'Open' : 'Resolved'}
          </span>
          {a.title}
        </h2>
        <span className="text-xs text-gray-600">
          {open ? `Started ${when(a.startedAt)} (${ago(a.startedAt)})` : `${when(a.startedAt)} · lasted ${lasted(a)}`}
        </span>
      </div>
      <p className="mt-2 text-sm text-gray-800">{a.description}</p>
      {open && (
        <p className="mt-2 text-sm text-gray-800">
          <span className="font-semibold">What to do:</span> {a.whatToDo}
        </p>
      )}
      {!open && (
        <p className="mt-2 text-sm text-gray-700">
          {a.resolvedBy === 'auto' ? 'Cleared by itself.' : `Resolved by ${a.resolvedByEmail ?? 'staff'}.`}
          {a.resolutionNote ? ` "${a.resolutionNote}"` : ''}
        </p>
      )}
      {a.notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-200 pt-2 text-sm text-gray-800">
          {a.notes.map((n, i) => (
            <li key={i}>
              <span className="text-xs text-gray-500">{when(n.at)} · {n.byEmail ?? 'staff'}:</span> {n.text}
            </li>
          ))}
        </ul>
      )}

      {open && canManage && (
        <div className="mt-3">
          {mode ? (
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="text-xs font-medium text-gray-700">{mode === 'note' ? 'Note' : 'What fixed it (optional)'}</span>
                <textarea
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                  rows={2}
                  maxLength={1000}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="flex gap-2">
                <button type="button" className={`${btn} bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || (mode === 'note' && !text.trim())} onClick={() => void submit()}>
                  {busy ? 'Saving…' : mode === 'note' ? 'Save note' : 'Mark as resolved'}
                </button>
                <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`} disabled={busy} onClick={() => setMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <button type="button" className={`${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`} onClick={() => setMode('note')}>
                Add a note
              </button>
              <button type="button" className={`${btn} bg-blue-600 text-white hover:bg-blue-700`} onClick={() => setMode('resolve')}>
                Mark as resolved
              </button>
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
        </div>
      )}
    </article>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  const STATE: Record<Check['state'], { label: string; tone: string }> = {
    ok: { label: 'OK', tone: 'bg-green-100 text-green-800' },
    alert: { label: 'Alert', tone: 'bg-amber-100 text-amber-800' },
    no_data: { label: 'Waiting for data', tone: 'bg-gray-100 text-gray-700' },
  };
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full min-w-[560px] text-left text-sm">
        <caption className="sr-only">All automatic checks</caption>
        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Check</th>
            <th scope="col" className="px-3 py-2 font-medium">Type</th>
            <th scope="col" className="px-3 py-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {checks.map((c) => (
            <tr key={c.key}>
              <td className="px-3 py-2 text-gray-900">{c.label}</td>
              <td className="px-3 py-2 text-gray-600">{c.kind === 'health' ? 'Health check' : 'Alarm'}</td>
              <td className="px-3 py-2">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATE[c.state].tone}`}>{STATE[c.state].label}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
