/**
 * Team: announcements, goals and team chat. In the admin table:
 *
 *   PK                       SK                         item
 *   ANNOUNCE#<id>            META                       announcement (GSI1: ANNOUNCEMENTS / <createdAt>)
 *   ANNOUNCE#<id>            READ#<userId>              who has read it
 *   GOAL#<id>                META                       goal (GSI1: GOALS#<YYYY-MM> / <createdAt>)
 *   TEAMCHAT#<channel>       MSG#<iso>#<rand>           chat message (TTL 12 months)
 *   USER#<userId>            CHANREAD#<channel>         when this person last read a channel
 *
 * Channels: "everyone", or "dm.<userA>.<userB>" (ids sorted) for two staff members.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db } from './data';

const epoch = (secondsFromNow: number) => Math.floor(Date.now() / 1000) + secondsFromNow;
export const CHAT_RETENTION_SECONDS = 365 * 24 * 60 * 60;
const strip = <T>(item: Record<string, unknown>): T => {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, expiresAt: _e, ...rest } = item;
  return rest as T;
};

// ─── Announcements ──────────────────────────────────────────────────────────

export interface Announcement {
  announcementId: string;
  title: string;
  body: string;
  createdAt: string;
  createdBy: string;
}

export async function listAnnouncements(limit = 50): Promise<Announcement[]> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ANNOUNCEMENTS' },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []).map((i) => strip<Announcement>(i));
}

export async function postAnnouncement(title: string, body: string, by: string, now = new Date()): Promise<Announcement> {
  const a: Announcement = { announcementId: randomUUID(), title, body, createdAt: now.toISOString(), createdBy: by };
  await db().send(
    new PutCommand({
      TableName: config.adminTable,
      Item: { PK: `ANNOUNCE#${a.announcementId}`, SK: 'META', ...a, GSI1PK: 'ANNOUNCEMENTS', GSI1SK: a.createdAt },
    }),
  );
  return a;
}

export async function getAnnouncement(id: string): Promise<Announcement | null> {
  const res = await db().send(new GetCommand({ TableName: config.adminTable, Key: { PK: `ANNOUNCE#${id}`, SK: 'META' } }));
  return res.Item ? strip<Announcement>(res.Item) : null;
}

/** Who has read each announcement (user ids). */
export async function readersOf(ids: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  await Promise.all(
    ids.map(async (id) => {
      const res = await db().send(
        new QueryCommand({
          TableName: config.adminTable,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `ANNOUNCE#${id}`, ':sk': 'READ#' },
          ProjectionExpression: 'SK',
        }),
      );
      out.set(id, new Set((res.Items ?? []).map((i) => String(i['SK']).slice(5))));
    }),
  );
  return out;
}

export async function markAnnouncementRead(id: string, userId: string, now = new Date()): Promise<void> {
  await db().send(
    new PutCommand({ TableName: config.adminTable, Item: { PK: `ANNOUNCE#${id}`, SK: `READ#${userId}`, at: now.toISOString() } }),
  );
}

/** Removes the announcement and its read markers. */
export async function deleteAnnouncement(id: string): Promise<void> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `ANNOUNCE#${id}` },
      ProjectionExpression: 'PK, SK',
    }),
  );
  for (const i of res.Items ?? []) {
    await db().send(new DeleteCommand({ TableName: config.adminTable, Key: { PK: i['PK'], SK: i['SK'] } }));
  }
}

// ─── Goals ──────────────────────────────────────────────────────────────────

/** Goals that count themselves from MerchOS data; everything else is updated by hand. */
export const AUTO_METRICS = {
  new_sellers: 'New seller businesses (from Customers)',
  reviews_approved: 'Reviews approved for the website',
  chats_answered: 'Live chats answered and resolved',
} as const;
export type AutoMetric = keyof typeof AUTO_METRICS;

export interface Goal {
  goalId: string;
  title: string;
  /** Calendar month the goal is for, YYYY-MM (South African time). */
  month: string;
  target: number;
  /** 'auto' goals count themselves; 'manual' goals are updated by their owner or Admin. */
  kind: 'auto' | 'manual';
  metric?: AutoMetric | undefined;
  /** Manual goals: progress so far, and an optional short status. */
  current?: number | undefined;
  status?: string | undefined;
  ownerId?: string | undefined;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export async function listGoals(month: string): Promise<Goal[]> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `GOALS#${month}` },
    }),
  );
  return (res.Items ?? []).map((i) => strip<Goal>(i)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getGoal(id: string): Promise<Goal | null> {
  const res = await db().send(
    new GetCommand({ TableName: config.adminTable, Key: { PK: `GOAL#${id}`, SK: 'META' }, ConsistentRead: true }),
  );
  return res.Item ? strip<Goal>(res.Item) : null;
}

export async function saveGoal(goal: Goal): Promise<Goal> {
  await db().send(
    new PutCommand({
      TableName: config.adminTable,
      Item: { PK: `GOAL#${goal.goalId}`, SK: 'META', ...goal, GSI1PK: `GOALS#${goal.month}`, GSI1SK: goal.createdAt },
    }),
  );
  return goal;
}

export const newGoalId = (): string => randomUUID();

export async function deleteGoal(id: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: config.adminTable, Key: { PK: `GOAL#${id}`, SK: 'META' } }));
}

