import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// The data layer, alerts and timers are mocked: these tests cover the
// handler's gatekeeping (origin, honeypot, limits, offline) and wiring.
vi.mock('../lib/store', () => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  listMessages: vi.fn(async () => []),
  addMessage: vi.fn(),
  setContactDetails: vi.fn(),
  transitionConversation: vi.fn(),
  withinRateLimit: vi.fn(async () => true),
}));
vi.mock('../lib/status', () => ({ getAvailability: vi.fn() }));
vi.mock('../lib/broadcast', () => ({ toAgents: vi.fn(async () => undefined), toVisitor: vi.fn(async () => undefined) }));
vi.mock('../lib/notify', async () => {
  const actual = await vi.importActual<typeof import('../lib/notify')>('../lib/notify');
  return { ...actual, pushToAgents: vi.fn(async () => 1), emailSupport: vi.fn(async () => undefined) };
});
vi.mock('../lib/timers', () => ({ scheduleWaitingTimers: vi.fn(async () => undefined) }));
vi.mock('../lib/config', async () => {
  const actual = await vi.importActual<typeof import('../lib/config')>('../lib/config');
  return { ...actual, getChatSecret: vi.fn(async () => ({ visitorTokenSecret: 'unit-test-secret' })) };
});

import { handler } from '../handlers/public-api';
import * as store from '../lib/store';
import * as status from '../lib/status';
import * as notify from '../lib/notify';
import * as timers from '../lib/timers';
import { issueVisitorToken, verifyVisitorToken } from '../lib/visitor-token';

const ORIGIN = 'https://merchos.co.za';
const ID = '3f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const availability = (online: boolean) => ({ online, withinHours: online, agentName: 'Imani', hoursLabel: 'hours' });

function event(routeKey: string, body?: unknown, opts: { origin?: string; token?: string; id?: string } = {}) {
  const [method] = routeKey.split(' ');
  return {
    routeKey,
    headers: {
      ...(opts.origin !== undefined ? { origin: opts.origin } : { origin: ORIGIN }),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    pathParameters: opts.id ? { conversationId: opts.id } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: '198.51.100.7' } },
  } as unknown as APIGatewayProxyEventV2;
}

const conversation = {
  conversationId: ID,
  status: 'WAITING',
  source: 'chat',
  createdAt: '2026-11-23T08:00:00.000Z',
  updatedAt: '2026-11-23T08:00:00.000Z',
  messageCount: 1,
  lastMessage: 'Hello',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env['VISITOR_ORIGINS'] = `${ORIGIN},http://localhost:3000`;
  vi.mocked(store.withinRateLimit).mockResolvedValue(true);
});

describe('POST /chat/conversations', () => {
  it('starts a waiting chat when someone is online, with a token and alerts', async () => {
    vi.mocked(status.getAvailability).mockResolvedValue(availability(true));
    vi.mocked(store.createConversation).mockResolvedValue({
      conversation: conversation as never,
      message: { messageId: 'm1', conversationId: ID, from: 'visitor', text: 'Hello', createdAt: conversation.createdAt },
    });

    const res = await handler(event('POST /chat/conversations', { message: 'Hello', name: 'Thandi' }));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('WAITING');
    expect(verifyVisitorToken(body.token, 'unit-test-secret')).toBe(ID);
    expect(timers.scheduleWaitingTimers).toHaveBeenCalledWith(ID);
    expect(notify.pushToAgents).toHaveBeenCalledWith(expect.objectContaining({ title: 'New chat waiting' }));
    expect(notify.emailSupport).toHaveBeenCalled();
  });

  it('creates nothing when offline, so the widget can show the details form', async () => {
    vi.mocked(status.getAvailability).mockResolvedValue(availability(false));
    const res = await handler(event('POST /chat/conversations', { message: 'Hello' }));
    expect(JSON.parse(res.body).status).toBe('OFFLINE');
    expect(store.createConversation).not.toHaveBeenCalled();
  });

  it('silently drops bots that fill the honeypot', async () => {
    const res = await handler(event('POST /chat/conversations', { message: 'Buy now', website: 'spam.example' }));
    expect(res.statusCode).toBe(200);
    expect(store.createConversation).not.toHaveBeenCalled();
    expect(store.withinRateLimit).not.toHaveBeenCalled();
  });

  it('refuses writes from other sites', async () => {
    const res = await handler(event('POST /chat/conversations', { message: 'Hi' }, { origin: 'https://evil.example' }));
    expect(res.statusCode).toBe(403);
  });

  it('limits new chats per visitor', async () => {
    vi.mocked(store.withinRateLimit).mockResolvedValue(false);
    const res = await handler(event('POST /chat/conversations', { message: 'Hi' }));
    expect(res.statusCode).toBe(429);
  });
});

describe('visitor access to a conversation', () => {
  it('needs the token issued for that conversation', async () => {
    const other = issueVisitorToken('4f1c2a4b-5d6e-4f70-8a9b-0c1d2e3f4a5b', 'unit-test-secret');
    const res = await handler(event('GET /chat/conversations/{conversationId}', undefined, { id: ID, token: other }));
    expect(res.statusCode).toBe(401);
    expect(store.getConversation).not.toHaveBeenCalled();
  });

  it('cannot send to an ended chat', async () => {
    vi.mocked(store.getConversation).mockResolvedValue({ ...conversation, status: 'RESOLVED' } as never);
    const token = issueVisitorToken(ID, 'unit-test-secret');
    const res = await handler(
      event('POST /chat/conversations/{conversationId}/messages', { text: 'Hello?' }, { id: ID, token }),
    );
    expect(res.statusCode).toBe(409);
    expect(store.addMessage).not.toHaveBeenCalled();
  });
});

describe('POST /chat/details', () => {
  it('records an offline message as a missed conversation and emails support', async () => {
    vi.mocked(store.createConversation).mockResolvedValue({
      conversation: { ...conversation, status: 'MISSED', source: 'form' } as never,
      message: {} as never,
    });
    const res = await handler(
      event('POST /chat/details', { name: 'Thandi', email: 'thandi@example.co.za', message: 'Please call me' }),
    );
    expect(res.statusCode).toBe(200);
    expect(store.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'MISSED', source: 'form', detailsLeft: true }),
    );
    expect(notify.emailSupport).toHaveBeenCalled();
  });

  it('attaches details to the waiting chat instead of starting another', async () => {
    vi.mocked(store.getConversation).mockResolvedValue(conversation as never);
    vi.mocked(store.setContactDetails).mockResolvedValue(conversation as never);
    vi.mocked(store.transitionConversation).mockResolvedValue({ ...conversation, status: 'MISSED' } as never);
    vi.mocked(store.listMessages).mockResolvedValue([
      { messageId: 'm1', conversationId: ID, from: 'visitor', text: 'Hello', createdAt: '' },
    ]);
    const token = issueVisitorToken(ID, 'unit-test-secret');
    const res = await handler(
      event('POST /chat/details', { name: 'Thandi', email: 'thandi@example.co.za', message: 'Hello' }, { token }),
    );
    expect(res.statusCode).toBe(200);
    expect(store.createConversation).not.toHaveBeenCalled();
    expect(store.transitionConversation).toHaveBeenCalledWith(ID, ['WAITING'], 'MISSED');
    // The carried-over text was already in the chat, so it is not duplicated.
    expect(store.addMessage).not.toHaveBeenCalled();
  });
});
