'use client';

/**
 * MerchOS live chat bubble, on every website and seller dashboard page.
 *
 * Flow:
 *  - Online (Mon–Fri 9–4 SAST, not a public holiday, Imani switched on):
 *    the visitor types a question and starts a chat.
 *      0s    "Connecting you to Imani…"
 *      60s   "Still finding someone…"
 *      2min  the "leave your details" form opens, carrying the typed text over
 *    "Can't wait? Leave your details" is available the whole time.
 *  - Offline: the details form shows straight away; we reply by email.
 *
 * Messages render as plain text only. The chat survives page navigation and
 * reloads (token in localStorage for 24h).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@merch-os/auth';
import {
  ChatApiError,
  chatApi,
  chatVisible,
  loadSession,
  openChatSocket,
  saveSession,
  type ChatAvailability,
  type ChatEvent,
  type ChatMessage,
  type ConversationStatus,
  type StoredSession,
} from './chat-api';

type View = 'start' | 'chat' | 'details' | 'sent';

const STILL_FINDING_MS = 60_000;
const GIVE_UP_MS = 120_000;
const MAX_LENGTH = 2000;

// ─── Icons ───────────────────────────────────────────────────────────────────

const ChatBubbleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

// ─── Small pieces ────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/30';
const primaryButton =
  'inline-flex w-full items-center justify-center rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-primary-300';
const linkButton =
  'text-sm font-medium text-primary-700 underline underline-offset-2 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded';

/** Invisible field real people never fill (bots do). */
function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
      <label>
        Website
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function MessageList({
  messages,
  agentTyping,
  agentName,
}: {
  messages: ChatMessage[];
  agentTyping: boolean;
  agentName: string;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length, agentTyping]);

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite" aria-label="Chat messages">
      {messages.map((m) =>
        m.from === 'system' ? (
          <p key={m.messageId} className="text-center text-xs text-gray-500">
            {m.text}
          </p>
        ) : (
          <div key={m.messageId} className={m.from === 'visitor' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={[
                'max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                m.from === 'visitor' ? 'rounded-br-sm bg-primary-600 text-white' : 'rounded-bl-sm bg-gray-100 text-gray-900',
              ].join(' ')}
            >
              <span className="sr-only">{m.from === 'visitor' ? 'You' : m.agentName ?? agentName}: </span>
              {m.text}
              <span className={['mt-1 block text-[11px]', m.from === 'visitor' ? 'text-primary-100' : 'text-gray-500'].join(' ')}>
                {formatTime(m.createdAt)}
              </span>
            </div>
          </div>
        ),
      )}
      {agentTyping && (
        <p className="text-xs italic text-gray-500" aria-live="polite">
          {agentName} is typing…
        </p>
      )}
      <div ref={endRef} />
    </div>
  );
}

// ─── Widget ──────────────────────────────────────────────────────────────────

export function ChatWidget() {
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(chatVisible(window.location.search)), []);
  if (!visible) return null;
  return <ChatWidgetInner />;
}

