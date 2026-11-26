/**
 * Data-retention records in this service's table (merch-os-admin-<env>):
 *
 *   PK               SK          item
 *   TENANT#<id>      HOLD        staff asked to keep this account's data (who, why, when)
 *   TENANT#<id>      RETENTION   30-day warning sent (warnedAt, deleteOn); deletion in
 *                                progress (state=deleting, GSI1: RETENTION#DELETING)
 *   DELETED#<id>     META        proof of deletion: when, why, item counts. No personal
 *                                data (GSI1: DELETED / <deletedAt>)
 *
 * Staff audit entries (TENANT#<id> / AUDIT#...) are kept after a deletion.
 */

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db } from './data';
import type { RetentionReason } from './retention-rules';

const pk = (tenantId: string) => `TENANT#${tenantId}`;

export interface Hold {
  by: string;
  reason: string;
  at: string;
}

export async function getHold(tenantId: string): Promise<Hold | null> {
  const r = await db().send(new GetCommand({ TableName: config.adminTable, Key: { PK: pk(tenantId), SK: 'HOLD' }, ConsistentRead: true }));
  return r.Item ? { by: String(r.Item['by']), reason: String(r.Item['reason']), at: String(r.Item['at']) } : null;
}

export async function setHold(tenantId: string, hold: Hold | null): Promise<void> {
  if (!hold) {
    await db().send(new DeleteCommand({ TableName: config.adminTable, Key: { PK: pk(tenantId), SK: 'HOLD' } }));
    return;
  }
  await db().send(new PutCommand({ TableName: config.adminTable, Item: { PK: pk(tenantId), SK: 'HOLD', tenantId, ...hold } }));
}

export interface RetentionRecord {
  warnedAt?: string | undefined;
  deleteOn?: string | undefined;
  reason?: RetentionReason | undefined;
  state?: 'deleting' | undefined;
  startedAt?: string | undefined;
}

export async function getRetention(tenantId: string): Promise<RetentionRecord | null> {
  const r = await db().send(
    new GetCommand({ TableName: config.adminTable, Key: { PK: pk(tenantId), SK: 'RETENTION' }, ConsistentRead: true }),
  );
  return (r.Item as RetentionRecord | undefined) ?? null;
}

export async function recordWarning(tenantId: string, deleteOn: string, reason: RetentionReason): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: config.adminTable,
      Key: { PK: pk(tenantId), SK: 'RETENTION' },
      UpdateExpression: 'SET tenantId = :t, warnedAt = if_not_exists(warnedAt, :now), deleteOn = :on, reason = :r',
      ExpressionAttributeValues: { ':t': tenantId, ':now': new Date().toISOString(), ':on': deleteOn, ':r': reason },
    }),
  );
}

/** The seller is active again (paid, signed in): a later deletion needs a new warning. */
export async function clearWarning(tenantId: string): Promise<void> {
  await db().send(
    new DeleteCommand({
      TableName: config.adminTable,
      Key: { PK: pk(tenantId), SK: 'RETENTION' },
      // Never drop a deletion that is already under way.
      ConditionExpression: 'attribute_not_exists(#s) OR #s <> :deleting',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':deleting': 'deleting' },
    }),
  ).catch((error: unknown) => {
    if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
  });
}

/** Marked before the first step, so a deletion that stops part way is finished on the next run. */
export async function markDeleting(tenantId: string, reason: RetentionReason): Promise<void> {
  const now = new Date().toISOString();
  await db().send(
    new UpdateCommand({
      TableName: config.adminTable,
      Key: { PK: pk(tenantId), SK: 'RETENTION' },
      UpdateExpression:
        'SET tenantId = :t, #s = :deleting, startedAt = if_not_exists(startedAt, :now), reason = if_not_exists(reason, :r), GSI1PK = :g, GSI1SK = :now',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: { ':t': tenantId, ':deleting': 'deleting', ':now': now, ':r': reason, ':g': 'RETENTION#DELETING' },
    }),
  );
}

/** Deletions that started but did not finish (resumed first on every run). */
export async function listUnfinishedDeletions(): Promise<Array<{ tenantId: string; reason: RetentionReason }>> {
  const r = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :g',
      ExpressionAttributeValues: { ':g': 'RETENTION#DELETING' },
    }),
  );
  return (r.Items ?? []).map((i) => ({ tenantId: String(i['tenantId']), reason: (i['reason'] as RetentionReason) ?? 'inactive' }));
}

export interface DeletionRecord {
  tenantId: string;
  deletedAt: string;
  reason: RetentionReason;
  /** Items and files removed, per place (no names, no contents). */
  counts: Record<string, number>;
  /** Records kept for tax law, and until when (latest date). */
  keptUntil?: string | undefined;
}

export async function getDeletion(tenantId: string): Promise<DeletionRecord | null> {
  const r = await db().send(new GetCommand({ TableName: config.adminTable, Key: { PK: `DELETED#${tenantId}`, SK: 'META' } }));
  return (r.Item as DeletionRecord | undefined) ?? null;
}

/** Last step: the proof of deletion, then the in-progress marker goes. */
export async function finishDeletion(record: DeletionRecord): Promise<void> {
  await db().send(
    new PutCommand({
      TableName: config.adminTable,
      Item: { PK: `DELETED#${record.tenantId}`, SK: 'META', ...record, GSI1PK: 'DELETED', GSI1SK: record.deletedAt },
    }),
  );
  for (const SK of ['RETENTION', 'HOLD', 'STATE']) {
    await db().send(new DeleteCommand({ TableName: config.adminTable, Key: { PK: pk(record.tenantId), SK } }));
  }
}
