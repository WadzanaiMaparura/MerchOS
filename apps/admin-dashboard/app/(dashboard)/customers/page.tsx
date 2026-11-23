'use client';

/**
 * Customers: every seller business on MerchOS, for the support team.
 *
 * Support and Admin: find a seller, see their account, plan, products, emails,
 * referrals and history; resend the sign-up verification email.
 * Admin only: disable / enable the account (everyone in the business is signed
 * out; data is kept) and give or remove a free unlimited account. Both need a
 * reason, which goes in the audit log.
 */

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { usePlatformRole } from '../../../hooks/usePlatformRole';
import {
  ADMIN_API_URL,
  customersApi,
  type AuditEntry,
  type CustomerDetail,
  type CustomerFilter,
  type CustomerRow,
} from '../../../lib/customers';

const registry = new PermissionRegistry(defaultPermissionConfig);

const FILTERS: Array<{ id: CustomerFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'trial', label: 'On trial' },
  { id: 'paid', label: 'Paying' },
  { id: 'exempt', label: 'Free unlimited' },
  { id: 'not_verified', label: 'Not verified' },
  { id: 'disabled', label: 'Disabled' },
];

const PLAN_TONE: Record<CustomerRow['plan']['kind'], string> = {
  trial: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  exempt: 'bg-violet-100 text-violet-800',
  not_started: 'bg-gray-100 text-gray-700',
};

const ACCOUNT: Record<CustomerRow['account'], { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-green-100 text-green-800' },
  disabled: { label: 'Disabled', tone: 'bg-red-100 text-red-800' },
  not_verified: { label: 'Not verified', tone: 'bg-orange-100 text-orange-800' },
  profile_incomplete: { label: 'Profile not finished', tone: 'bg-orange-100 text-orange-800' },
};

const EMAIL_LABEL: Record<string, string> = {
  'trial-welcome': 'Trial welcome',
  tips: 'Tips (day 2)',
  training: 'Training (day 5)',
  'subscription-welcome': 'Subscription welcome',
  'review-request': 'Review request',
  'referral-invite': 'Referral invite',
};

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  'resend-verification': 'resent the verification email',
  disable: 'disabled the account',
  enable: 'enabled the account',
  exempt: 'gave a free unlimited account',
  'remove-exempt': 'removed the free unlimited account',
};