function ChatWidgetInner() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [availability, setAvailability] = useState<ChatAvailability | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [status, setStatus] = useState<ConversationStatus | null>(null);
  const [agentName, setAgentName] = useState('Imani');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [view, setView] = useState<View>('start');
  const [stillFinding, setStillFinding] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<{ name: string; email: string } | null>(null);

  // Form fields
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [draft, setDraft] = useState('');
  const [honeypot, setHoneypot] = useState('');

  const socketRef = useRef<ReturnType<typeof openChatSocket> | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const panelRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLButtonElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  // Signed-in sellers don't need to type their email.
  useEffect(() => {
    if (user?.email) setEmail((e) => e || user.email);
  }, [user?.email]);

  const resetChat = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    saveSession(null);
    setSession(null);
    setStatus(null);
    setMessages([]);
    setStillFinding(false);
    setAgentTyping(false);
    setView('start');
  }, []);

  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => (prev.some((p) => p.messageId === m.messageId) ? prev : [...prev, m]));
    if (m.from === 'agent' && !openRef.current) setUnread((n) => n + 1);
  }, []);

  /** Text to carry into the details form: whatever they were typing, or their question. */
  const carryOverText = useCallback(
    () => draft.trim() || [...messages].reverse().find((m) => m.from === 'visitor')?.text || message,
    [draft, messages, message],
  );

  const goToDetails = useCallback(() => {
    setMessage((current) => carryOverText() || current);
    setError(null);
    setView('details');
  }, [carryOverText]);

  const onEvent = useCallback(
    (e: ChatEvent) => {
      switch (e.type) {
        case 'message':
          addMessage(e.message);
          if (e.message.from === 'agent') setAgentTyping(false);
          break;
        case 'typing':
          if (e.from === 'agent') {
            setAgentTyping(true);
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setAgentTyping(false), 4000);
          }
          break;
        case 'accepted':
          setStatus('ACTIVE');
          setAgentName(e.agentName);
          setView('chat');
          if (!openRef.current) setUnread((n) => n + 1);
          break;
        case 'resolved':
          setStatus('RESOLVED');
          break;
        case 'still_finding':
          setStillFinding(true);
          break;
        case 'no_one_free':
          setStatus('MISSED');
          setView((v) => (v === 'chat' ? 'details' : v));
          break;
        case 'conversation_deleted':
          resetChat();
          break;
      }
    },
    [addMessage, resetChat],
  );

  const connect = useCallback(
    (s: StoredSession) => {
      socketRef.current?.close();
      socketRef.current = openChatSocket(s, onEvent, resetChat);
    },
    [onEvent, resetChat],
  );

  // Restore an open chat after navigation or reload.
  useEffect(() => {
    const stored = loadSession();
    if (!stored) return;
    chatApi
      .get(stored)
      .then((c) => {
        setSession(stored);
        setStatus(c.status);
        if (c.agentName) setAgentName(c.agentName);
        setMessages(c.messages);
        setView(stored.detailsSent && c.status !== 'ACTIVE' ? 'sent' : 'chat');
        if (c.status !== 'RESOLVED') connect(stored);
      })
      .catch(() => saveSession(null));
    return () => socketRef.current?.close();
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Who is around? Checked each time the panel opens.
  useEffect(() => {
    if (!open || session) return;
    let cancelled = false;
    chatApi
      .status()
      .then((a) => {
        if (cancelled) return;
        setAvailability(a);
        setAgentName(a.agentName);
      })
      .catch(() => !cancelled && setAvailability({ online: false, withinHours: false, agentName, hoursLabel: '' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  // Waiting timeline, measured from when the chat started (survives reloads).
  useEffect(() => {
    if (status !== 'WAITING' || view !== 'chat') return;
    const startedAt = new Date(messages[0]?.createdAt ?? Date.now()).getTime();
    const elapsed = Date.now() - startedAt;
    if (elapsed >= GIVE_UP_MS) {
      goToDetails();
      return;
    }
    if (elapsed >= STILL_FINDING_MS) setStillFinding(true);
    const t1 = setTimeout(() => setStillFinding(true), Math.max(0, STILL_FINDING_MS - elapsed));
    const t2 = setTimeout(goToDetails, GIVE_UP_MS - elapsed);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [status, view, messages, goToDetails]);

  // Opening clears the unread badge and moves focus into the panel.
  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const t = setTimeout(() => panelRef.current?.querySelector<HTMLElement>('textarea, input:not([tabindex="-1"]), button')?.focus(), 50);
    return () => clearTimeout(t);
  }, [open, view]);

  const close = useCallback(() => {
    setOpen(false);
    bubbleRef.current?.focus();
  }, []);

  const page = () => window.location.pathname;

  // ─── Actions ───────────────────────────────────────────────────────────────

  const startChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await chatApi.start({
        message: message.trim(),
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        page: page(),
        website: honeypot || undefined,
      });
      if (res.status === 'OFFLINE' || !('token' in res)) {
        // Someone went offline between opening and sending: keep their text.
        setAvailability((a) => (a ? { ...a, online: false } : a));
        setView('details');
        return;
      }
      const s: StoredSession = { conversationId: res.conversationId, token: res.token };
      saveSession(s);
      setSession(s);
      setStatus(res.status);
      setAgentName(res.agentName);
      setMessages(res.messages);
      setStillFinding(false);
      setDraft('');
      setView('chat');
      connect(s);
    } catch (err) {
      setError(err instanceof ChatApiError ? err.message : 'Could not start the chat. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !session) return;
    setBusy(true);
    setError(null);
    try {
      const { message: sent } = await chatApi.send(session, text);
      addMessage(sent);
      setDraft('');
    } catch (err) {
      if (err instanceof ChatApiError && err.status === 409) setStatus('RESOLVED');
      if (err instanceof ChatApiError && (err.status === 401 || err.status === 404)) resetChat();
      setError(err instanceof ChatApiError ? err.message : 'Message not sent. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const leaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await chatApi.leaveDetails(
        { name: name.trim(), email: email.trim(), message: message.trim(), page: page(), website: honeypot || undefined },
        session,
      );
      setSentTo({ name: name.trim(), email: email.trim() });
      if (session) {
        const s = { ...session, detailsSent: true };
        saveSession(s);
        setSession(s);
      }
      setDraft('');
      setView('sent');
    } catch (err) {
      setError(err instanceof ChatApiError ? err.message : 'Could not send your details. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ─── Header text ───────────────────────────────────────────────────────────

  const header = useMemo(() => {
    if (view === 'chat' && status === 'ACTIVE') return { title: `You're chatting with ${agentName}`, dot: 'bg-success-500', sub: 'MerchOS support' };
    if (view === 'chat' && status === 'WAITING')
      return { title: 'MerchOS support', dot: 'bg-warning-500', sub: stillFinding ? 'Still finding someone…' : `Connecting you to ${agentName}…` };
    if (view === 'chat' && status === 'RESOLVED') return { title: 'MerchOS support', dot: 'bg-gray-400', sub: 'Chat ended' };
    if (availability?.online && view === 'start') return { title: 'MerchOS support', dot: 'bg-success-500', sub: `${agentName} is online` };
    return { title: 'MerchOS support', dot: 'bg-gray-400', sub: 'We reply by email' };
  }, [view, status, agentName, stillFinding, availability]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const showOfflineForm = view === 'start' && availability && !availability.online;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-label="Chat with MerchOS support"
          onKeyDown={(e) => e.key === 'Escape' && close()}
          className="flex h-[540px] max-h-[calc(100vh-6rem)] w-[360px] max-w-[calc(100vw-2rem)] animate-fadeIn flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between bg-primary-600 px-4 py-3 text-white">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{header.title}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-primary-100">
                <span className={`inline-block h-2 w-2 rounded-full ${header.dot}`} aria-hidden="true" />
                <span aria-live="polite">{header.sub}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded p-1 text-primary-100 hover:bg-primary-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              aria-label="Close chat"
            >
              <CloseIcon />
            </button>
          </div>

          {error && (
            <p role="alert" className="border-b border-danger-500/20 bg-danger-50 px-4 py-2 text-xs text-danger-700">
              {error}
            </p>
          )}

          {/* Body */}
          {view === 'start' && !availability && (
            <p className="flex flex-1 items-center justify-center text-sm text-gray-500">Loading…</p>
          )}

          {view === 'start' && availability?.online && (
            <form onSubmit={startChat} className="relative flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <p className="text-sm text-gray-700">
                Hi! Ask us anything about MerchOS. {agentName} usually replies within a couple of minutes.
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Your question</span>
                <textarea
                  className={`${inputClass} min-h-[96px] resize-none`}
                  value={message}
                  maxLength={MAX_LENGTH}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-700">Name (optional)</span>
                  <input className={inputClass} value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-gray-700">Email (optional)</span>
                  <input className={inputClass} type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
                </label>
              </div>
              <Honeypot value={honeypot} onChange={setHoneypot} />
              <button type="submit" className={primaryButton} disabled={busy || !message.trim()}>
                {busy ? 'Starting…' : 'Start chat'}
              </button>
              <button type="button" className={`${linkButton} self-center`} onClick={goToDetails}>
                Can&apos;t wait? Leave your details
              </button>
            </form>
          )}

          {view === 'chat' && (
            <>
              <MessageList messages={messages} agentTyping={agentTyping} agentName={agentName} />
              {status === 'WAITING' && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-2 text-center">
                  <p className="text-xs text-gray-600">
                    {stillFinding ? 'Still finding someone…' : `Connecting you to ${agentName}…`}
                  </p>
                  <button type="button" className={`${linkButton} text-xs`} onClick={goToDetails}>
                    Can&apos;t wait? Leave your details
                  </button>
                </div>
              )}
              {status === 'RESOLVED' ? (
                <div className="border-t border-gray-200 p-3 text-center">
                  <p className="mb-2 text-xs text-gray-600">This chat has ended. Thanks for chatting with us.</p>
                  <button type="button" className={primaryButton} onClick={resetChat}>
                    Start a new chat
                  </button>
                </div>
              ) : (
                <form onSubmit={sendMessage} className="flex items-end gap-2 border-t border-gray-200 p-3">
                  <label className="sr-only" htmlFor="merchos-chat-composer">
                    Type your message
                  </label>
                  <textarea
                    id="merchos-chat-composer"
                    className={`${inputClass} max-h-28 min-h-[40px] resize-none`}
                    rows={1}
                    value={draft}
                    maxLength={MAX_LENGTH}
                    placeholder="Type your message…"
                    onChange={(e) => {
                      setDraft(e.target.value);
                      socketRef.current?.typing();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-md bg-primary-600 p-2 text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:bg-primary-300"
                    disabled={busy || !draft.trim()}
                    aria-label="Send message"
                  >
                    <SendIcon />
                  </button>
                </form>
              )}
            </>
          )}

          {(view === 'details' || showOfflineForm) && (
            <form onSubmit={leaveDetails} className="relative flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {showOfflineForm ? "We're offline right now" : 'Leave your details'}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {showOfflineForm
                    ? `We're online ${availability?.hoursLabel || 'Mon–Fri, 9am–4pm (SAST)'}. Leave a message and we'll email you back.`
                    : "No problem. Leave your details and we'll email you back, usually the same working day."}
                </p>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Name</span>
                <input className={inputClass} value={name} maxLength={80} autoComplete="name" required onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Email</span>
                <input className={inputClass} type="email" value={email} autoComplete="email" required onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Message</span>
                <textarea
                  className={`${inputClass} min-h-[96px] resize-none`}
                  value={message}
                  maxLength={MAX_LENGTH}
                  required
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <Honeypot value={honeypot} onChange={setHoneypot} />
              <button
                type="submit"
                className={primaryButton}
                disabled={busy || !name.trim() || !email.trim() || !message.trim()}
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
              {view === 'details' && status === 'WAITING' && (
                <button type="button" className={`${linkButton} self-center`} onClick={() => setView('chat')}>
                  Back to the chat
                </button>
              )}
            </form>
          )}

          {view === 'sent' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm font-medium text-gray-900">Thanks{sentTo?.name ? `, ${sentTo.name}` : ''}.</p>
              <p className="text-sm text-gray-600">
                We&apos;ve got your message and will email you{sentTo?.email ? ` at ${sentTo.email}` : ''}.
              </p>
              <button
                type="button"
                className={`${linkButton} mt-2`}
                onClick={() => {
                  resetChat();
                  setMessage('');
                  setSentTo(null);
                }}
              >
                Send another message
              </button>
            </div>
          )}
        </div>
      )}

      <button
        ref={bubbleRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-300"
        aria-label={open ? 'Close chat' : unread > 0 ? `Open chat, ${unread} new message${unread === 1 ? '' : 's'}` : 'Chat with us'}
        aria-expanded={open}
      >
        {open ? <CloseIcon /> : <ChatBubbleIcon />}
        {!open && unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger-500 px-1 text-[11px] font-bold text-white" aria-hidden="true">
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}
