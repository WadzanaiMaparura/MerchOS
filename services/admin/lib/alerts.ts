/**
 * Alerts, in the admin table (merch-os-admin-<env>):
 *
 *   PK                 SK      item
 *   ALERT#<id>         META    the alert (GSI1: ALERTS#OPEN|ALERTS#RESOLVED / <startedAt>)
 *   ALERTKEY#<key>     OPEN    pointer: this check has an open alert (one at a time)
 *
 * key = "area:<areaId>" (the 15-minute health check) or "alarm:<alarmName>"
 * (a CloudWatch alarm). Opening is idempotent per key; resolving removes the
 * pointer so the next problem opens a new alert.
 */

import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db } from './data';

export type AlertStatus = 'OPEN' | 'RESOLVED';

export interface AlertNote {
  at: string;
  by: string;
  text: string;
}

export interface Alert {
  alertId: string;
  key: string;
  source: 'area' | 'alarm';
  /** Health area this belongs to, when known. */
  area?: string | undefined;
  title: string;
  description: string;
  whatToDo: string;
  status: AlertStatus;
  startedAt: string;
  lastSeenAt: string;
  resolvedAt?: string | undefined;
  /** "auto" when the check cleared by itself, otherwise the staff user id. */
  resolvedBy?: string | undefined;
  resolutionNote?: string | undefined;
  notes: AlertNote[];
}

export interface AlertInput {
  key: string;
  source: Alert['source'];
  area?: string | undefined;
  title: string;
  description: string;
  whatToDo: string;
}

const isConditional = (e: unknown) => {
  const n = (e as { name?: string }).name;
  return n === 'ConditionalCheckFailedException' || n === 'TransactionCanceledException';
};
const alertKey = (alertId: string) => ({ PK: `ALERT#${alertId}`, SK: 'META' });
const pointerKey = (key: string) => ({ PK: `ALERTKEY#${key}`, SK: 'OPEN' });

export async function getAlert(alertId: string): Promise<Alert | null> {
  const res = await db().send(new GetCommand({ TableName: config.adminTable, Key: alertKey(alertId), ConsistentRead: true }));
  return (res.Item as Alert | undefined) ?? null;
}

async function openPointer(key: string): Promise<string | null> {
  const res = await db().send(new GetCommand({ TableName: config.adminTable, Key: pointerKey(key), ConsistentRead: true }));
  return (res.Item?.['alertId'] as string | undefined) ?? null;
}

/** Opens an alert for `key`, or refreshes the one already open. */
export async function openAlert(input: AlertInput, now = new Date()): Promise<{ alert: Alert; created: boolean }> {
  const at = now.toISOString();
  const alert: Alert = { ...input, alertId: randomUUID(), status: 'OPEN', startedAt: at, lastSeenAt: at, notes: [] };
  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.adminTable,
              Item: { ...pointerKey(input.key), alertId: alert.alertId, openedAt: at },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: config.adminTable,
              Item: { ...alertKey(alert.alertId), ...alert, GSI1PK: 'ALERTS#OPEN', GSI1SK: at },
            },
          },
        ],
      }),
    );
    return { alert, created: true };
  } catch (error) {
    if (!isConditional(error)) throw error;
  }
  const existingId = await openPointer(input.key);
  if (!existingId) return openAlert(input, now); // resolved in between: open a fresh one
  const res = await db().send(
    new UpdateCommand({
      TableName: config.adminTable,
      Key: alertKey(existingId),
      UpdateExpression: 'SET lastSeenAt = :at, description = :d',
      ExpressionAttributeValues: { ':at': at, ':d': input.description },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return { alert: res.Attributes as Alert, created: false };
}

/** Resolves an open alert. Null when it was not open. */
export async function resolveAlert(alertId: string, by: string, note?: string, now = new Date()): Promise<Alert | null> {
  const alert = await getAlert(alertId);
  if (!alert || alert.status !== 'OPEN') return null;
  const at = now.toISOString();
  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.adminTable,
              Key: alertKey(alertId),
              UpdateExpression:
                'SET #s = :resolved, resolvedAt = :at, resolvedBy = :by, GSI1PK = :gpk' + (note ? ', resolutionNote = :note' : ''),
              ConditionExpression: '#s = :open',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: {
                ':resolved': 'RESOLVED',
                ':open': 'OPEN',
                ':at': at,
                ':by': by,
                ':gpk': 'ALERTS#RESOLVED',
                ...(note ? { ':note': note } : {}),
              },
            },
          },
          { Delete: { TableName: config.adminTable, Key: pointerKey(alert.key) } },
        ],
      }),
    );
  } catch (error) {
    if (isConditional(error)) return null;
    throw error;
  }
  return { ...alert, status: 'RESOLVED', resolvedAt: at, resolvedBy: by, ...(note ? { resolutionNote: note } : {}) };
}

/** Resolves whatever is open for `key` (used when a check clears by itself). */
export async function resolveByKey(key: string, now = new Date()): Promise<Alert | null> {
  const alertId = await openPointer(key);
  if (!alertId) return null;
  const resolved = await resolveAlert(alertId, 'auto', undefined, now);
  if (!resolved) {
    // Stale pointer (alert already resolved by staff): tidy it up.
    await db().send(new DeleteCommand({ TableName: config.adminTable, Key: pointerKey(key) }));
  }
  return resolved;
}

export async function addNote(alertId: string, by: string, text: string, now = new Date()): Promise<Alert | null> {
  try {
    const res = await db().send(
      new UpdateCommand({
        TableName: config.adminTable,
        Key: alertKey(alertId),
        UpdateExpression: 'SET notes = list_append(if_not_exists(notes, :empty), :note)',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':empty': [], ':note': [{ at: now.toISOString(), by, text }] },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return res.Attributes as Alert;
  } catch (error) {
    if (isConditional(error)) return null;
    throw error;
  }
}

export async function listAlerts(status: AlertStatus, limit = 100): Promise<Alert[]> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `ALERTS#${status}` },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []) as Alert[];
}

export async function countOpen(): Promise<number> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.adminTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'ALERTS#OPEN' },
      Select: 'COUNT',
    }),
  );
  return res.Count ?? 0;
}

/** @internal tests and live-check cleanup */
export async function _deleteAlert(alert: Pick<Alert, 'alertId' | 'key'>): Promise<void> {
  await db().send(new DeleteCommand({ TableName: config.adminTable, Key: alertKey(alert.alertId) }));
  await db().send(new DeleteCommand({ TableName: config.adminTable, Key: pointerKey(alert.key) }));
}

