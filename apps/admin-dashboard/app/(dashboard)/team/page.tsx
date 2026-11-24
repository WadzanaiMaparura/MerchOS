'use client';

/**
 * Team: announcements, team goals and team chat, for MerchOS staff. Only in
 * the dashboard (no emails); unread items show on the Team menu badge.
 * Admin posts announcements and sets goals; a goal's owner updates its progress.
 * Chat checks for new messages every 5 seconds while it is open.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PermissionRegistry, defaultPermissionConfig } from '@merch-os/rbac';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { usePlatformRole } from '../../../hooks/usePlatformRole';
import { ADMIN_API_URL } from '../../../lib/customers';
import { formatNumber } from '../../../lib/format';
import { teamApi, type Announcement, type Channel, type Goal, type TeamMessage } from '../../../lib/team';

const registry = new PermissionRegistry(defaultPermissionConfig);
type Tab = 'announcements' | 'goals' | 'chat';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const thisMonth = () => new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 7);
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' });
const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mo - 1 + by, 15)).toISOString().slice(0, 7);
};

const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const field = 'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30';

export default function TeamPage() {
  return (
    <AdminRouteGuard requiredResource="team">
      {ADMIN_API_URL ? <Team /> : <div className="p-6 text-sm text-gray-600">Team is not configured for this environment.</div>}
    </AdminRouteGuard>
  );
}

function Team() {
  const [tab, setTab] = useState<Tab>('announcements');
  const { platformRole } = usePlatformRole();
  const isAdmin = !!platformRole && registry.hasPermission(platformRole, 'team', 'update').granted;
  const unread = useQuery({ queryKey: ['team', 'unread'], queryFn: teamApi.unread, refetchInterval: 15_000 });

  const TABS: Array<{ id: Tab; label: string; count?: number }> = [
    { id: 'announcements', label: 'Announcements', count: unread.data?.announcements },
    { id: 'goals', label: 'Goals' },
    { id: 'chat', label: 'Chat', count: unread.data?.chat },
  ];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Team</h1>
        <p className="mt-1 text-sm text-gray-600">Announcements, team goals and team chat. Only in the dashboard, no emails.</p>
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
            {t.count ? <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{t.count}<span className="sr-only"> unread</span></span> : null}
          </button>
        ))}
      </div>
      {tab === 'announcements' && <Announcements isAdmin={isAdmin} />}
      {tab === 'goals' && <Goals isAdmin={isAdmin} />}
      {tab === 'chat' && <Chat />}
    </div>
  );
}

// ─── Announcements ──────────────────────────────────────────────────────────

function Announcements({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['team', 'announcements'], queryFn: teamApi.announcements });
  const [writing, setWriting] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['team', 'announcements'] }),
    queryClient.invalidateQueries({ queryKey: ['team', 'unread'] }),
  ]);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {isAdmin && !writing && (
        <button type="button" className={btnPrimary} onClick={() => setWriting(true)}>New announcement</button>
      )}
      {writing && (
        <form
          className="space-y-2 rounded-lg border border-gray-200 bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => teamApi.post(title.trim(), body.trim())).then((ok) => {
              if (ok) {
                setWriting(false);
                setTitle('');
                setBody('');
              }
            });
          }}
        >
          <label className="block text-sm font-medium text-gray-700">Title<input className={field} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="block text-sm font-medium text-gray-700">Message<textarea className={`${field} min-h-[120px]`} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={busy || title.trim().length < 3 || !body.trim()}>{busy ? 'Posting…' : 'Post to the team'}</button>
            <button type="button" className={btnSecondary} onClick={() => setWriting(false)}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {q.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {q.data?.length === 0 && <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">No announcements yet.</p>}
      {q.data?.map((a: Announcement) => (
        <article key={a.announcementId} className={`rounded-lg border p-4 ${a.read ? 'border-gray-200 bg-white' : 'border-blue-300 bg-blue-50'}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="font-semibold text-gray-900">{a.title}</h2>
            {!a.read && <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">NEW</span>}
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-900">{a.body}</p>
          <p className="mt-2 text-xs text-gray-500">
            {a.createdByEmail} · {when(a.createdAt)}
            {isAdmin && a.audience > 0 && <> · Read by {a.readBy} of {a.audience}</>}
          </p>
          <div className="mt-2 flex gap-2">
            {!a.read && <button type="button" className={btnSecondary} disabled={busy} onClick={() => void run(() => teamApi.markRead(a.announcementId))}>Mark as read</button>}
            {isAdmin && <button type="button" className={`${btn} text-red-700 hover:bg-red-50`} disabled={busy} onClick={() => void run(() => teamApi.removeAnnouncement(a.announcementId))}>Delete</button>}
          </div>
        </article>
      ))}
    </div>
  );
}

// ─── Goals ──────────────────────────────────────────────────────────────────

function Goals({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const q = useQuery({ queryKey: ['team', 'goals', month], queryFn: () => teamApi.goals(month) });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['team', 'goals'] });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnSecondary} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
        <h2 className="min-w-[150px] text-center font-semibold text-gray-900">{monthLabel(month)}</h2>
        <button type="button" className={btnSecondary} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
        {isAdmin && !adding && <button type="button" className={`${btnPrimary} ml-auto`} onClick={() => setAdding(true)}>New goal</button>}
      </div>
      {adding && q.data && (
        <GoalForm
          month={month}
          metrics={q.data.metrics}
          staff={q.data.staff}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            void refresh();
          }}
        />
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {q.isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {q.data?.goals.length === 0 && <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-600">No goals for this month.</p>}
      {q.data?.goals.map((g) => (
        <GoalCard
          key={g.goalId}
          goal={g}
          isAdmin={isAdmin}
          onChanged={() => void refresh()}
          onError={setError}
        />
      ))}
    </div>
  );
}

function GoalCard({ goal: g, isAdmin, onChanged, onError }: { goal: Goal; isAdmin: boolean; onChanged: () => void; onError: (m: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(String(g.progress));
  const [status, setStatus] = useState(g.status ?? '');
  const [busy, setBusy] = useState(false);
  const percent = Math.min(100, Math.round((g.progress / g.target) * 100));

  const act = async (task: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await task();
      setEditing(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{g.title}</h3>
        <span className="text-sm text-gray-900">{formatNumber(g.progress)} / {formatNumber(g.target)}{g.status ? ` · ${g.status}` : ''}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-gray-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.title}: ${percent}%`}>
        <div className={`h-full ${percent >= 100 ? 'bg-green-600' : 'bg-blue-600'}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {g.kind === 'auto' ? `Counted automatically: ${g.metricLabel}` : `Updated by hand${g.updatedByEmail ? ` by ${g.updatedByEmail}` : ''}`}
        {g.ownerEmail && <> · owner: {g.ownerEmail}</>}
      </p>
      {editing ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs font-medium text-gray-700">Progress<input type="number" min={0} className={`${field} w-28`} value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
          <label className="flex-1 text-xs font-medium text-gray-700">Short status (optional)<input className={field} maxLength={140} value={status} onChange={(e) => setStatus(e.target.value)} placeholder="e.g. On track" /></label>
          <button type="button" className={btnPrimary} disabled={busy || !/^\d+$/.test(current)} onClick={() => void act(() => teamApi.updateProgress(g.goalId, Number(current), status.trim()))}>Save</button>
          <button type="button" className={btnSecondary} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          {g.canUpdate && <button type="button" className={btnSecondary} onClick={() => setEditing(true)}>Update progress</button>}
          {isAdmin && <button type="button" className={`${btn} text-red-700 hover:bg-red-50`} disabled={busy} onClick={() => void act(() => teamApi.removeGoal(g.goalId))}>Delete</button>}
        </div>
      )}
    </article>
  );
}

function GoalForm({
  month,
  metrics,
  staff,
  onCancel,
  onSaved,
}: {
  month: string;
  metrics: Array<{ id: string; label: string }>;
  staff: Array<{ id: string; email: string }>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const [kind, setKind] = useState<'auto' | 'manual'>('manual');
  const [metric, setMetric] = useState(metrics[0]?.id ?? '');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await teamApi.createGoal({
        title: title.trim(),
        month,
        target: Number(target),
        kind,
        ...(kind === 'auto' ? { metric } : {}),
        ...(ownerId ? { ownerId } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="font-semibold text-gray-900">New goal for {monthLabel(month)}</h3>
      <label className="block text-sm font-medium text-gray-700">Goal<input className={field} maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Onboard 20 new sellers" /></label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-sm font-medium text-gray-700">Target<input type="number" min={1} className={field} value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label className="block text-sm font-medium text-gray-700">
          How it is counted
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as 'auto' | 'manual')}>
            <option value="manual">Updated by hand</option>
            <option value="auto">Counted automatically</option>
          </select>
        </label>
        {kind === 'auto' ? (
          <label className="block text-sm font-medium text-gray-700">
            Counts
            <select className={field} value={metric} onChange={(e) => setMetric(e.target.value)}>
              {metrics.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        ) : (
          <label className="block text-sm font-medium text-gray-700">
            Owner (updates progress)
            <select className={field} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Admin only</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={busy || title.trim().length < 3 || !(Number(target) > 0)}>{busy ? 'Saving…' : 'Save goal'}</button>
        <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ─── Chat ───────────────────────────────────────────────────────────────────

function Chat() {
  const queryClient = useQueryClient();
  const channels = useQuery({ queryKey: ['team', 'channels'], queryFn: teamApi.channels, refetchInterval: 15_000 });
  const [channel, setChannel] = useState('everyone');
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastAt = useRef<string | undefined>(undefined);

  // Load the conversation, then check for new messages every 5 seconds.
  useEffect(() => {
    let stopped = false;
    lastAt.current = undefined;
    setMessages([]);
    const load = async () => {
      try {
        const fresh = await teamApi.messages(channel, lastAt.current);
        if (stopped || !fresh.length) return;
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.messageId));
          return [...prev, ...fresh.filter((m) => !seen.has(m.messageId))];
        });
        lastAt.current = fresh[fresh.length - 1]!.at;
        await teamApi.markChannelRead(channel, lastAt.current);
        void queryClient.invalidateQueries({ queryKey: ['team', 'unread'] });
        void queryClient.invalidateQueries({ queryKey: ['team', 'channels'] });
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : 'Could not load messages.');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [channel, queryClient]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  const sendNow = async () => {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const m = await teamApi.sendMessage(channel, text);
      // Show it now; the next check picks up anything others sent just before (duplicates are skipped).
      setMessages((prev) => (prev.some((x) => x.messageId === m.messageId) ? prev : [...prev, m]));
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  };

  const list: Channel[] = useMemo(() => channels.data ?? [{ channel: 'everyone', label: '# everyone', unread: 0 }], [channels.data]);
  const current = list.find((c) => c.channel === channel);

  return (
    <div className="grid min-h-[460px] grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white md:grid-cols-[220px_1fr]">
      <nav aria-label="Conversations" className="border-b border-gray-200 md:border-b-0 md:border-r">
        <ul>
          {list.map((c) => (
            <li key={c.channel}>
              <button
                type="button"
                onClick={() => setChannel(c.channel)}
                aria-current={c.channel === channel ? 'true' : undefined}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm ${c.channel === channel ? 'bg-blue-50 font-semibold text-blue-800' : 'text-gray-800 hover:bg-gray-50'}`}
              >
                <span className="truncate">{c.label}</span>
                {c.unread > 0 && c.channel !== channel && <span className="rounded-full bg-red-500 px-1.5 text-[10px] text-white">{c.unread}<span className="sr-only"> unread</span></span>}
              </button>
            </li>
          ))}
        </ul>
        {list.length === 1 && <p className="px-3 py-2 text-xs text-gray-500">Direct messages appear here for each staff member.</p>}
      </nav>
      <div className="flex min-h-0 flex-col">
        <div className="border-b border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900">{current?.label ?? channel}</div>
        <div className="min-h-[300px] flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-3" role="log" aria-live="polite" aria-label="Messages">
          {messages.length === 0 && <p className="text-sm text-gray-500">No messages yet. Say hello.</p>}
          {messages.map((m) => (
            <div key={m.messageId} className={m.mine ? 'text-right' : ''}>
              <p className="text-[11px] text-gray-500">{m.mine ? 'You' : m.fromEmail} · {when(m.at)}</p>
              <p className={`mt-0.5 inline-block max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm ${m.mine ? 'bg-blue-600 text-white' : 'bg-white text-gray-900 shadow-sm'}`}>{m.text}</p>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {error && <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}
        <form
          className="flex items-end gap-2 border-t border-gray-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void sendNow();
          }}
        >
          <label htmlFor="team-composer" className="sr-only">Message</label>
          <textarea
            id="team-composer"
            className="max-h-32 min-h-[44px] w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            rows={2}
            maxLength={2000}
            value={draft}
            placeholder="Write a message (Enter to send, Shift+Enter for a new line)"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void sendNow();
              }
            }}
          />
          <button type="submit" className={btnPrimary} disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
        </form>
      </div>
    </div>
  );
}
