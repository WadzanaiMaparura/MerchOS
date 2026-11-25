'use client';

/**
 * One live chat connection for the whole admin dashboard (staff who can use
 * the Support inbox). It opens when they sign in and stays open on every page,
 * so an agent who switched Online stays visible to visitors while any admin tab
 * is open, not only while the Support page is.
 *
 *   SupportConnectionProvider  the socket + heartbeat; pages subscribe to events
 *   useSupportConnection       { connected, subscribe, typing }
 *   NewChatToast               a new chat while on another page: chime + "Open"
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { SUPPORT_CHAT_API_URL, SUPPORT_CHAT_WS_URL, chime, openAgentSocket, type AgentEvent, type Conversation } from '../lib/support-chat';

type Listener = (e: AgentEvent) => void;

export interface SupportConnection {
  /** False when this staff member cannot use the inbox, or chat is not configured. */
  enabled: boolean;
  connected: boolean;
  /** Returns an unsubscribe function. */
  subscribe: (listener: Listener) => () => void;
  typing: (conversationId: string) => void;
}

const noop = () => undefined;
const DISABLED: SupportConnection = { enabled: false, connected: false, subscribe: () => noop, typing: noop };
const Ctx = createContext<SupportConnection>(DISABLED);

export const useSupportConnection = (): SupportConnection => useContext(Ctx);

export const supportChatConfigured = (): boolean => !!SUPPORT_CHAT_API_URL && !!SUPPORT_CHAT_WS_URL;

export function SupportConnectionProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const listeners = useRef(new Set<Listener>());
  const socket = useRef<ReturnType<typeof openAgentSocket> | null>(null);
  const [connected, setConnected] = useState(false);
  const on = enabled && supportChatConfigured();

  useEffect(() => {
    if (!on) return undefined;
    socket.current = openAgentSocket(
      (e) => {
        // Waiting-chat counts (Support badge, inbox lists) follow every change.
        if (e.type === 'conversation' || e.type === 'conversation_deleted') {
          void queryClient.invalidateQueries({ queryKey: ['support', 'list'] });
        }
        for (const l of listeners.current) l(e);
      },
      (up) => {
        setConnected(up);
        // Catch up on anything missed while disconnected.
        if (up) void queryClient.invalidateQueries({ queryKey: ['support'] });
      },
    );
    return () => {
      socket.current?.close();
      socket.current = null;
      setConnected(false);
    };
  }, [on, queryClient]);

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => void listeners.current.delete(l);
  }, []);
  const typing = useCallback((id: string) => socket.current?.typing(id), []);

  const value = useMemo<SupportConnection>(
    () => (on ? { enabled: true, connected, subscribe, typing } : DISABLED),
    [on, connected, subscribe, typing],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** A new waiting chat while the agent is on another admin page. */
export function NewChatToast() {
  const conn = useSupportConnection();
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [incoming, setIncoming] = useState<Conversation | null>(null);
  const seen = useRef(new Set<string>());
  const onSupport = pathname.startsWith('/support');

  useEffect(
    () =>
      conn.subscribe((e) => {
        if (e.type !== 'conversation' || e.conversation.status !== 'WAITING') return;
        if (seen.current.has(e.conversation.conversationId)) return;
        seen.current.add(e.conversation.conversationId);
        // The Support page shows its own banner and chime.
        if (window.location.pathname.startsWith('/support')) return;
        setIncoming(e.conversation);
        chime();
      }),
    [conn],
  );

  if (!incoming || onSupport) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 w-[min(92vw,360px)] rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg"
    >
      <p>
        <strong>New chat</strong> from {incoming.name ?? 'a visitor'}
        {incoming.lastMessage ? `: ${incoming.lastMessage}` : ''}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          onClick={() => {
            router.push(`/support?c=${encodeURIComponent(incoming.conversationId)}`);
            setIncoming(null);
          }}
        >
          Open
        </button>
        <button
          type="button"
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => setIncoming(null)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
