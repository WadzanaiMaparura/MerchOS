'use client';

/**
 * Billing (Admin only, read only): paying customers, totals, invoices and
 * payments. Money moves only through PayFast; there is nothing here that
 * charges, refunds or changes a plan.
 */

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { ADMIN_API_URL } from '../../../lib/customers';
import { billingApi, type BillingFilter, type BillingRow, type BillingStatus } from '../../../lib/billing';
import { ENGAGEMENT_API_URL, engagementApi } from '../../../lib/engagement';
import { formatNumber, formatRand } from '../../../lib/format';

const FILTERS: Array<{ id: BillingFilter; label: string }> = [
  { id: 'paying', label: 'Paying' },
  { id: 'renewing', label: 'Renews in 7 days' },
  { id: 'lapsed', label: 'Lapsed' },
  { id: 'problems', label: 'Payment problems' },
  { id: 'all', label: 'All' },
];

const STATUS: Record<BillingStatus, { label: string; tone: string }> = {
  paid: { label: 'Paid', tone: 'bg-green-100 text-green-800' },
  lapsed: { label: 'Lapsed', tone: 'bg-red-100 text-red-800' },
  problem: { label: 'Payment problem', tone: 'bg-amber-100 text-amber-800' },
};

/** Lapsed customers show where they are in the payment cycle. */
function statusOf(r: BillingRow): { label: string; tone: string } {
  if (r.status === 'lapsed') {
    if (r.stage === 'grace') return { label: 'Overdue (grace)', tone: 'bg-amber-100 text-amber-800' };
    if (r.stage === 'paused') return { label: 'Paused', tone: 'bg-red-100 text-red-800' };
    if (r.stage === 'closed') return { label: 'Closed', tone: 'bg-gray-200 text-gray-800' };
  }
  return STATUS[r.status];
}

const rand = formatRand;
const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const short = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) : '');

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