const day = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const rand = (cents: number) => `R${(cents / 100).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const btnDanger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;

function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}>{children}</span>;
}

export default function CustomersPage() {
  return (
    <AdminRouteGuard requiredResource="users.search">
      {ADMIN_API_URL ? (
        <Customers />
      ) : (
        <div className="p-6 text-sm text-gray-600">Customers is not configured for this environment (NEXT_PUBLIC_ADMIN_API_URL).</div>
      )}
    </AdminRouteGuard>
  );
}

function Customers() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [selected, setSelected] = useState<CustomerRow | null>(null);

  // Search after a short pause in typing.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const list = useQuery({ queryKey: ['customers', q, filter], queryFn: () => customersApi.list(q, filter) });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Customers</h1>
        <p className="mt-1 text-sm text-gray-600">Every seller account: who they are, what they use, and the support actions for them.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-[260px] flex-1">
          <span className="sr-only">Search customers</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email, business name, phone or seller ID (MOS-…)"
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter customers">
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_440px]">
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Customers</caption>
            <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Business</th>
                <th scope="col" className="px-3 py-2 font-medium">Owner</th>
                <th scope="col" className="px-3 py-2 font-medium">Plan</th>
                <th scope="col" className="px-3 py-2 font-medium">Products</th>
                <th scope="col" className="px-3 py-2 font-medium">Account</th>
                <th scope="col" className="px-3 py-2 font-medium">Signed up</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.isLoading && (
                <tr><td colSpan={6} className="px-3 py-3 text-gray-500">Loading…</td></tr>
              )}
              {list.isError && (
                <tr><td colSpan={6} className="px-3 py-3 text-red-700">{(list.error as Error).message}</td></tr>
              )}
              {list.data?.customers.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-3 text-gray-500">No customers match.</td></tr>
              )}
              {list.data?.customers.map((c) => (
                <tr
                  key={c.key}
                  className={`cursor-pointer hover:bg-gray-50 ${selected?.key === c.key ? 'bg-blue-50' : ''}`}
                  onClick={() => setSelected(c)}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-semibold text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(c);
                      }}
                      aria-current={selected?.key === c.key ? 'true' : undefined}
                    >
                      {c.businessName ?? (c.kind === 'signup' ? 'Sign-up not finished' : 'No business name')}
                    </button>
                    {c.sellerId && <span className="block text-xs text-gray-500">{c.sellerId}</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-900">
                    {c.ownerName ?? ''}
                    <span className="block text-xs text-gray-500">{c.ownerEmail}</span>
                  </td>
                  <td className="px-3 py-2"><Badge tone={PLAN_TONE[c.plan.kind]}>{c.plan.label}</Badge></td>
                  <td className="px-3 py-2 text-gray-700">{c.products}</td>
                  <td className="px-3 py-2"><Badge tone={ACCOUNT[c.account].tone}>{ACCOUNT[c.account].label}</Badge></td>
                  <td className="px-3 py-2 text-gray-700">{day(c.signedUpAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <CustomerPanel key={selected.key} row={selected} onClose={() => setSelected(null)} />
        ) : (
          <div className="hidden items-center justify-center rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 xl:flex">
            Select a customer.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detail panel ────────────────────────────────────────────────────────────

type Pending = { kind: 'disable' | 'enable' | 'exempt' | 'remove-exempt' } | null;

function CustomerPanel({ row, onClose }: { row: CustomerRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { platformRole } = usePlatformRole();
  const canManage = !!platformRole && registry.hasPermission(platformRole, 'users', 'update').granted;
  const canResend = !!platformRole && registry.hasPermission(platformRole, 'users.verification', 'create').granted;

  const detail = useQuery({
    queryKey: ['customer', row.tenantId],
    queryFn: () => customersApi.get(row.tenantId!),
    enabled: row.kind === 'tenant' && !!row.tenantId,
  });
  const c: CustomerRow & Partial<CustomerDetail> = detail.data ?? row;

  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customers'] }),
      queryClient.invalidateQueries({ queryKey: ['customer', row.tenantId] }),
    ]);
  };

  const run = async (task: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      setMessage({ ok: true, text: done });
      setPending(null);
      setReason('');
      await refresh();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!pending || !row.tenantId) return;
    const t = row.tenantId;
    if (pending.kind === 'disable') void run(() => customersApi.disable(t, reason), 'Account disabled. Everyone in this business was signed out.');
    if (pending.kind === 'enable') void run(() => customersApi.enable(t, reason), 'Account enabled.');
    if (pending.kind === 'exempt') void run(() => customersApi.setExempt(t, true, reason), 'This is now a free unlimited account.');
    if (pending.kind === 'remove-exempt') void run(() => customersApi.setExempt(t, false, reason), 'Free unlimited account removed.');
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(c.ownerEmail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const disabled = c.account === 'disabled';
  const exempt = c.plan.kind === 'exempt';
  const needsVerification = c.account === 'not_verified';
  const CONFIRM_TEXT: Record<NonNullable<Pending>['kind'], string> = {
    disable: 'Disable this account? Everyone in the business is signed out and cannot sign in. Their data is kept.',
    enable: 'Enable this account? Everyone in the business can sign in again.',
    exempt: 'Make this a free unlimited account? The 15-product trial limit stops applying, and billing never overwrites it.',
    'remove-exempt': 'Remove the free unlimited account? It goes back to paying (if a paid period is running) or the free trial.',
  };

  return (
    <section aria-labelledby="customer-heading" className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 p-4">
        <div className="min-w-0">
          <h2 id="customer-heading" className="truncate text-lg font-semibold text-gray-900">
            {c.businessName ?? (c.kind === 'signup' ? 'Sign-up not finished' : 'No business name')}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {c.sellerId ? `${c.sellerId} · ` : ''}signed up {day(c.signedUpAt)}
          </p>
          <p className="mt-1 flex gap-1.5">
            <Badge tone={PLAN_TONE[c.plan.kind]}>{c.plan.label}</Badge>
            <Badge tone={ACCOUNT[c.account].tone}>{ACCOUNT[c.account].label}</Badge>
          </p>
        </div>
        <button type="button" className={btnSecondary} onClick={onClose}>Close</button>
      </div>

      {detail.isLoading && <p className="p-4 text-sm text-gray-500">Loading…</p>}
      {detail.isError && <p className="p-4 text-sm text-red-700">{(detail.error as Error).message}</p>}

      <Section title="Account">
        <Row k="Owner">{c.ownerName ?? '—'}</Row>
        <Row k="Email">{c.ownerEmail}</Row>
        {c.phone && <Row k="Phone">{c.phone}</Row>}
        {c.marketingConsent !== undefined && (
          <Row k="Marketing emails">
            {c.marketingConsent?.granted ? 'Agreed at sign-up' : 'Did not agree at sign-up'}
            {c.engagement?.marketingOptOut ? ' · unsubscribed since' : ''}
          </Row>
        )}
        {c.team && (
          <Row k="Team">
            <ul className="space-y-0.5">
              {c.team.map((m) => (
                <li key={m.userId}>
                  {m.email} <span className="text-gray-500">({m.role ?? 'member'}{m.enabled ? '' : ', disabled'})</span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {c.kind === 'signup' && (
          <p className="mt-2 text-xs text-gray-500">
            This person started signing up but never entered the code from their email, so there is no business yet.
          </p>
        )}
        {c.account === 'profile_incomplete' && (
          <p className="mt-2 text-xs text-gray-500">Signed in, but has not finished the business details yet.</p>
        )}
      </Section>

      {c.kind === 'tenant' && (
        <Section title="Plan and usage">
          <Row k="Plan">{c.plan.label}</Row>
          <Row k="Products">{c.products}</Row>
          {c.subscription && (
            <Row k="Paid until">{c.subscription.currentPeriodEnd ? day(c.subscription.currentPeriodEnd) : '—'} ({c.subscription.status})</Row>
          )}
          {c.invoices && (
            <Row k="Invoices">
              {c.invoices.length === 0
                ? 'None yet'
                : c.invoices.slice(0, 3).map((i) => (
                    <span key={i.invoiceId} className="block">
                      {i.invoiceNumber ?? 'Invoice'} · {rand(i.amountCents)} · {day(i.createdAt)}
                    </span>
                  ))}
            </Row>
          )}
        </Section>
      )}

      {c.engagement && (
        <Section title="Emails, referrals and reviews">
          <Row k="Emails sent">
            {c.engagement.emailsSent.length === 0
              ? 'None yet'
              : c.engagement.emailsSent.map((e) => `${EMAIL_LABEL[e.email] ?? e.email} (${day(e.sentAt)})`).join(' · ')}
          </Row>
          <Row k="Referral link">
            {c.engagement.referralCode ? `merchos.co.za/r/${c.engagement.referralCode}` : '—'} · {c.engagement.referralsMade} referred
            {c.engagement.freeMonthsEarned ? ` · ${c.engagement.freeMonthsEarned} free month(s)` : ''}
          </Row>
          {c.engagement.referredByBusiness && <Row k="Referred by">{c.engagement.referredByBusiness}</Row>}
          <Row k="Review">
            {c.engagement.review ? `${c.engagement.review.rating} stars (${c.engagement.review.status.toLowerCase()})` : 'Not yet'}
          </Row>
        </Section>
      )}

      {c.audit && (
        <Section title="Support history">
          {c.audit.length === 0 ? (
            <p className="text-sm text-gray-500">No staff actions yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm text-gray-800">
              {c.audit.map((a, i) => (
                <li key={i}>
                  <span className="text-gray-500">{when(a.at)}</span> · {a.byRole || 'Staff'} {ACTION_LABEL[a.action]}
                  {a.detail ? ` (${a.detail})` : ''}
                  {a.reason && <span className="block text-xs text-gray-600">Reason: {a.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {/* Actions */}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => void copyEmail()}>
            {copied ? 'Copied' : 'Copy email'}
          </button>
          {canResend && (
            <button
              type="button"
              className={btnSecondary}
              disabled={busy || !needsVerification}
              title={needsVerification ? undefined : 'Their email is already verified'}
              onClick={() => void run(() => customersApi.resendVerification(c.ownerUserId), 'Verification email sent.')}
            >
              Resend verification email
            </button>
          )}
          {canManage && c.kind === 'tenant' && (
            <>
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => setPending({ kind: exempt ? 'remove-exempt' : 'exempt' })}>
                {exempt ? 'Remove free unlimited' : 'Make free unlimited'}
              </button>
              <button
                type="button"
                className={disabled ? btnSecondary : btnDanger}
                disabled={busy}
                onClick={() => setPending({ kind: disabled ? 'enable' : 'disable' })}
              >
                {disabled ? 'Enable account' : 'Disable account'}
              </button>
            </>
          )}
        </div>
        <span className="sr-only" aria-live="polite">{copied ? 'Email copied' : ''}</span>

        {pending && (
          <div role="group" aria-labelledby="confirm-text" className="rounded-md border border-gray-300 bg-gray-50 p-3">
            <p id="confirm-text" className="text-sm text-gray-900">{CONFIRM_TEXT[pending.kind]}</p>
            <label className="mt-2 block">
              <span className="text-xs font-medium text-gray-700">Reason (goes in the audit log)</span>
              <textarea
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoFocus
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className={pending.kind === 'disable' ? `${btn} bg-red-600 text-white hover:bg-red-700` : btnPrimary}
                disabled={busy || reason.trim().length < 3}
                onClick={confirm}
              >
                {busy ? 'Saving…' : 'Confirm'}
              </button>
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}

        {message && (
          <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-green-700' : 'text-red-700'}`}>
            {message.text}
          </p>
        )}
        {!canManage && (
          <p className="text-xs text-gray-500">Disabling accounts and free unlimited accounts are for Admin staff.</p>
        )}
      </div>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-100 px-4 py-3">
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
