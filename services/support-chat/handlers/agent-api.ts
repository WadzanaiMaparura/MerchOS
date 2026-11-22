/**
 * Support inbox API (admin dashboard). Cognito JWT authorizer on every route,
 * then RBAC: resource `support-inbox` (Support and Admin roles).
 *
 *   GET    /support/conversations?status=WAITING|ACTIVE|MISSED|RESOLVED
 *   GET    /support/conversations/{conversationId}
 *   POST   /support/conversations/{conversationId}/accept
 *   POST   /support/conversations/{conversationId}/messages
 *   POST   /support/conversations/{conversationId}/resolve
 *   DELETE /support/conversations/{conversationId}          (POPIA erasure)
 *   GET    /support/presence      PUT /support/presence     ({ online })
 *   GET    /support/settings      PUT /support/settings     ({ holidays })
 *   POST   /support/push-subscriptions   DELETE /support/push-subscriptions
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { rbacMiddleware } from '../../shared/middleware/rbac';
import { HOURS_LABEL, isIsoDate } from '../lib/availability';
import { toAgents, toVisitor } from '../lib/broadcast';
import { config, getChatSecret } from '../lib/config';
import { badRequest, conflict, json, notFound, readJson, tooMany, type HttpResult } from '../lib/http';
import { bestEffort } from '../lib/notify';
import { getAvailability } from '../lib/status';
import {
  CONVERSATION_STATUSES,
  addMessage,
  deleteConversation,
  deletePushSubscription,
  getConversation,
  getHolidays,
  listConversations,
  listMessages,
  listPresence,
  savePushSubscription,
  setHolidays,
  setPresence,
  transitionConversation,
  withinRateLimit,
  type Conversation,
  type ConversationStatus,
} from '../lib/store';
import { firstIssue, holidaysSchema, presenceSchema, pushSubscriptionSchema, wsSendSchema } from '../lib/validation';

/** The signed-in agent (Cognito sub), attached by rbacMiddleware. */
function agentId(event: APIGatewayProxyEventV2): string {
  const ctx = event.requestContext as unknown as { authorizer?: { rbac?: { userId?: string } } };
  const id = ctx.authorizer?.rbac?.userId;
  if (!id) throw new Error('No agent identity on the request');
  return id;
}

const conversationIdOf = (event: APIGatewayProxyEventV2): string | undefined => {
  const id = event.pathParameters?.['conversationId'];
  return id && /^[a-f0-9-]{36}$/.test(id) ? id : undefined;
};

async function list(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const status = (event.queryStringParameters?.['status'] ?? 'WAITING').toUpperCase() as ConversationStatus;
  if (!CONVERSATION_STATUSES.includes(status)) return badRequest('Unknown status');
  return json(200, { conversations: await listConversations(status) });
}

async function getOne(id: string): Promise<HttpResult> {
  const conversation = await getConversation(id);
  if (!conversation) return notFound('Conversation not found');
  return json(200, { conversation, messages: await listMessages(id) });
}

/** Take a waiting or missed chat. Only one agent can win. */
async function accept(id: string, agent: string): Promise<Conversation | null> {
  const accepted = await transitionConversation(id, ['WAITING', 'MISSED'], 'ACTIVE', {
    agentId: agent,
    agentName: config.agentDisplayName,
    acceptedAt: new Date().toISOString(),
  });
  if (!accepted) return null;
  const joined = await addMessage(id, 'system', `${config.agentDisplayName} joined the chat`);
  const conversation = joined?.conversation ?? accepted;
  await Promise.all([
    bestEffort('Visitor accepted', () =>
      toVisitor(id, { type: 'accepted', conversationId: id, agentName: config.agentDisplayName }),
    ),
    joined ? bestEffort('Visitor message', () => toVisitor(id, { type: 'message', message: joined.message })) : null,
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation })),
  ]);
  return conversation;
}

async function acceptRoute(id: string, agent: string): Promise<HttpResult> {
  const conversation = await accept(id, agent);
  if (!conversation) return conflict('This chat was already taken or has ended.');
  return json(200, { conversation });
}

async function send(event: APIGatewayProxyEventV2, id: string, agent: string): Promise<HttpResult> {
  const parsed = wsSendSchema.omit({ action: true, conversationId: true }).safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  if (!(await withinRateLimit('agentmsg', id, 60, 60))) return tooMany('Slow down a little.');

  const current = await getConversation(id);
  if (!current) return notFound('Conversation not found');
  if (current.status === 'RESOLVED') return conflict('This chat has ended.');
  // Replying to a waiting/missed chat takes it.
  if (current.status !== 'ACTIVE' && !(await accept(id, agent))) {
    return conflict('This chat was already taken or has ended.');
  }

  const result = await addMessage(id, 'agent', parsed.data.text, config.agentDisplayName);
  if (!result) return notFound('Conversation not found');
  await Promise.all([
    bestEffort('Visitor message', () => toVisitor(id, { type: 'message', message: result.message })),
    bestEffort('Inbox message', () => toAgents({ type: 'message', message: result.message })),
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation: result.conversation })),
  ]);
  return json(201, { message: result.message });
}

