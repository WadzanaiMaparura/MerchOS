/**
 * Support inbox client: the /support/* API (Cognito access token) and the
 * agent WebSocket (live chats, typing, presence heartbeat).
 */

import { fetchAuthSession } from 'aws-amplify/auth';

export const SUPPORT_CHAT_API_URL = (process.env.NEXT_PUBLIC_SUPPORT_CHAT_API_URL ?? '').replace(/\/$/, '');
export const SUPPORT_CHAT_WS_URL = process.env.NEXT_PUBLIC_SUPPORT_CHAT_WS_URL ?? '';

export type ConversationStatus = 'WAITING' | 'ACTIVE' | 'MISSED' | 'RESOLVED';

export interface Conversation {
  conversationId: string;
  status: ConversationStatus;
  source: 'chat' | 'form';
  createdAt: string;
  updatedAt: string;
  name?: string;
  email?: string;
  page?: string;
  agentName?: string;
  acceptedAt?: string;
  resolvedAt?: string;
  detailsLeftAt?: string;
  lastMessage?: string;
  lastMessageFrom?: 'visitor' | 'agent' | 'system';
  messageCount: number;
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  from: 'visitor' | 'agent' | 'system';
  text: string;
  createdAt: string;
  agentName?: string;
}

export interface PresenceState {
  me: { agentId: string; online: boolean; lastSeenAt: number };
  online: boolean;
  withinHours: boolean;
  agentName: string;
  hoursLabel: string;
}

export interface SupportSettings {
  holidays: string[];
  hoursLabel: string;
  agentName: string;
  vapidPublicKey: string | null;
}

export type AgentEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'typing'; conversationId: string; from: 'visitor' | 'agent' }
  | { type: 'conversation'; conversation: Conversation }
  | { type: 'conversation_deleted'; conversationId: string }
  | { type: 'visitor_status'; conversationId: string; connected: boolean };

export class SupportApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function accessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) throw new SupportApiError('Your session has expired. Please sign in again.', 401);
  return token;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SUPPORT_CHAT_API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await accessToken()}`,
      ...init.headers,
    },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new SupportApiError(body.error?.message ?? `Request failed (${res.status})`, res.status);
  return body;
}

const conv = (id: string) => `/support/conversations/${encodeURIComponent(id)}`;

export const supportApi = {
  list: (status: ConversationStatus) =>
    call<{ conversations: Conversation[] }>(`/support/conversations?status=${status}`).then((r) => r.conversations),
  get: (id: string) => call<{ conversation: Conversation; messages: ChatMessage[] }>(conv(id)),
  accept: (id: string) => call<{ conversation: Conversation }>(`${conv(id)}/accept`, { method: 'POST' }),
  send: (id: string, text: string) =>
    call<{ message: ChatMessage }>(`${conv(id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  resolve: (id: string) => call<{ conversation: Conversation }>(`${conv(id)}/resolve`, { method: 'POST' }),
  remove: (id: string) => call<{ deleted: true }>(conv(id), { method: 'DELETE' }),
  presence: () => call<PresenceState>('/support/presence'),
  setOnline: (online: boolean) =>
    call<PresenceState>('/support/presence', { method: 'PUT', body: JSON.stringify({ online }) }),
  settings: () => call<SupportSettings>('/support/settings'),
  saveHolidays: (holidays: string[]) =>
    call<SupportSettings>('/support/settings', { method: 'PUT', body: JSON.stringify({ holidays }) }),
  subscribePush: (sub: PushSubscriptionJSON) =>
    call<{ ok: true }>('/support/push-subscriptions', { method: 'POST', body: JSON.stringify(sub) }),
  unsubscribePush: (endpoint: string) =>
    call<{ ok: true }>('/support/push-subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
};

/** Short two-tone chime for a new waiting chat (no audio file needed). */
export function chime(): void {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.3);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch {
    // Browsers block audio until the page has been interacted with.
  }
}

/** Heartbeat interval: presence counts an inbox as open for 3 minutes. */
export const HEARTBEAT_MS = 60_000;

/**
 * Keeps the agent socket open (fresh token on each reconnect) and sends a
 * heartbeat every minute so visitors only see "online" while this inbox is
 * actually open.
 */
export function openAgentSocket(
  onEvent: (e: AgentEvent) => void,
  onStatus: (connected: boolean) => void,
): { close: () => void; typing: (conversationId: string) => void } {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = async () => {
    if (closed) return;
    let token: string;
    try {
      token = await accessToken();
    } catch {
      // Keep trying (e.g. the session was refreshing): giving up here left the
      // inbox offline until the page was reloaded.
      onStatus(false);
      attempt += 1;
      retry = setTimeout(() => void connect(), Math.min(30_000, 1000 * 2 ** attempt));
      return;
    }
    const ws = new WebSocket(`${SUPPORT_CHAT_WS_URL}?role=agent&token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      onStatus(true);
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('{"action":"heartbeat"}');
      }, HEARTBEAT_MS);
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as AgentEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      clearInterval(heartbeat);
      onStatus(false);
      if (closed) return;
      attempt += 1;
      retry = setTimeout(() => void connect(), Math.min(30_000, 1000 * 2 ** attempt));
    };
  };
  void connect();

  let lastTyping = 0;
  return {
    close: () => {
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(retry);
      socket?.close();
    },
    typing: (conversationId: string) => {
      const now = Date.now();
      if (now - lastTyping < 3000 || socket?.readyState !== WebSocket.OPEN) return;
      lastTyping = now;
      socket.send(JSON.stringify({ action: 'typing', conversationId }));
    },
  };
}

// ─── Web Push ────────────────────────────────────────────────────────────────

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Ask permission, subscribe this browser and register it with the API. */
export async function enablePushAlerts(vapidPublicKey: string): Promise<'enabled' | 'denied'> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const sub =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));
  await supportApi.subscribePush(sub.toJSON());
  return 'enabled';
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/sw.js');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function disablePushAlerts(): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await supportApi.unsubscribePush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
