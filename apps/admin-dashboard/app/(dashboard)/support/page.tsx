'use client';

/**
 * Support inbox — live chats from the website and seller dashboard.
 *
 * Tabs: Waiting · Active · Missed/offline · Resolved. The Online switch (plus
 * any admin tab staying open: the connection lives in the app shell) is what
 * makes the chat bubble show "online" to visitors during Mon–Fri 9am–4pm SAST. Alerts: in-page (sound + banner +
 * tab title), browser push (Enable alerts) and email to the support mailbox.
 */

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminRouteGuard } from '../../../components/AdminRouteGuard';
import { useSupportConnection } from '../../../components/SupportConnection';
import {
  SUPPORT_CHAT_API_URL,
  SUPPORT_CHAT_WS_URL,
  SupportApiError,
  currentPushSubscription,
  disablePushAlerts,
  chime,
  enablePushAlerts,
  pushSupported,
  supportApi,
  type AgentEvent,
  type ChatMessage,
  type Conversation,
  type ConversationStatus,
} from '../../../lib/support-chat';

const TABS: Array<{ status: ConversationStatus; label: string }> = [
  { status: 'WAITING', label: 'Waiting' },
  { status: 'ACTIVE', label: 'Active' },
  { status: 'MISSED', label: 'Missed / offline' },
  { status: 'RESOLVED', label: 'Resolved' },
];

const keys = {
  list: (s: ConversationStatus) => ['support', 'list', s] as const,
  conversation: (id: string) => ['support', 'conversation', id] as const,
  presence: ['support', 'presence'] as const,
  settings: ['support', 'settings'] as const,
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });
}

const btn =
  'inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`;
