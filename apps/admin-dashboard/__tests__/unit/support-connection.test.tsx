import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const nav = vi.hoisted(() => ({ pathname: '/customers', push: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));

const sock = vi.hoisted(() => ({
  opened: 0,
  closed: 0,
  onEvent: null as null | ((e: unknown) => void),
  onStatus: null as null | ((up: boolean) => void),
  typing: vi.fn(),
}));
vi.mock('../../lib/support-chat', () => ({
  SUPPORT_CHAT_API_URL: 'https://chat-api.example',
  SUPPORT_CHAT_WS_URL: 'wss://chat-ws.example',
  chime: vi.fn(),
  openAgentSocket: (onEvent: (e: unknown) => void, onStatus: (up: boolean) => void) => {
    sock.opened += 1;
    sock.onEvent = onEvent;
    sock.onStatus = onStatus;
    return { close: () => (sock.closed += 1), typing: sock.typing };
  },
}));

import { NewChatToast, SupportConnectionProvider, useSupportConnection } from '../../components/SupportConnection';
import { chime } from '../../lib/support-chat';

function Probe() {
  const c = useSupportConnection();
  return <p>{c.enabled ? (c.connected ? 'connected' : 'connecting') : 'off'}</p>;
}

const wrap = (enabled: boolean, ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SupportConnectionProvider enabled={enabled}>{ui}</SupportConnectionProvider>
    </QueryClientProvider>,
  );

const waiting = (id: string) => ({
  type: 'conversation',
  conversation: { conversationId: id, status: 'WAITING', name: 'Lebo', lastMessage: 'Hi there', source: 'chat', createdAt: '', updatedAt: '', messageCount: 1 },
});

beforeEach(() => {
  sock.opened = 0;
  sock.closed = 0;
  nav.pathname = '/customers';
  vi.clearAllMocks();
  window.history.pushState({}, '', '/customers');
});

describe('dashboard-wide support connection', () => {
  it('opens one connection for inbox staff, whatever page they are on, and reports it', () => {
    wrap(true, <Probe />);
    expect(sock.opened).toBe(1);
    expect(screen.getByText('connecting')).toBeTruthy();
    act(() => sock.onStatus!(true));
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('does not connect for staff who cannot use the inbox', () => {
    wrap(false, <Probe />);
    expect(sock.opened).toBe(0);
    expect(screen.getByText('off')).toBeTruthy();
  });

  it('a new chat on another page chimes and offers to open it (once per chat)', async () => {
    const user = userEvent.setup();
    wrap(true, <NewChatToast />);
    act(() => sock.onEvent!(waiting('c1')));
    act(() => sock.onEvent!(waiting('c1')));
    expect(chime).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert').textContent).toContain('New chat from Lebo: Hi there');
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(nav.push).toHaveBeenCalledWith('/support?c=c1');
  });

  it('stays quiet on the Support page (it has its own banner)', () => {
    nav.pathname = '/support';
    window.history.pushState({}, '', '/support');
    wrap(true, <NewChatToast />);
    act(() => sock.onEvent!(waiting('c2')));
    expect(chime).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
