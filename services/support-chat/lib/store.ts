/**
 * Chat data in one DynamoDB table (merch-os-support-chat-<env>, platform CMK).
 *
 *   PK                SK                      item
 *   CONV#<id>         META                    conversation (GSI1: STATUS#<status> / <updatedAt>)
 *   CONV#<id>         MSG#<iso>#<rand>        message
 *   CONV#<id>         CONN#<connectionId>     visitor socket bound to the conversation
 *   CONN#<id>         META                    any open socket (visitor or agent)
 *   AGENTCONN         CONN#<connectionId>     open agent (inbox) sockets
 *   PRESENCE          AGENT#<agentId>         Online switch + last heartbeat
 *   SETTINGS          GLOBAL                  editable public-holiday list
 *   PUSH              SUB#<sha256(endpoint)>  agent Web Push subscriptions
 *   RL#<scope>#<key>  <window>                rate-limit counters
 *
 * Retention: conversations and messages carry `expiresAt` 12 months after the
 * last activity (refreshed on each message); sockets expire after a day and
 * counters after their window.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { DEFAULT_PUBLIC_HOLIDAYS, type AgentPresence } from './availability';

export const RETENTION_SECONDS = 365 * 24 * 60 * 60;
const CONNECTION_TTL_SECONDS = 24 * 60 * 60;
const PREVIEW_LENGTH = 140;

export type ConversationStatus = 'WAITING' | 'ACTIVE' | 'MISSED' | 'RESOLVED';
export const CONVERSATION_STATUSES: readonly ConversationStatus[] = ['WAITING', 'ACTIVE', 'MISSED', 'RESOLVED'];
export type Sender = 'visitor' | 'agent' | 'system';

export interface Conversation {
  conversationId: string;
  status: ConversationStatus;
  /** 'chat' = started live; 'form' = left details without chatting. */
  source: 'chat' | 'form';
  createdAt: string;
  updatedAt: string;
  name?: string | undefined;
  email?: string | undefined;
  page?: string | undefined;
  agentId?: string | undefined;
  agentName?: string | undefined;
  acceptedAt?: string | undefined;
  resolvedAt?: string | undefined;
  /** Set when the visitor left contact details (missed chat or offline). */
  detailsLeftAt?: string | undefined;
  lastMessage?: string | undefined;
  lastMessageFrom?: Sender | undefined;
  messageCount: number;
}

export interface ChatMessage {
  messageId: string;
  conversationId: string;
  from: Sender;
  text: string;
  createdAt: string;
  agentName?: string | undefined;
}

export type ConnectionRole = 'visitor' | 'agent';
export interface Connection {
  connectionId: string;
  role: ConnectionRole;
  conversationId?: string;
  agentId?: string;
  connectedAt: string;
}

export interface StoredPushSubscription {
  id: string;
  agentId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: string;
}

let doc: DynamoDBDocumentClient | undefined;
function db(): DynamoDBDocumentClient {
  doc ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return doc;
}

const nowIso = (): string => new Date().toISOString();
const epoch = (offsetSeconds: number): number => Math.floor(Date.now() / 1000) + offsetSeconds;
const convPk = (id: string): string => `CONV#${id}`;

/** Drop storage-only attributes before returning an item. */
function toConversation(item: Record<string, unknown> | undefined): Conversation | null {
  if (!item) return null;
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, expiresAt: _e, ...rest } = item;
  return rest as unknown as Conversation;
}

function toMessage(item: Record<string, unknown>): ChatMessage {
  const { PK: _pk, SK: _sk, expiresAt: _e, ...rest } = item;
  return rest as unknown as ChatMessage;
}