export default function BillingPage() {
  return (
    <AdminRouteGuard requiredResource="billing">
      {ADMIN_API_URL ? (
        <Billing />
      ) : (
        <div className="p-6 text-sm text-gray-600">Billing is not configured for this environment (NEXT_PUBLIC_ADMIN_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function Billing() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<BillingFilter>('paying');
  const [selected, setSelected] = useState<BillingRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({ queryKey: ['billing', q, filter], queryFn: () => billingApi.list(q, filter) });
  const s = list.data?.summary;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Billing</h1>
        <p className="mt-1 text-sm text-gray-600">
          Paying customers, payments and invoices. Read only: money moves through PayFast, not this page.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Paying customers" value={s ? String(s.paying) : '…'}>
          {s && Object.keys(s.byPlan).length > 0
            ? Object.entries(s.byPlan).map(([plan, n]) => `${plan} ${n}`).join(' · ')
            : 'None yet'}
        </Stat>
        <Stat label="Monthly revenue (list prices)" value={s ? rand(s.monthlyListCents) : '…'}>
          {s ? `after vouchers: ${rand(s.monthlyAfterVouchersCents)}` : ''}
        </Stat>
        <Stat label="Paid this month" value={s ? rand(s.paidThisMonthCents) : '…'}>
          {s ? `${s.paymentsThisMonth} payment${s.paymentsThisMonth === 1 ? '' : 's'}` : ''}
        </Stat>
        <Stat label="Need attention" value={s ? String(s.attention.problems + s.attention.lapsed) : '…'}>
          {s ? `${s.attention.problems} payment problem${s.attention.problems === 1 ? '' : 's'} · ${s.attention.lapsed} lapsed` : ''}
        </Stat>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[240px] flex-1">
          <span className="sr-only">Search billing</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business, seller ID, plan or invoice number"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter billing">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                filter === f.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {f.label} {list.data ? list.data.counts[f.id] : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
        <div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">Paying customers</caption>
              <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Business</th>
                  <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                  <th scope="col" className="px-3 py-2 font-medium">Price</th>
                  <th scope="col" className="px-3 py-2 font-medium">Paid until</th>
                  <th scope="col" className="px-3 py-2 font-medium">Last payment</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.isLoading && <tr><td colSpan={6} className="px-3 py-3 text-gray-500">Loading…</td></tr>}
                {list.isError && <tr><td colSpan={6} className="px-3 py-3 text-red-700">{(list.error as Error).message}</td></tr>}
                {list.data?.customers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-3 text-gray-500">
                      {filter === 'paying' && !q
                        ? 'No paying customers yet. Subscriptions appear here once checkout is switched on.'
                        : 'No customers match.'}
                    </td>
                  </tr>
                )}
                {list.data?.customers.map((r) => (
                  <tr key={r.tenantId} className={`cursor-pointer hover:bg-gray-50 ${selected?.tenantId === r.tenantId ? 'bg-blue-50' : ''}`} onClick={() => setSelected(r)}>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-semibold text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(r);
                        }}
                        aria-current={selected?.tenantId === r.tenantId ? 'true' : undefined}
                      >
                        {r.businessName ?? r.sellerId}
                      </button>
                      <span className="block text-xs text-gray-500">{r.sellerId}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-900">{r.planName}</td>
                    <td className="px-3 py-2 text-gray-900">{rand(r.priceCents)}</td>
                    <td className="px-3 py-2 text-gray-700">{day(r.paidUntil)}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.lastPayment ? (
                        <>
                          {short(r.lastPayment.at)} · {rand(r.lastPayment.amountCents)}
                          {r.lastPayment.voucherCode && <span className="text-xs text-gray-500"> (voucher)</span>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2"><Badge tone={statusOf(r).tone}>{statusOf(r).label}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Overdue (grace): up to 3 days late, everything still works. Paused: day 3 to 37, no new products or listings.
            Closed: from day 37, the seller can only sign in to pay. Payment problem: PayFast sent a payment that was not
            fully applied within 15 minutes, so someone should check it.
          </p>
        </div>

        {selected ? (
          <BillingPanel key={selected.tenantId} row={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="hidden items-center justify-center rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 xl:flex">
            Select a customer.
          </div>
        )}
      </div>

      {ENGAGEMENT_API_URL && <WhyTheyLeft />}
    </div>
  );
}

/** Answers to the "why did you leave?" email (sent 60 days after a plan ran out). */
function WhyTheyLeft() {
  const q = useQuery({ queryKey: ['leave-feedback'], queryFn: engagementApi.feedback });
  const counts = new Map<string, number>();
  for (const f of q.data ?? []) counts.set(f.label, (counts.get(f.label) ?? 0) + 1);
  return (
    <section aria-labelledby="why-left" className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 id="why-left" className="font-semibold text-gray-900">Why sellers left</h2>
        <p className="text-xs text-gray-500">Answers to the email sent 60 days after a plan ran out.</p>
      </div>
      <div className="px-4 py-3 text-sm">
        {q.isLoading && <p className="text-gray-500">Loading…</p>}
        {q.isError && <p role="alert" className="text-red-700">{(q.error as Error).message}</p>}
        {q.data?.length === 0 && <p className="text-gray-500">No answers yet.</p>}
        {counts.size > 0 && (
          <p className="mb-2 text-gray-700">
            {[...counts].map(([label, n]) => `${label}: ${n}`).join(' · ')}
          </p>
        )}
        <ul className="divide-y divide-gray-100">
          {q.data?.map((f) => (
            <li key={f.tenantId} className="py-2">
              <span className="font-medium text-gray-900">{f.businessName || 'A seller'}</span>
              <span className="text-gray-500"> · {day(f.at)}</span>
              <span className="block text-gray-800">{f.label}</span>
              {f.comment && <span className="block text-gray-600">&ldquo;{f.comment}&rdquo;</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
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

function BillingPanel({ row, onClose }: { row: BillingRow; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['billing-detail', row.tenantId], queryFn: () => billingApi.get(row.tenantId) });
  const d = detail.data;
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const openPdf = async (invoiceId: string) => {
    setPdfError(null);
    setOpening(invoiceId);
    try {
      window.open(await billingApi.invoicePdf(row.tenantId, invoiceId), '_blank', 'noopener');
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Could not open the invoice.');
    } finally {
      setOpening(null);
    }
  };

  const limit = row.monthlyProducts;
  const used = d?.monthUsage ?? null;
  const percent = limit && used !== null ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <section aria-labelledby="billing-heading" className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
        <div className="min-w-0">
          <h2 id="billing-heading" className="truncate text-lg font-semibold text-gray-900">{row.businessName ?? row.sellerId}</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {row.sellerId} · {row.planName} plan{row.since ? ` since ${day(row.since)}` : ''}
          </p>
          <p className="mt-1"><Badge tone={statusOf(row).tone}>{statusOf(row).label}</Badge></p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          Close
        </button>
      </div>

      {detail.isLoading && <p className="p-4 text-sm text-gray-500">Loading…</p>}
      {detail.isError && <p className="p-4 text-sm text-red-700">{(detail.error as Error).message}</p>}

      {d && (
        <>
          <Section title="Subscription">
            <Row k="Plan">{d.planName} · {rand(d.priceCents)} a month</Row>
            <Row k="Paid until">{day(d.paidUntil) || '—'}{d.status === 'paid' ? ' (next payment due then)' : ''}</Row>
            {limit !== null && (
              <Row k="This month">
                {used === null ? (
                  <span className="text-gray-500">{formatNumber(limit)} new products allowed (counted once the product limit is switched on)</span>
                ) : (
                  <>
                    {formatNumber(used)} of {formatNumber(limit)} new products
                    <span className="mt-1 block h-2 w-full overflow-hidden rounded bg-gray-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${percent}% of this month's products used`}>
                      <span className="block h-full bg-blue-600" style={{ width: `${percent}%` }} />
                    </span>
                  </>
                )}
              </Row>
            )}
            {d.lastPayment?.voucherCode && <Row k="Voucher">{d.lastPayment.voucherCode} on the last payment</Row>}
            <Row k="Free months owed">{d.freeMonthsOwed} {d.freeMonthsOwed > 0 && <span className="text-gray-500">(referrals, see Referrals)</span>}</Row>
          </Section>

          <Section title="Invoices">
            {d.invoices.length === 0 ? (
              <p className="text-sm text-gray-500">No invoices yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {d.invoices.map((i) => (
                  <li key={i.invoiceId} className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                    <span className="text-gray-800">{i.invoiceNumber ?? 'Not numbered yet'} · {day(i.createdAt)}</span>
                    <span className="flex items-center gap-2 text-gray-900">
                      {rand(i.amountCents)}
                      {i.hasPdf ? (
                        <button type="button" className="text-blue-700 underline disabled:opacity-50" disabled={opening === i.invoiceId} onClick={() => void openPdf(i.invoiceId)}>
                          PDF<span className="sr-only"> for {i.invoiceNumber}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-500">PDF pending</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {pdfError && <p role="alert" className="mt-2 text-sm text-red-700">{pdfError}</p>}
          </Section>

          <Section title="Payments" last>
            {d.payments.length === 0 ? (
              <p className="text-sm text-gray-500">No payments yet.</p>
            ) : (
              d.payments.map((p) => (
                <Row key={p.mPaymentId} k={short(p.createdAt)}>
                  {p.amountCents !== undefined ? rand(p.amountCents) : '—'} · PayFast ·{' '}
                  {p.applied ? 'applied' : <span className="font-semibold text-amber-800">not applied yet</span>}
                </Row>
              ))
            )}
          </Section>
        </>
      )}
    </section>
  );
}

function Section({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`px-4 py-3 ${last ? '' : 'border-b border-gray-100'}`}>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <dl className="grid grid-cols-[120px_1fr] gap-x-3">
      <dt className="text-gray-500">{k}</dt>
      <dd className="min-w-0 break-words text-gray-900">{children}</dd>
    </dl>
  );
}