async function resolve(id: string): Promise<HttpResult> {
  const resolved = await transitionConversation(id, ['WAITING', 'ACTIVE', 'MISSED'], 'RESOLVED', {
    resolvedAt: new Date().toISOString(),
  });
  if (!resolved) return conflict('This chat has already ended.');
  const ended = await addMessage(id, 'system', 'Chat ended');
  const conversation = ended?.conversation ?? resolved;
  await Promise.all([
    ended ? bestEffort('Visitor message', () => toVisitor(id, { type: 'message', message: ended.message })) : null,
    bestEffort('Visitor resolved', () => toVisitor(id, { type: 'resolved', conversationId: id })),
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation })),
  ]);
  return json(200, { conversation });
}

async function remove(id: string, agent: string): Promise<HttpResult> {
  const existing = await getConversation(id);
  if (!existing) return notFound('Conversation not found');
  // Tell the visitor's open tabs first: their socket index is deleted with it.
  await bestEffort('Visitor deleted', () => toVisitor(id, { type: 'conversation_deleted', conversationId: id }));
  const items = await deleteConversation(id);
  // Audit without personal data: who deleted which conversation, and when.
  console.info('Conversation deleted', { conversationId: id, deletedBy: agent, items });
  await bestEffort('Inbox update', () => toAgents({ type: 'conversation_deleted', conversationId: id }));
  return json(200, { deleted: true });
}

async function presence(event: APIGatewayProxyEventV2, agent: string): Promise<HttpResult> {
  if (event.requestContext.http.method === 'PUT') {
    const parsed = presenceSchema.safeParse(readJson(event));
    if (!parsed.success) return badRequest(firstIssue(parsed.error));
    await setPresence(agent, parsed.data.online);
  }
  const [availability, all] = await Promise.all([getAvailability(), listPresence()]);
  const me = all.find((p) => p.agentId === agent) ?? { agentId: agent, online: false, lastSeenAt: 0 };
  return json(200, { me, ...availability });
}

async function settings(event: APIGatewayProxyEventV2, agent: string): Promise<HttpResult> {
  if (event.requestContext.http.method === 'PUT') {
    const parsed = holidaysSchema.safeParse(readJson(event));
    if (!parsed.success) return badRequest(firstIssue(parsed.error));
    const invalid = parsed.data.holidays.find((d) => !isIsoDate(d));
    if (invalid) return badRequest(`"${invalid}" is not a date (use YYYY-MM-DD)`);
    await setHolidays([...new Set(parsed.data.holidays)].sort(), agent);
  }
  const secret = await getChatSecret();
  return json(200, {
    holidays: await getHolidays(),
    hoursLabel: HOURS_LABEL,
    agentName: config.agentDisplayName,
    vapidPublicKey: secret.vapidPublicKey ?? null,
  });
}

async function pushSubscriptions(event: APIGatewayProxyEventV2, agent: string): Promise<HttpResult> {
  const body = readJson(event);
  if (event.requestContext.http.method === 'DELETE') {
    const endpoint = (body as { endpoint?: unknown } | undefined)?.endpoint;
    if (typeof endpoint !== 'string') return badRequest('endpoint is required');
    await deletePushSubscription(endpoint);
    return json(200, { ok: true });
  }
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  await savePushSubscription(agent, parsed.data);
  return json(201, { ok: true });
}

async function baseHandler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const agent = agentId(event);
    const route = event.routeKey;
    const id = conversationIdOf(event);
    const needsId = route.includes('{conversationId}');
    if (needsId && !id) return badRequest('Invalid conversation id');

    switch (route) {
      case 'GET /support/conversations':
        return await list(event);
      case 'GET /support/conversations/{conversationId}':
        return await getOne(id!);
      case 'POST /support/conversations/{conversationId}/accept':
        return await acceptRoute(id!, agent);
      case 'POST /support/conversations/{conversationId}/messages':
        return await send(event, id!, agent);
      case 'POST /support/conversations/{conversationId}/resolve':
        return await resolve(id!);
      case 'DELETE /support/conversations/{conversationId}':
        return await remove(id!, agent);
      case 'GET /support/presence':
      case 'PUT /support/presence':
        return await presence(event, agent);
      case 'GET /support/settings':
      case 'PUT /support/settings':
        return await settings(event, agent);
      case 'POST /support/push-subscriptions':
      case 'DELETE /support/push-subscriptions':
        return await pushSubscriptions(event, agent);
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Support inbox API failed', { route: event.routeKey, error: (err as Error).message });
    return json(500, { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  }
}

export const handler = middy(baseHandler).use(rbacMiddleware({ resource: 'support-inbox', action: 'update' }));
