/**
 * Seller notifications (the bell in the seller dashboard), in the engagement table.
 *
 *   PK            SK                       item
 *   TENANT#<id>   NOTIF#<at>#<key>         one notification (newest first by SK)
 *   TENANT#<id>   NOTIFKEY#<key>           "already created" marker (retries and repeat events)
 *   TENANT#<id>   NOTIF_STATE              lastReadAt ("Mark all as read")
 *
 * Kept 90 days (TTL), the bell shows the last 50. A notification is unread
 * until it is opened (readAt) or "Mark all as read" passes it (lastReadAt).
 * Text is plain, written for sellers: no internal codes or ids.
 */

import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db, isConditionalFailure } from './store';

export const NOTIFICATION_TTL_DAYS = 90;
export const NOTIFICATION_LIST_LIMIT = 50;

export type NotificationKind =
  | 'import.completed'
  | 'import.failed'
  | 'image.rejected'
  | 'image.failed'
  | 'payment.received'
  | 'referral.earned'
  | 'referral.applied'
  | 'billing.due'
  | 'billing.paused'
  | 'billing.closing'
  | 'trial.almost'
  | 'trial.used';

export interface NewNotification {
  /** Stable per event: a repeat with the same key is ignored. */
  key: string;
  kind: NotificationKind;
  title: string;
  message: string;
  /** Seller dashboard path to open, e.g. /imports/<id>. */
  link: string;
  /** When it happened (ISO). */
  at: string;
}

export interface SellerNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  link: string;
  at: string;
  read: boolean;
}

const tenantPK = (tenantId: string) => `TENANT#${tenantId}`;
const KEY = /^[A-Za-z0-9:._#-]{1,200}$/;
const ID = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[A-Za-z0-9:._#-]{1,200}$/;

/** Creates the notification once per key. False when it already existed. */
export async function addNotification(tenantId: string, n: NewNotification): Promise<boolean> {
  if (!KEY.test(n.key)) throw new Error('Invalid notification key');
  const at = new Date(n.at).toISOString();
  const expiresAt = Math.floor(Date.parse(at) / 1000) + NOTIFICATION_TTL_DAYS * 24 * 60 * 60;
  const pk = tenantPK(tenantId);
  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.table,
              Item: { PK: pk, SK: `NOTIFKEY#${n.key}`, createdAt: new Date().toISOString(), expiresAt },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: config.table,
              Item: {
                PK: pk,
                SK: `NOTIF#${at}#${n.key}`,
                kind: n.kind,
                title: n.title,
                message: n.message,
                link: n.link,
                at,
                expiresAt,
              },
            },
          },
        ],
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

async function lastReadAt(tenantId: string): Promise<string> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: tenantPK(tenantId), SK: 'NOTIF_STATE' } }),
  );
  return (out.Item?.['lastReadAt'] as string | undefined) ?? '';
}

export async function listNotifications(
  tenantId: string,
  now: Date = new Date(),
): Promise<{ notifications: SellerNotification[]; unreadCount: number }> {
  const [out, readUntil] = await Promise.all([
    db().send(
      new QueryCommand({
        TableName: config.table,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)',
        ExpressionAttributeValues: { ':pk': tenantPK(tenantId), ':p': 'NOTIF#' },
        ScanIndexForward: false,
        Limit: NOTIFICATION_LIST_LIMIT,
      }),
    ),
    lastReadAt(tenantId),
  ]);
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const notifications = (out.Items ?? [])
    // TTL deletion can lag by a day or two.
    .filter((i) => typeof i['expiresAt'] !== 'number' || (i['expiresAt'] as number) > nowEpoch)
    .map((i) => {
      const at = String(i['at']);
      return {
        id: String(i['SK']).slice('NOTIF#'.length),
        kind: i['kind'] as NotificationKind,
        title: String(i['title']),
        message: String(i['message']),
        link: String(i['link']),
        at,
        read: !!i['readAt'] || at <= readUntil,
      };
    });
  return { notifications, unreadCount: notifications.filter((n) => !n.read).length };
}

/** Marks some notifications read (ids from the list). Unknown ids are ignored. */
export async function markRead(tenantId: string, ids: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (const id of ids.filter((i) => ID.test(i)).slice(0, NOTIFICATION_LIST_LIMIT)) {
    try {
      await db().send(
        new UpdateCommand({
          TableName: config.table,
          Key: { PK: tenantPK(tenantId), SK: `NOTIF#${id}` },
          UpdateExpression: 'SET readAt = if_not_exists(readAt, :now)',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':now': now },
        }),
      );
    } catch (error) {
      if (!isConditionalFailure(error)) throw error;
    }
  }
}

/** "Mark all as read": everything up to now. */
export async function markAllRead(tenantId: string): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: config.table,
      Key: { PK: tenantPK(tenantId), SK: 'NOTIF_STATE' },
      UpdateExpression: 'SET lastReadAt = :now',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }),
  );
}