/** Month boundaries in South African time (UTC+2) as ISO instants. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1, -2));
  const to = new Date(Date.UTC(y, m, 1, -2) - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function currentMonth(now = new Date()): string {
  return new Date(now.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 7);
}

async function countIndex(table: string, pk: string, from: string, to: string): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await db().send(
      new QueryCommand({
        TableName: table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': pk, ':from': from, ':to': to },
        Select: 'COUNT',
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    count += res.Count ?? 0;
    startKey = res.LastEvaluatedKey;
    if (!startKey) break;
  }
  return count;
}

/** Progress of an automatic goal. New sellers are passed in (from Cognito). */
export async function autoProgress(
  metric: AutoMetric,
  month: string,
  sellerJoinTimes: string[],
): Promise<number> {
  const { from, to } = monthRange(month);
  switch (metric) {
    case 'new_sellers':
      return sellerJoinTimes.filter((t) => t >= from && t <= to).length;
    case 'reviews_approved':
      return countIndex(config.engagementTable, 'REVIEWS#APPROVED', from, to);
    case 'chats_answered':
      // Resolved chats keep their last update time, which is when they were resolved.
      return countIndex(config.chatTable, 'STATUS#RESOLVED', from, to);
  }
}

// ─── Team chat ──────────────────────────────────────────────────────────────

export interface ChatMessage {
  messageId: string;
  channel: string;
  from: string;
  text: string;
  at: string;
}

export const EVERYONE = 'everyone';
export const dmChannel = (a: string, b: string): string => `dm.${[a, b].sort().join('.')}`;

/** True when the user may read and write this channel. */
export function canUseChannel(channel: string, userId: string, staffIds: Set<string>): boolean {
  if (channel === EVERYONE) return true;
  const m = /^dm\.([A-Za-z0-9-]+)\.([A-Za-z0-9-]+)$/.exec(channel);
  if (!m) return false;
  const [, a, b] = m as unknown as [string, string, string];
  return a !== b && (a === userId || b === userId) && staffIds.has(a) && staffIds.has(b) && dmChannel(a, b) === channel;
}

export async function listMessages(channel: string, opts: { after?: string; limit?: number } = {}): Promise<ChatMessage[]> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      KeyConditionExpression: opts.after ? 'PK = :pk AND SK > :after' : 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `TEAMCHAT#${channel}`,
        ...(opts.after ? { ':after': `MSG#${opts.after}~` } : { ':sk': 'MSG#' }),
      },
      // Latest page first, then shown oldest first.
      ScanIndexForward: !!opts.after,
      Limit: opts.limit ?? 100,
    }),
  );
  const items = (res.Items ?? []).map((i) => strip<ChatMessage>(i));
  return opts.after ? items : items.reverse();
}

export async function postMessage(channel: string, from: string, text: string, now = new Date()): Promise<ChatMessage> {
  const at = now.toISOString();
  const msg: ChatMessage = { messageId: `${at}#${randomBytes(4).toString('hex')}`, channel, from, text, at };
  await db().send(
    new PutCommand({
      TableName: config.adminTable,
      Item: { PK: `TEAMCHAT#${channel}`, SK: `MSG#${msg.messageId}`, ...msg, expiresAt: epoch(CHAT_RETENTION_SECONDS) },
    }),
  );
  return msg;
}

export async function markChannelRead(channel: string, userId: string, at: string): Promise<void> {
  // Never move backwards (two tabs open).
  await db()
    .send(
      new UpdateCommand({
        TableName: config.adminTable,
        Key: { PK: `USER#${userId}`, SK: `CHANREAD#${channel}` },
        UpdateExpression: 'SET lastReadAt = :at',
        ConditionExpression: 'attribute_not_exists(lastReadAt) OR lastReadAt < :at',
        ExpressionAttributeValues: { ':at': at },
      }),
    )
    .catch((e: { name?: string }) => {
      if (e.name !== 'ConditionalCheckFailedException') throw e;
    });
}

export async function lastRead(userId: string): Promise<Map<string, string>> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': 'CHANREAD#' },
    }),
  );
  return new Map((res.Items ?? []).map((i) => [String(i['SK']).slice(9), String(i['lastReadAt'])]));
}

/** Messages from others after `since` (capped at 99). */
export async function unreadIn(channel: string, userId: string, since: string | undefined): Promise<number> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      KeyConditionExpression: 'PK = :pk AND SK > :after',
      FilterExpression: '#from <> :me',
      ExpressionAttributeNames: { '#from': 'from' },
      ExpressionAttributeValues: { ':pk': `TEAMCHAT#${channel}`, ':after': `MSG#${since ?? '0'}~`, ':me': userId },
      ProjectionExpression: 'SK',
      Limit: 200,
    }),
  );
  return Math.min(99, res.Count ?? 0);
}
