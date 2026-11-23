'use client';

/**
 * Audit log (Admin only): every staff action, newest first. Who did what to
 * which customer, when, and why. Read only.
 *
 * Today: Customers actions (verification resent, disable/enable, free unlimited),
 * review decisions and referral free months applied.
 */

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { ADMIN_API_URL } from '../../../lib/customers';
import { fetchAudit, type AuditEvent } from '../../../lib/audit';

const PAGE_SIZE = 50;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const field =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

export default function AuditLogPage() {
  return (
    <AdminRouteGuard requiredResource="audit-log">
      {ADMIN_API_URL ? (
        <AuditLog />
      ) : (
        <div className="p-6 text-sm text-gray-600">The audit log is not configured for this environment (NEXT_PUBLIC_ADMIN_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function AuditLog() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [staff, setStaff] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = { from, to, action, staff, q, page, pageSize: PAGE_SIZE };
  const audit = useQuery({ queryKey: ['audit', query], queryFn: () => fetchAudit(query) });
  const total = audit.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(1);
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Audit log</h1>
        <p className="mt-1 text-sm text-gray-600">Every staff action, newest first: who did what to which customer, when and why.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <label className="min-w-[220px] flex-1 text-sm">
          <span className="mb-1 block font-medium text-gray-700">Search</span>
          <input type="search" className={`${field} w-full`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer, staff email or reason" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">From</span>
          <input type="date" className={field} value={from} max={to || undefined} onChange={(e) => reset(setFrom)(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">To</span>
          <input type="date" className={field} value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Action</span>
          <select className={field} value={action} onChange={(e) => reset(setAction)(e.target.value)}>
            <option value="">All actions</option>
            {audit.data?.actions.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">Staff member</span>
          <select className={field} value={staff} onChange={(e) => reset(setStaff)(e.target.value)}>
            <option value="">Everyone</option>
            {audit.data?.staff.map((s) => (
              <option key={s.id} value={s.id}>{s.email} ({s.role})</option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Staff actions</caption>
          <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">When</th>
              <th scope="col" className="px-3 py-2 font-medium">Staff member</th>
              <th scope="col" className="px-3 py-2 font-medium">Action</th>
              <th scope="col" className="px-3 py-2 font-medium">Customer</th>
              <th scope="col" className="px-3 py-2 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {audit.isLoading && <tr><td colSpan={5} className="px-3 py-3 text-gray-500">Loading…</td></tr>}
            {audit.isError && <tr><td colSpan={5} className="px-3 py-3 text-red-700">{(audit.error as Error).message}</td></tr>}
            {audit.data?.events.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-gray-500">No staff actions match.</td></tr>
            )}
            {audit.data?.events.map((e) => (
              <Row key={e.id} e={e} open={open === e.id} onToggle={() => setOpen(open === e.id ? null : e.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <nav className="flex items-center justify-between text-sm text-gray-600" aria-label="Audit log pages">
          <span>
            {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <span className="flex gap-2">
            <button type="button" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 disabled:opacity-50" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button type="button" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 disabled:opacity-50" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </span>
        </nav>
      )}
    </div>
  );
}

function Row({ e, open, onToggle }: { e: AuditEvent; open: boolean; onToggle: () => void }) {
  const detailsId = `audit-${e.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return (
    <>
      <tr className="align-top">
        <td className="whitespace-nowrap px-3 py-2 text-gray-700">{when(e.at)}</td>
        <td className="px-3 py-2 text-gray-900">
          {e.byEmail ?? 'Former staff member'}
          {e.byRole && <span className="block text-xs text-gray-500">{e.byRole}</span>}
        </td>
        <td className="px-3 py-2 text-gray-900">
          <button
            type="button"
            className="text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={onToggle}
          >
            {e.label}
          </button>
          {e.detail && <span className="block text-xs text-gray-500">{e.detail}</span>}
        </td>
        <td className="px-3 py-2 text-gray-900">{e.subject ?? '—'}</td>
        <td className="px-3 py-2 text-gray-700">{e.reason ?? <span className="text-gray-400">—</span>}</td>
      </tr>
      {open && (
        <tr id={detailsId}>
          <td colSpan={5} className="bg-gray-50 px-6 py-3 text-xs text-gray-700">
            <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1">
              <dt className="text-gray-500">Exact time</dt><dd>{e.at}</dd>
              <dt className="text-gray-500">Staff user id</dt><dd className="break-all">{e.byId}</dd>
              {e.tenantId && (<><dt className="text-gray-500">Customer id</dt><dd className="break-all">{e.tenantId}</dd></>)}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
