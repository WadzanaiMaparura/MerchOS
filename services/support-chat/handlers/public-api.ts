/**
 * Visitor-facing chat API (no login; website and seller dashboard).
 *
 *   GET  /chat/status                               is a person available right now?
 *   POST /chat/conversations                        start a chat (only when online)
 *   GET  /chat/conversations/{conversationId}       reload my chat   (visitor token)
 *   POST /chat/conversations/{conversationId}/messages  send a message (visitor token)
 *   POST /chat/details                              leave name/email/message
 *
 * Abuse controls: our origins only, honeypot field, 5 new chats and 5 detail
 * forms per hour per IP, 30 messages per minute per chat, 2,000-char plain text.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { toAgents, toVisitor } from '../lib/broadcast';
import { config, getChatSecret } from '../lib/config';
import {
  badRequest,
  bearer,
  conflict,
  header,
  json,
  notFound,
  originAllowed,
  readJson,
  tooMany,
  unauthorized,
  type HttpResult,
} from '../lib/http';
import { bestEffort, emailSupport, pushToAgents } from '../lib/notify';
import { getAvailability } from '../lib/status';
import {
  addMessage,
  createConversation,
  getConversation,
  listMessages,
  setContactDetails,
  transitionConversation,
  withinRateLimit,
} from '../lib/store';
import { scheduleWaitingTimers } from '../lib/timers';
import { firstIssue, leaveDetailsSchema, startChatSchema, wsSendSchema } from '../lib/validation';
import { issueVisitorToken, verifyVisitorToken } from '../lib/visitor-token';

const START_LIMIT_PER_HOUR = 5;
const DETAILS_LIMIT_PER_HOUR = 5;
const MESSAGES_PER_MINUTE = 30;

const sourceIp = (event: APIGatewayProxyEventV2): string => event.requestContext?.http?.sourceIp ?? 'unknown';

/** The visitor view of a conversation: no internal fields. */
function visitorView(c: { conversationId: string; status: string; agentName?: string | undefined }) {
  return { conversationId: c.conversationId, status: c.status, agentName: c.status === 'ACTIVE' ? c.agentName : undefined };
}

async function authorisedConversationId(event: APIGatewayProxyEventV2): Promise<string | null> {
  const id = event.pathParameters?.['conversationId'];
  const secret = await getChatSecret();
  const granted = verifyVisitorToken(bearer(event), secret.visitorTokenSecret);
  return id && granted === id ? id : null;
}

async function status(): Promise<HttpResult> {
  return json(200, await getAvailability());
}

async function startChat(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const parsed = startChatSchema.safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const input = parsed.data;
  // Honeypot filled: look normal, store nothing.
  if (input.website) return json(200, { status: 'OFFLINE' });

  if (!(await withinRateLimit('start', sourceIp(event), START_LIMIT_PER_HOUR, 3600))) {
    return tooMany('You have started several chats in a short time. Please leave your details instead.');
  }

  // Offline: the widget shows the details form, carrying the message over.
  const availability = await getAvailability();
  if (!availability.online) return json(200, { status: 'OFFLINE', ...availability });

  const { conversation, message } = await createConversation({
    status: 'WAITING',
    source: 'chat',
    name: input.name,
    email: input.email,
    page: input.page,
    firstMessage: input.message,
  });
  const secret = await getChatSecret();
  const token = issueVisitorToken(conversation.conversationId, secret.visitorTokenSecret);

  const who = conversation.name ?? 'A visitor';
  await Promise.all([
    bestEffort('Schedule chat timers', () => scheduleWaitingTimers(conversation.conversationId)),
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation })),
    bestEffort('Push alert', () =>
      pushToAgents({
        title: 'New chat waiting',
        body: `${who}: ${conversation.lastMessage ?? ''}`,
        url: `/support?c=${conversation.conversationId}`,
        tag: `chat-${conversation.conversationId}`,
      }),
    ),
    bestEffort('Email alert', () =>
      emailSupport({
        subject: `New chat waiting from ${who}`,
        intro: `${who} started a chat on the MerchOS website and is waiting for a reply.`,
        conversation,
        message: input.message,
      }),
    ),
  ]);

  return json(201, {
    ...visitorView(conversation),
    token,
    agentName: availability.agentName,
    messages: [message],
  });
}

