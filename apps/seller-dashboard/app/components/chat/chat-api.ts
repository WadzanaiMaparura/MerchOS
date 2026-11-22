/**
 * Visitor side of MerchOS live chat: HTTPS calls to the chat API plus a
 * reconnecting WebSocket for live events. No account needed; a chat is
 * identified by the signed token returned when it starts.
 */

export const CHAT_API_URL = (process.env.NEXT_PUBLIC_SUPPORT_CHAT_API_URL ?? '').replace(/\/$/, '');
export const CHAT_WS_URL = process.env.NEXT_PUBLIC_SUPPORT_CHAT_WS_URL ?? '';

export type ConversationStatus = 'WAITING' | 'ACTIVE' | 'MISSED' | 'RESOLVED';

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  from: 'visitor' | 'agent' | 'system';
  text: string;
  createdAt: string;
  agentName?: string;
}

export interface ChatAvailability {
  online: boolean;
  withinHours: boolean;
  agentName: string;
  hoursLabel: string;
}

export interface StoredSession {
  conversationId: string;
  token: string;
  /** The visitor already left contact details for this chat. */
  detailsSent?: boolean;
}

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; conversationId: string; from: 'visitor' | 'agent' }
  | { type: 'accepted'; conversationId: string; agentName: string }
  | { type: 'resolved'; conversationId: string }
  | { type: 'still_finding'; conversationId: string }
  | { type: 'no_one_free'; conversationId: string }
  | { type: 'conversation_deleted'; conversationId: string };

export class ChatApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${CHAT_API_URL}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    throw new ChatApiError(body.error?.message ?? 'Something went wrong. Please try again.', res.status);
  }
  return body;
}

export const chatApi = {
  status: () => call<ChatAvailability>('/chat/status'),

  start: (input: { message: string; name?: string; email?: string; page?: string; website?: string }) =>
    call<
      | ({ status: 'OFFLINE' } & Partial<ChatAvailability>)
      | {
          conversationId: string;
          status: ConversationStatus;
          token: string;
          agentName: string;
          messages: ChatMessage[];
        }
    >('/chat/conversations', { method: 'POST', body: JSON.stringify(input) }),

  get: (s: StoredSession) =>
    call<{ conversationId: string; status: ConversationStatus; agentName?: string; messages: ChatMessage[] }>(
      `/chat/conversations/${encodeURIComponent(s.conversationId)}`,
      { token: s.token },
    ),

  send: (s: StoredSession, text: string) =>
    call<{ message: ChatMessage }>(`/chat/conversations/${encodeURIComponent(s.conversationId)}/messages`, {
      method: 'POST',
      token: s.token,
      body: JSON.stringify({ text }),
    }),

  leaveDetails: (
    input: { name: string; email: string; message: string; page?: string; website?: string },
    session?: StoredSession | null,
  ) =>
    call<{ ok: true }>('/chat/details', {
      method: 'POST',
      body: JSON.stringify(input),
      ...(session ? { token: session.token } : {}),
    }),
};

// ─── Session persistence ─────────────────────────────────────────────────────

const SESSION_KEY = 'merchos-chat-session';

export function loadSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredSession) : null;
    return parsed?.conversationId && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession | null): void {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode / storage disabled: the chat still works for this page view.
  }
}

// ─── Preview gate ────────────────────────────────────────────────────────────

const PREVIEW_KEY = 'merchos-chat-preview';

/**
 * The widget shows when configured AND either switched on for everyone
 * (NEXT_PUBLIC_SUPPORT_CHAT_ENABLED=true) or previewed on this browser by
 * visiting any page with ?chat=preview (undo with ?chat=off).
 */
export function chatVisible(search: string): boolean {
  if (!CHAT_API_URL || !CHAT_WS_URL) return false;
  try {
    const flag = new URLSearchParams(search).get('chat');
    if (flag === 'preview') window.localStorage.setItem(PREVIEW_KEY, '1');
    if (flag === 'off') window.localStorage.removeItem(PREVIEW_KEY);
    if (process.env.NEXT_PUBLIC_SUPPORT_CHAT_ENABLED === 'true') return true;
    return window.localStorage.getItem(PREVIEW_KEY) === '1';
  } catch {
    return process.env.NEXT_PUBLIC_SUPPORT_CHAT_ENABLED === 'true';
  }
}

// ─── Live socket ─────────────────────────────────────────────────────────────

/**
 * Opens and keeps open the visitor socket for one chat, reconnecting with
 * backoff. Returns a function that closes it for good.
 */
export function openChatSocket(
  session: StoredSession,
  onEvent: (e: ChatEvent) => void,
  onRejected: () => void,
): { close: () => void; typing: () => void } {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let keepAlive: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    const url = `${CHAT_WS_URL}?role=visitor&token=${encodeURIComponent(session.token)}`;
    const ws = new WebSocket(url);
    socket = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      attempt = 0;
      // API Gateway drops idle sockets after 10 minutes.
      keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('{"action":"heartbeat"}'), 5 * 60_000);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as ChatEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      clearInterval(keepAlive);
      if (closed) return;
      // Refused on connect three times running: the token is no longer valid.
      if (!opened && attempt >= 3) {
        onRejected();
        return;
      }
      attempt += 1;
      retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
    };
  };
  connect();

  let lastTyping = 0;
  return {
    close: () => {
      closed = true;
      clearInterval(keepAlive);
      clearTimeout(retry);
      socket?.close();
    },
    typing: () => {
      const now = Date.now();
      if (now - lastTyping < 3000 || socket?.readyState !== WebSocket.OPEN) return;
      lastTyping = now;
      socket.send('{"action":"typing"}');
    },
  };
}
