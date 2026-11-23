/** Library and Team clients (Admin API). Support reads; Admin also writes. */

import { fetchAuthSession } from 'aws-amplify/auth';
import { ADMIN_API_URL, AdminApiError } from './customers';

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await fetchAuthSession()).tokens?.accessToken?.toString();
  if (!token) throw new AdminApiError('Your session has expired. Please sign in again.', 401);
  const res = await fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T;
  if (!res.ok) {
    // Our own refusals ("Only the goal owner…") explain themselves; role checks do not.
    const message =
      res.status === 403 && body.error?.code !== 'FORBIDDEN'
        ? 'Your role cannot do this.'
        : (body.error?.message ?? `Request failed (${res.status})`);
    throw new AdminApiError(message, res.status);
  }
  return body;
}
const send = <T>(path: string, method: string, body?: unknown) =>
  call<T>(path, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const enc = encodeURIComponent;

// ─── Library ────────────────────────────────────────────────────────────────

export interface Article {
  articleId: string;
  title: string;
  category: string;
  body: string;
  pinned: boolean;
  updatedAt: string;
  updatedByEmail: string;
}
export interface Category {
  id: string;
  label: string;
  count: number;
}
export interface ArticleInput {
  title: string;
  category: string;
  body: string;
  pinned: boolean;
}

export const libraryApi = {
  list: (q: string, category: string) =>
    call<{ articles: Article[]; categories: Category[]; total: number }>(
      `/admin/library?${new URLSearchParams({ ...(q ? { q } : {}), ...(category ? { category } : {}) })}`,
    ),
  get: async (id: string) => (await call<{ article: Article }>(`/admin/library/${enc(id)}`)).article,
  create: (a: ArticleInput) => send<{ article: Article }>('/admin/library', 'POST', a),
  update: (id: string, a: ArticleInput) => send<{ article: Article }>(`/admin/library/${enc(id)}`, 'PUT', a),
  remove: (id: string) => send(`/admin/library/${enc(id)}`, 'DELETE'),
};

// ─── Team ───────────────────────────────────────────────────────────────────

export interface Announcement {
  announcementId: string;
  title: string;
  body: string;
  createdAt: string;
  createdByEmail: string;
  read: boolean;
  readBy: number;
  audience: number;
}

export interface Goal {
  goalId: string;
  title: string;
  month: string;
  target: number;
  kind: 'auto' | 'manual';
  metric?: string;
  metricLabel?: string;
  progress: number;
  status?: string;
  ownerId?: string;
  ownerEmail?: string;
  updatedAt: string;
  updatedByEmail?: string;
  canUpdate: boolean;
}

export interface GoalInput {
  title: string;
  month: string;
  target: number;
  kind: 'auto' | 'manual';
  metric?: string;
  ownerId?: string;
}

export interface Channel {
  channel: string;
  label: string;
  withUserId?: string;
  unread: number;
}

export interface TeamMessage {
  messageId: string;
  channel: string;
  from: string;
  fromEmail: string;
  text: string;
  at: string;
  mine: boolean;
}

export const teamApi = {
  unread: () => call<{ announcements: number; chat: number; total: number }>('/admin/team/unread'),
  announcements: async () => (await call<{ announcements: Announcement[] }>('/admin/team/announcements')).announcements,
  markRead: (id: string) => send(`/admin/team/announcements/${enc(id)}/read`, 'POST'),
  post: (title: string, body: string) => send('/admin/team/announcements', 'POST', { title, body }),
  removeAnnouncement: (id: string) => send(`/admin/team/announcements/${enc(id)}`, 'DELETE'),
  goals: (month: string) =>
    call<{ month: string; goals: Goal[]; metrics: Array<{ id: string; label: string }>; staff: Array<{ id: string; email: string; role: string }> }>(
      `/admin/team/goals?month=${enc(month)}`,
    ),
  createGoal: (g: GoalInput) => send('/admin/team/goals', 'POST', g),
  removeGoal: (id: string) => send(`/admin/team/goals/${enc(id)}`, 'DELETE'),
  updateProgress: (id: string, current: number, status: string) =>
    send(`/admin/team/goals/${enc(id)}/progress`, 'PUT', { current, ...(status ? { status } : {}) }),
  channels: async () => (await call<{ channels: Channel[] }>('/admin/team/chat')).channels,
  messages: async (channel: string, after?: string) =>
    (await call<{ messages: TeamMessage[] }>(`/admin/team/chat/${enc(channel)}/messages${after ? `?after=${enc(after)}` : ''}`)).messages,
  sendMessage: async (channel: string, text: string) =>
    (await send<{ message: TeamMessage }>(`/admin/team/chat/${enc(channel)}/messages`, 'POST', { text })).message,
  markChannelRead: (channel: string, at: string) => send(`/admin/team/chat/${enc(channel)}/read`, 'POST', { at }),
};