function preview(text: string): string {
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

// ─── Conversations ───────────────────────────────────────────────────────────

export async function createConversation(input: {
  status: ConversationStatus;
  source: Conversation['source'];
  name?: string | undefined;
  email?: string | undefined;
  page?: string | undefined;
  firstMessage: string;
  detailsLeft?: boolean;
}): Promise<{ conversation: Conversation; message: ChatMessage }> {
  const conversationId = randomUUID();
  const createdAt = nowIso();
  const conversation: Conversation = {
    conversationId,
    status: input.status,
    source: input.source,
    createdAt,
    updatedAt: createdAt,
    name: input.name,
    email: input.email,
    page: input.page,
    detailsLeftAt: input.detailsLeft ? createdAt : undefined,
    lastMessage: preview(input.firstMessage),
    lastMessageFrom: 'visitor',
    messageCount: 1,
  };
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: {
        PK: convPk(conversationId),
        SK: 'META',
        GSI1PK: `STATUS#${input.status}`,
        GSI1SK: createdAt,
        expiresAt: epoch(RETENTION_SECONDS),
        ...conversation,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    }),
  );
  const message = await putMessage(conversationId, 'visitor', input.firstMessage, createdAt);
  return { conversation, message };
}

export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: convPk(conversationId), SK: 'META' } }),
  );
  return toConversation(out.Item);
}

export async function listConversations(status: ConversationStatus, limit = 50): Promise<Conversation[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `STATUS#${status}` },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (out.Items ?? []).map((i) => toConversation(i)!).filter(Boolean);
}

/**
 * Move a conversation between statuses, only if it is currently in one of
 * `from`. Returns the updated conversation, or null if the condition failed
 * (e.g. someone else accepted it first, or it was already resolved).
 */
export async function transitionConversation(
  conversationId: string,
  from: readonly ConversationStatus[],
  to: ConversationStatus,
  extra: Partial<Pick<Conversation, 'agentId' | 'agentName' | 'acceptedAt' | 'resolvedAt' | 'detailsLeftAt' | 'name' | 'email'>> = {},
): Promise<Conversation | null> {
  const updatedAt = nowIso();
  const sets = ['#status = :to', 'GSI1PK = :gpk', 'GSI1SK = :now', 'updatedAt = :now'];
  const values: Record<string, unknown> = { ':to': to, ':gpk': `STATUS#${to}`, ':now': updatedAt };
  const names: Record<string, string> = { '#status': 'status' };
  Object.entries(extra).forEach(([key, value], i) => {
    if (value === undefined) return;
    names[`#x${i}`] = key;
    values[`:x${i}`] = value;
    sets.push(`#x${i} = :x${i}`);
  });
  const fromKeys = from.map((s, i) => {
    values[`:f${i}`] = s;
    return `:f${i}`;
  });
  try {
    const out = await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: { PK: convPk(conversationId), SK: 'META' },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: `attribute_exists(PK) AND #status IN (${fromKeys.join(', ')})`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toConversation(out.Attributes);
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw err;
  }
}

/** Attach contact details without changing status (e.g. visitor fills the form mid-chat). */
export async function setContactDetails(
  conversationId: string,
  details: { name: string; email: string },
): Promise<Conversation | null> {
  try {
    const now = nowIso();
    const out = await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: { PK: convPk(conversationId), SK: 'META' },
        UpdateExpression: 'SET #n = :n, email = :e, detailsLeftAt = :now, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':n': details.name, ':e': details.email, ':now': now },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toConversation(out.Attributes);
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw err;
  }
}

async function putMessage(
  conversationId: string,
  from: Sender,
  text: string,
  createdAt: string,
  agentName?: string,
): Promise<ChatMessage> {
  const messageId = `${createdAt}#${randomBytes(4).toString('hex')}`;
  const message: ChatMessage = { messageId, conversationId, from, text, createdAt, agentName };
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: { PK: convPk(conversationId), SK: `MSG#${messageId}`, expiresAt: epoch(RETENTION_SECONDS), ...message },
    }),
  );
  return message;
}

/**
 * Append a message and refresh the conversation summary. Fails (returns null)
 * if the conversation no longer exists, e.g. it was deleted.
 */