const btnSecondary = `${btn} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
const btnDanger = `${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`;

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SupportPage() {
  return (
    <AdminRouteGuard requiredResource="support-inbox">
      <Suspense fallback={null}>
        {SUPPORT_CHAT_API_URL && SUPPORT_CHAT_WS_URL ? (
          <SupportInbox />
        ) : (
          <div className="p-6 text-sm text-gray-600">
            Live chat is not configured for this environment (NEXT_PUBLIC_SUPPORT_CHAT_API_URL / _WS_URL).
          </div>
        )}
      </Suspense>
    </AdminRouteGuard>
  );
}

function SupportInbox() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const selectedId = params?.get('c') ?? null;

  const [tab, setTab] = useState<ConversationStatus>('WAITING');
  // The dashboard-wide connection (stays open on every admin page).
  const connection = useSupportConnection();
  const socketUp = connection.connected;
  const [visitorOnline, setVisitorOnline] = useState<Record<string, boolean>>({});
  const [visitorTyping, setVisitorTyping] = useState<Record<string, number>>({});
  const [incoming, setIncoming] = useState<Conversation | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seenWaiting = useRef<Set<string>>(new Set());

  const presence = useQuery({ queryKey: keys.presence, queryFn: supportApi.presence, refetchInterval: 60_000 });
  const lists = useQueries({
    queries: TABS.map((t) => ({
      queryKey: keys.list(t.status),
      queryFn: () => supportApi.list(t.status),
      // The socket pushes changes; polling is only a safety net.
      refetchInterval: 30_000,
    })),
  });
  const current = lists[TABS.findIndex((t) => t.status === tab)]!;
  const waitingCount = lists[0]?.data?.length ?? 0;

  const select = useCallback(
    (id: string | null) => router.replace(id ? `/support?c=${encodeURIComponent(id)}` : '/support'),
    [router],
  );

  // Tab title shows waiting chats, so a background tab still draws attention.
  useEffect(() => {
    const base = 'Support inbox | MerchOS Admin';
    document.title = waitingCount > 0 ? `(${waitingCount}) ${base}` : base;
    return () => {
      document.title = 'MerchOS Admin';
    };
  }, [waitingCount]);

  const onEvent = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case 'conversation': {
          void queryClient.invalidateQueries({ queryKey: ['support', 'list'] });
          queryClient.setQueryData(
            keys.conversation(e.conversation.conversationId),
            (old: { conversation: Conversation; messages: ChatMessage[] } | undefined) =>
              old ? { ...old, conversation: e.conversation } : old,
          );
          if (e.conversation.status === 'WAITING' && !seenWaiting.current.has(e.conversation.conversationId)) {
            seenWaiting.current.add(e.conversation.conversationId);
            setIncoming(e.conversation);
            chime();
          }
          break;
        }
        case 'message':
          queryClient.setQueryData(
            keys.conversation(e.message.conversationId),
            (old: { conversation: Conversation; messages: ChatMessage[] } | undefined) =>
              old && !old.messages.some((m) => m.messageId === e.message.messageId)
                ? { ...old, messages: [...old.messages, e.message] }
                : old,
          );
          if (e.message.from === 'visitor') {
            setVisitorTyping((t) => ({ ...t, [e.message.conversationId]: 0 }));
          }
          break;
        case 'typing':
          if (e.from === 'visitor') {
            setVisitorTyping((t) => ({ ...t, [e.conversationId]: Date.now() }));
            // Re-render once the indicator has expired so it disappears.
            setTimeout(() => setVisitorTyping((t) => ({ ...t })), 5100);
          }
          break;
        case 'visitor_status':
          setVisitorOnline((v) => ({ ...v, [e.conversationId]: e.connected }));
          break;
        case 'conversation_deleted':
          void queryClient.invalidateQueries({ queryKey: ['support', 'list'] });
          queryClient.removeQueries({ queryKey: keys.conversation(e.conversationId) });
          break;
      }
    },
    [queryClient],
  );

  useEffect(() => connection.subscribe(onEvent), [connection, onEvent]);

  // Already-waiting chats at load time are not "new".
  useEffect(() => {
    for (const c of lists[0]?.data ?? []) seenWaiting.current.add(c.conversationId);
    // Only the first successful load matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists[0]?.isSuccess]);

  const p = presence.data;
  const setOnline = async (online: boolean) => {
    setNotice(null);
    try {
      queryClient.setQueryData(keys.presence, await supportApi.setOnline(online));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not change your status.');
    }
  };

  const visibleToVisitors = p?.online ?? false;
  const statusLine = !p
    ? 'Checking status…'
    : !p.withinHours
      ? `Outside chat hours (${p.hoursLabel}). Visitors see the leave-details form.`
      : p.me.online && !socketUp
        ? 'Reconnecting… visitors may see you as offline.'
        : p.me.online
          ? 'Visitors can chat with you now. You stay online on every admin page while a MerchOS Admin tab is open.'
          : 'You are offline. Visitors see the leave-details form.';

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Support inbox</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-gray-600" aria-live="polite">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${visibleToVisitors ? 'bg-green-500' : 'bg-gray-400'}`}
              aria-hidden="true"
            />
            {statusLine}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OnlineSwitch online={p?.me.online ?? false} disabled={!p} onChange={setOnline} />
          <PushToggle onNotice={setNotice} />
          <button type="button" className={btnSecondary} onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
            Settings
          </button>
        </div>
      </div>

      {/* Good-morning prompt: in hours but switched off. */}
      {p && p.withinHours && !p.me.online && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span>Chat hours have started. Go online so visitors can chat with you?</span>
          <button type="button" className={btnPrimary} onClick={() => void setOnline(true)}>
            Go online
          </button>
        </div>
      )}

      {incoming && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            <strong>New chat</strong> from {incoming.name ?? 'a visitor'}: {incoming.lastMessage}
          </span>
          <span className="flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                setTab('WAITING');
                select(incoming.conversationId);
                setIncoming(null);
              }}
            >
              Open
            </button>
            <button type="button" className={btnSecondary} onClick={() => setIncoming(null)}>
              Dismiss
            </button>
          </span>
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700">
          {notice}
        </p>
      )}

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

      {/* Inbox */}
      <div className="grid min-h-[560px] flex-1 grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white lg:grid-cols-[340px_1fr]">
        <div className="flex min-h-0 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
          <div role="tablist" aria-label="Conversation status" className="flex border-b border-gray-200">
            {TABS.map((t, i) => {
              const count = lists[i]?.data?.length ?? 0;
              const active = tab === t.status;
              return (
                <button
                  key={t.status}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => setTab(t.status)}
                  className={[
                    'flex-1 border-b-2 px-2 py-2.5 text-xs font-medium',
                    active ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900',
                  ].join(' ')}
                >
                  {t.label}
                  {t.status !== 'RESOLVED' && count > 0 && (
                    <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${t.status === 'WAITING' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <ul role="tabpanel" className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto" aria-label={`${tab} conversations`}>
            {current.isLoading && <li className="p-4 text-sm text-gray-500">Loading…</li>}
            {current.isError && <li className="p-4 text-sm text-red-700">Could not load conversations.</li>}
            {current.data?.length === 0 && <li className="p-4 text-sm text-gray-500">Nothing here.</li>}
            {current.data?.map((c) => (
              <li key={c.conversationId}>
                <button
                  type="button"
                  onClick={() => select(c.conversationId)}
                  className={[
                    'w-full px-4 py-3 text-left hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none',
                    selectedId === c.conversationId ? 'bg-blue-50' : '',
                  ].join(' ')}
                  aria-current={selectedId === c.conversationId ? 'true' : undefined}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {visitorOnline[c.conversationId] && (
                        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-green-500" aria-label="Visitor is on the page" />
                      )}
                      <span className="truncate text-sm font-medium text-gray-900">{c.name ?? c.email ?? 'Visitor'}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">{timeAgo(c.updatedAt)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-gray-600">{c.lastMessage}</span>
                  <span className="mt-1 flex gap-1.5">
                    {c.detailsLeftAt && <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-purple-700">Left details</span>}
                    {c.source === 'form' && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">Offline message</span>}
                    {c.page && <span className="truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">{c.page}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selectedId ? (
          <ConversationPane
            key={selectedId}
            id={selectedId}
            visitorOnline={visitorOnline[selectedId] ?? false}
            visitorTyping={Date.now() - (visitorTyping[selectedId] ?? 0) < 5000}
            onTyping={() => connection.typing(selectedId)}
            onClosed={() => select(null)}
          />
        ) : (
          <div className="hidden items-center justify-center p-6 text-sm text-gray-500 lg:flex">Select a conversation.</div>
        )}
      </div>
    </div>
  );
}

// ─── Online switch ───────────────────────────────────────────────────────────

function OnlineSwitch({ online, disabled, onChange }: { online: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      disabled={disabled}
      onClick={() => onChange(!online)}
      className={`${btn} gap-2 border ${online ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300 bg-white text-gray-700'}`}
    >
      <span className={`relative inline-flex h-5 w-9 rounded-full transition ${online ? 'bg-green-500' : 'bg-gray-300'}`} aria-hidden="true">
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${online ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {online ? 'Online' : 'Offline'}
    </button>
  );
}

// ─── Push alerts ─────────────────────────────────────────────────────────────

function PushToggle({ onNotice }: { onNotice: (m: string | null) => void }) {
  const settings = useQuery({ queryKey: keys.settings, queryFn: supportApi.settings });
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return setEnabled(false);
    void currentPushSubscription().then((s) => setEnabled(!!s && Notification.permission === 'granted'));
  }, []);

  if (!pushSupported()) return null;
  const key = settings.data?.vapidPublicKey;

  const toggle = async () => {
    setBusy(true);
    onNotice(null);
    try {
      if (enabled) {
        await disablePushAlerts();
        setEnabled(false);
        onNotice('Alerts turned off for this browser.');
      } else if (key) {
        const result = await enablePushAlerts(key);
        setEnabled(result === 'enabled');
        onNotice(
          result === 'enabled'
            ? 'Alerts are on. You will get a notification for new chats, even with this tab in the background.'
            : 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
        );
      }
    } catch (err) {
      onNotice(err instanceof Error ? err.message : 'Could not change alerts.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={enabled ? btnSecondary : btnPrimary} onClick={() => void toggle()} disabled={busy || enabled === null || (!enabled && !key)}>
      {enabled ? 'Alerts on' : 'Enable alerts'}
    </button>
  );
}

// ─── Settings (public holidays) ──────────────────────────────────────────────

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: keys.settings, queryFn: supportApi.settings });
  const [text, setText] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = text ?? settings.data?.holidays.join('\n') ?? '';

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const holidays = value
        .split(/[\s,]+/)
        .map((d) => d.trim())
        .filter(Boolean);
      queryClient.setQueryData(keys.settings, await supportApi.saveHolidays(holidays));
      void queryClient.invalidateQueries({ queryKey: keys.presence });
      setText(null);
      setMessage('Saved.');
    } catch (err) {
      setMessage(err instanceof SupportApiError ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="support-settings-heading" className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="support-settings-heading" className="text-base font-semibold text-gray-900">
            Chat settings
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Hours: {settings.data?.hoursLabel ?? '…'}. Visitors see the agent name &ldquo;{settings.data?.agentName ?? 'Imani'}&rdquo;.
          </p>
        </div>
        <button type="button" className={btnSecondary} onClick={onClose}>
          Close
        </button>
      </div>
      <label className="mt-4 block">
        <span className="block text-sm font-medium text-gray-700">Public holidays (closed), one date per line as YYYY-MM-DD</span>
        <textarea
          className="mt-1 h-40 w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          value={value}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving || !settings.data}>
          {saving ? 'Saving…' : 'Save holidays'}
        </button>
        {message && <span role="status" className="text-sm text-gray-600">{message}</span>}
      </div>
    </section>
  );
}

// ─── Conversation ────────────────────────────────────────────────────────────

function ConversationPane({
  id,
  visitorOnline,
  visitorTyping,
  onTyping,
  onClosed,
}: {
  id: string;
  visitorOnline: boolean;
  visitorTyping: boolean;
  onTyping: () => void;
  onClosed: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: keys.conversation(id), queryFn: () => supportApi.get(id), retry: 1 });
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => query.data?.messages ?? [], [query.data]);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, visitorTyping]);

  const run = async (label: string, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: ['support'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  if (query.isLoading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  if (query.isError || !query.data) {
    return (
      <div className="p-6 text-sm text-gray-600">
        This conversation is not available (it may have been deleted).{' '}
        <button type="button" className="text-blue-700 underline" onClick={onClosed}>
          Back
        </button>
      </div>
    );
  }

  const c = query.data.conversation;
  const ended = c.status === 'RESOLVED';

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    await run('send', async () => {
      const { message } = await supportApi.send(id, text);
      queryClient.setQueryData(keys.conversation(id), (old: typeof query.data) =>
        old && !old.messages.some((m) => m.messageId === message.messageId) ? { ...old, messages: [...old.messages, message] } : old,
      );
      setDraft('');
    });
  };

  return (
    <div className="flex min-h-0 flex-col">
      {/* Conversation header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div className="min-w-0 text-sm">
          <p className="flex items-center gap-2 font-semibold text-gray-900">
            {c.name ?? 'Visitor'}
            <span className="text-xs font-normal text-gray-500">{visitorOnline ? '· on the page now' : '· not on the page'}</span>
          </p>
          <p className="truncate text-gray-600">
            {c.email ? (
              <a className="text-blue-700 underline" href={`mailto:${c.email}?subject=${encodeURIComponent('Your MerchOS question')}`}>
                {c.email}
              </a>
            ) : (
              'No email given'
            )}
            {c.page && <span className="text-gray-500"> · from {c.page}</span>}
          </p>
          <p className="text-xs text-gray-500">Started {formatTime(c.createdAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(c.status === 'WAITING' || c.status === 'MISSED') && (
            <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => void run('accept', () => supportApi.accept(id))}>
              {busy === 'accept' ? 'Accepting…' : 'Accept chat'}
            </button>
          )}
          {!ended && (
            <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => void run('resolve', () => supportApi.resolve(id))}>
              {busy === 'resolve' ? 'Ending…' : 'Resolve'}
            </button>
          )}
          {confirmDelete ? (
            <span className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
              Delete permanently?
              <button
                type="button"
                className={btnDanger}
                disabled={!!busy}
                onClick={() =>
                  void run('delete', async () => {
                    await supportApi.remove(id);
                    onClosed();
                  })
                }
              >
                {busy === 'delete' ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button type="button" className={btnSecondary} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className={btnDanger} onClick={() => setConfirmDelete(true)} title="For POPIA deletion requests">
              Delete conversation
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-gray-50 px-4 py-4" role="log" aria-live="polite" aria-label="Messages">
        {messages.map((m) =>
          m.from === 'system' ? (
            <p key={m.messageId} className="text-center text-xs text-gray-500">
              {m.text} · {formatTime(m.createdAt)}
            </p>
          ) : (
            <div key={m.messageId} className={m.from === 'agent' ? 'flex justify-end' : 'flex justify-start'}>
              <div
                className={[
                  'max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm',
                  m.from === 'agent' ? 'rounded-br-sm bg-blue-600 text-white' : 'rounded-bl-sm bg-white text-gray-900',
                ].join(' ')}
              >
                <span className="sr-only">{m.from === 'agent' ? 'You' : 'Visitor'}: </span>
                {m.text}
                <span className={`mt-1 block text-[11px] ${m.from === 'agent' ? 'text-blue-100' : 'text-gray-500'}`}>{formatTime(m.createdAt)}</span>
              </div>
            </div>
          ),
        )}
        {visitorTyping && <p className="text-xs italic text-gray-500">Visitor is typing…</p>}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      {ended ? (
        <p className="border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
          This chat has ended.{c.email ? ' To follow up, email the visitor.' : ''}
        </p>
      ) : (
        <form onSubmit={(e) => void send(e)} className="flex items-end gap-2 border-t border-gray-200 p-3">
          <label htmlFor="support-composer" className="sr-only">
            Reply
          </label>
          <textarea
            id="support-composer"
            className="max-h-32 min-h-[44px] w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            rows={2}
            maxLength={2000}
            value={draft}
            placeholder={c.status === 'ACTIVE' ? 'Type a reply… (Enter to send, Shift+Enter for a new line)' : 'Replying accepts the chat'}
            onChange={(e) => {
              setDraft(e.target.value);
              if (c.status === 'ACTIVE') onTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="submit" className={btnPrimary} disabled={!!busy || !draft.trim()}>
            {busy === 'send' ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </div>
  );
}