async function getMine(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const id = await authorisedConversationId(event);
  if (!id) return unauthorized();
  const conversation = await getConversation(id);
  if (!conversation) return notFound('This chat is no longer available.');
  const messages = await listMessages(id);
  return json(200, { ...visitorView(conversation), messages });
}

async function sendMine(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const id = await authorisedConversationId(event);
  if (!id) return unauthorized();
  const parsed = wsSendSchema.omit({ action: true, conversationId: true }).safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));

  if (!(await withinRateLimit('msg', id, MESSAGES_PER_MINUTE, 60))) {
    return tooMany('You are sending messages very quickly. Please wait a moment.');
  }
  const current = await getConversation(id);
  if (!current) return notFound('This chat is no longer available.');
  if (current.status === 'RESOLVED') return conflict('This chat has ended. You can start a new one.');

  const result = await addMessage(id, 'visitor', parsed.data.text);
  if (!result) return notFound('This chat is no longer available.');
  await Promise.all([
    bestEffort('Inbox message', () => toAgents({ type: 'message', message: result.message })),
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation: result.conversation })),
    // Echo to the visitor's other tabs.
    bestEffort('Visitor echo', () => toVisitor(id, { type: 'message', message: result.message })),
  ]);
  return json(201, { message: result.message });
}

async function leaveDetails(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  const parsed = leaveDetailsSchema.safeParse(readJson(event));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const input = parsed.data;
  if (input.website) return json(200, { ok: true });

  if (!(await withinRateLimit('details', sourceIp(event), DETAILS_LIMIT_PER_HOUR, 3600))) {
    return tooMany('We have already received your details. We will be in touch soon.');
  }

  // Leaving details from inside a waiting chat keeps everything in one thread.
  const secret = await getChatSecret();
  const fromChat = verifyVisitorToken(bearer(event), secret.visitorTokenSecret);
  let conversation = fromChat ? await getConversation(fromChat) : null;

  if (conversation && conversation.status !== 'RESOLVED') {
    const id = conversation.conversationId;
    conversation = (await setContactDetails(id, { name: input.name, email: input.email })) ?? conversation;
    conversation = (await transitionConversation(id, ['WAITING'], 'MISSED')) ?? conversation;
    const already = (await listMessages(id)).some((m) => m.from === 'visitor' && m.text === input.message);
    if (!already) {
      const added = await addMessage(id, 'visitor', input.message);
      if (added) {
        conversation = added.conversation;
        await bestEffort('Inbox message', () => toAgents({ type: 'message', message: added.message }));
      }
    }
  } else {
    conversation = (
      await createConversation({
        status: 'MISSED',
        source: 'form',
        name: input.name,
        email: input.email,
        page: input.page,
        firstMessage: input.message,
        detailsLeft: true,
      })
    ).conversation;
  }

  const c = conversation;
  await Promise.all([
    bestEffort('Inbox update', () => toAgents({ type: 'conversation', conversation: c })),
    bestEffort('Push alert', () =>
      pushToAgents({
        title: 'New message to reply to',
        body: `${input.name} left their details`,
        url: `/support?c=${c.conversationId}`,
        tag: `chat-${c.conversationId}`,
      }),
    ),
    bestEffort('Email alert', () =>
      emailSupport({
        subject: `${input.name} left a message for MerchOS support`,
        intro: `${input.name} (${input.email}) left a message. Reply to this email to answer them directly.`,
        conversation: c,
        message: input.message,
      }),
    ),
  ]);
  return json(200, { ok: true });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<HttpResult> {
  try {
    const route = event.routeKey;
    // Every write must come from our own pages (CORS covers reads in browsers).
    if (event.requestContext?.http?.method === 'POST' && !originAllowed(header(event, 'origin'), config.visitorOrigins)) {
      return json(403, { error: { code: 'FORBIDDEN', message: 'Origin not allowed' } });
    }
    switch (route) {
      case 'GET /chat/status':
        return await status();
      case 'POST /chat/conversations':
        return await startChat(event);
      case 'GET /chat/conversations/{conversationId}':
        return await getMine(event);
      case 'POST /chat/conversations/{conversationId}/messages':
        return await sendMine(event);
      case 'POST /chat/details':
        return await leaveDetails(event);
      default:
        return notFound();
    }
  } catch (err) {
    console.error('Chat public API failed', { route: event.routeKey, error: (err as Error).message });
    return json(500, { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  }
}