export async function addMessage(
  conversationId: string,
  from: Sender,
  text: string,
  agentName?: string,
): Promise<{ message: ChatMessage; conversation: Conversation } | null> {
  const createdAt = nowIso();
  let conversation: Conversation | null;
  try {
    const out = await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: { PK: convPk(conversationId), SK: 'META' },
        UpdateExpression:
          'SET updatedAt = :now, GSI1SK = :now, lastMessage = :preview, lastMessageFrom = :from, expiresAt = :exp ADD messageCount :one',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':now': createdAt,
          ':preview': preview(text),
          ':from': from,
          ':exp': epoch(RETENTION_SECONDS),
          ':one': 1,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    conversation = toConversation(out.Attributes);
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw err;
  }
  const message = await putMessage(conversationId, from, text, createdAt, agentName);
  return conversation ? { message, conversation } : null;
}

export async function listMessages(conversationId: string, limit = 500): Promise<ChatMessage[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :msg)',
      ExpressionAttributeValues: { ':pk': convPk(conversationId), ':msg': 'MSG#' },
      Limit: limit,
    }),
  );
  return (out.Items ?? []).map(toMessage);
}

/** Permanently delete a conversation and its messages (POPIA erasure request). */
export async function deleteConversation(conversationId: string): Promise<number> {
  let deleted = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await db().send(
      new QueryCommand({
        TableName: config.table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': convPk(conversationId) },
        ProjectionExpression: 'PK, SK',
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    const keys = (page.Items ?? []).map((i) => ({ PK: i['PK'], SK: i['SK'] }));
    for (let i = 0; i < keys.length; i += 25) {
      let batch = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      // Retry anything DynamoDB hands back unprocessed.
      for (let attempt = 0; batch.length > 0 && attempt < 5; attempt++) {
        const res = await db().send(new BatchWriteCommand({ RequestItems: { [config.table]: batch } }));
        const left = res.UnprocessedItems?.[config.table] ?? [];
        deleted += batch.length - left.length;
        batch = left as typeof batch;
        if (batch.length) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
      }
      if (batch.length) throw new Error('Could not delete every item of the conversation');
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return deleted;
}

// ─── Connections ─────────────────────────────────────────────────────────────

export async function putConnection(conn: Omit<Connection, 'connectedAt'>): Promise<void> {
  const connectedAt = nowIso();
  const expiresAt = epoch(CONNECTION_TTL_SECONDS);
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: { PK: `CONN#${conn.connectionId}`, SK: 'META', expiresAt, connectedAt, ...conn },
    }),
  );
  const indexPk = conn.role === 'agent' ? 'AGENTCONN' : convPk(conn.conversationId!);
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: { PK: indexPk, SK: `CONN#${conn.connectionId}`, connectionId: conn.connectionId, expiresAt },
    }),
  );
}

export async function getConnection(connectionId: string): Promise<Connection | null> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: `CONN#${connectionId}`, SK: 'META' } }),
  );
  if (!out.Item) return null;
  const { PK: _pk, SK: _sk, expiresAt: _e, ...rest } = out.Item;
  return rest as unknown as Connection;
}

/** Remove a socket and its index entry. Safe to call twice. */
export async function deleteConnection(connectionId: string, known?: Connection | null): Promise<void> {
  const conn = known ?? (await getConnection(connectionId));
  await db().send(new DeleteCommand({ TableName: config.table, Key: { PK: `CONN#${connectionId}`, SK: 'META' } }));
  if (!conn) return;
  const indexPk = conn.role === 'agent' ? 'AGENTCONN' : conn.conversationId ? convPk(conn.conversationId) : null;
  if (indexPk) {
    await db().send(
      new DeleteCommand({ TableName: config.table, Key: { PK: indexPk, SK: `CONN#${connectionId}` } }),
    );
  }
}

async function listIndexedConnections(pk: string): Promise<string[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :c)',
      ExpressionAttributeValues: { ':pk': pk, ':c': 'CONN#' },
      ProjectionExpression: 'connectionId',
    }),
  );
  return (out.Items ?? []).map((i) => String(i['connectionId']));
}

export const listVisitorConnections = (conversationId: string): Promise<string[]> =>
  listIndexedConnections(convPk(conversationId));
export const listAgentConnections = (): Promise<string[]> => listIndexedConnections('AGENTCONN');

// ─── Presence ────────────────────────────────────────────────────────────────

export async function setPresence(agentId: string, online: boolean): Promise<AgentPresence> {
  const lastSeenAt = Date.now();
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: { PK: 'PRESENCE', SK: `AGENT#${agentId}`, agentId, online, lastSeenAt },
    }),
  );
  return { agentId, online, lastSeenAt };
}

/** Heartbeat: record that the agent's inbox is open, keeping their switch as is. */
export async function touchPresence(agentId: string): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: config.table,
      Key: { PK: 'PRESENCE', SK: `AGENT#${agentId}` },
      UpdateExpression: 'SET agentId = :id, lastSeenAt = :t, online = if_not_exists(online, :off)',
      ExpressionAttributeValues: { ':id': agentId, ':t': Date.now(), ':off': false },
    }),
  );
}

export async function listPresence(): Promise<AgentPresence[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PRESENCE' },
    }),
  );
  return (out.Items ?? []).map((i) => ({
    agentId: String(i['agentId']),
    online: i['online'] === true,
    lastSeenAt: Number(i['lastSeenAt'] ?? 0),
  }));
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getHolidays(): Promise<string[]> {
  const out = await db().send(new GetCommand({ TableName: config.table, Key: { PK: 'SETTINGS', SK: 'GLOBAL' } }));
  const stored = out.Item?.['holidays'];
  return Array.isArray(stored) ? (stored as string[]) : [...DEFAULT_PUBLIC_HOLIDAYS];
}

export async function setHolidays(holidays: string[], updatedBy: string): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: { PK: 'SETTINGS', SK: 'GLOBAL', holidays, updatedAt: nowIso(), updatedBy },
    }),
  );
}

// ─── Push subscriptions ──────────────────────────────────────────────────────

const pushId = (endpoint: string): string => createHash('sha256').update(endpoint).digest('hex');

export async function savePushSubscription(
  agentId: string,
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
): Promise<void> {
  const id = pushId(sub.endpoint);
  await db().send(
    new PutCommand({
      TableName: config.table,
      Item: { PK: 'PUSH', SK: `SUB#${id}`, id, agentId, endpoint: sub.endpoint, keys: sub.keys, createdAt: nowIso() },
    }),
  );
}

export async function listPushSubscriptions(): Promise<StoredPushSubscription[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PUSH' },
    }),
  );
  return (out.Items ?? []).map((i) => ({
    id: String(i['id']),
    agentId: String(i['agentId']),
    endpoint: String(i['endpoint']),
    keys: i['keys'] as StoredPushSubscription['keys'],
    createdAt: String(i['createdAt']),
  }));
}

export async function deletePushSubscription(endpointOrId: string): Promise<void> {
  const id = /^[a-f0-9]{64}$/.test(endpointOrId) ? endpointOrId : pushId(endpointOrId);
  await db().send(new DeleteCommand({ TableName: config.table, Key: { PK: 'PUSH', SK: `SUB#${id}` } }));
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Fixed-window counter. Returns true while the caller is within `limit`
 * requests per `windowSeconds` for this scope + key.
 */
export async function withinRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const hashedKey = createHash('sha256').update(key).digest('hex').slice(0, 32);
  const out = await db().send(
    new UpdateCommand({
      TableName: config.table,
      Key: { PK: `RL#${scope}#${hashedKey}`, SK: String(window) },
      UpdateExpression: 'ADD hits :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ExpressionAttributeValues: { ':one': 1, ':exp': epoch(windowSeconds * 2) },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return Number(out.Attributes?.['hits'] ?? 0) <= limit;
}
