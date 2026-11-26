import { beforeEach, describe, expect, it } from 'vitest';
import { _setDb } from '../lib/store';
import { addNotification, listNotifications, markAllRead, markRead } from '../lib/notifications';
import * as texts from '../lib/notification-texts';

process.env['ENGAGEMENT_TABLE'] = 'engagement-test';

/** Minimal in-memory DynamoDB for the commands lib/notifications sends, with real condition outcomes. */
const table = new Map<string, Record<string, unknown>>();
const k = (key: { PK: unknown; SK: unknown }) => `${key.PK}|${key.SK}`;
const conditional = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });

const fakeDb = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const i = cmd.input;
    switch (cmd.constructor.name) {
      case 'TransactWriteCommand': {
        for (const t of i.TransactItems) {
          if (t.Put.ConditionExpression && table.has(k(t.Put.Item))) {
            throw Object.assign(new Error('cancelled'), { name: 'TransactionCanceledException' });
          }
        }
        for (const t of i.TransactItems) table.set(k(t.Put.Item), { ...t.Put.Item });
        return {};
      }
      case 'GetCommand':
        return { Item: table.get(k(i.Key)) };
      case 'QueryCommand': {
        const pk = i.ExpressionAttributeValues[':pk'];
        const prefix = i.ExpressionAttributeValues[':p'];
        const items = [...table.values()]
          .filter((x) => x['PK'] === pk && String(x['SK']).startsWith(prefix))
          .sort((a, b) => String(b['SK']).localeCompare(String(a['SK'])))
          .slice(0, i.Limit);
        return { Items: items };
      }
      case 'UpdateCommand': {
        const existing = table.get(k(i.Key));
        if (i.ConditionExpression === 'attribute_exists(PK)' && !existing) throw conditional();
        const item = existing ?? { ...i.Key };
        if (String(i.UpdateExpression).includes('readAt')) item['readAt'] ??= i.ExpressionAttributeValues[':now'];
        if (String(i.UpdateExpression).includes('lastReadAt')) item['lastReadAt'] = i.ExpressionAttributeValues[':now'];
        table.set(k(i.Key), item);
        return {};
      }
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  },
};

const T = '7e22ed36-cf82-4ba2-b194-8bd4cfab5166';
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

beforeEach(() => {
  table.clear();
  _setDb(fakeDb as never);
});

describe('seller notification store', () => {
  it('stores one per key (a repeated event is ignored), newest first, with a 90-day expiry', async () => {
    expect(await addNotification(T, texts.importFailed('job-1', false, iso(10)))).toBe(true);
    expect(await addNotification(T, texts.importFailed('job-1', false, iso(10)))).toBe(false);
    await addNotification(T, texts.paymentReceived('pay-1', 'Starter', '2026-12-25T10:00:00.000Z', iso(1)));
    const { notifications, unreadCount } = await listNotifications(T);
    expect(notifications.map((n) => n.title)).toEqual(['Payment received', 'Import failed']);
    expect(unreadCount).toBe(2);
    const stored = [...table.values()].find((x) => String(x['SK']).startsWith('NOTIF#'))!;
    const days = ((stored['expiresAt'] as number) - Date.parse(String(stored['at'])) / 1000) / 86400;
    expect(Math.round(days)).toBe(90);
  });

  it('opening one marks only that one read; "mark all" marks everything so far', async () => {
    await addNotification(T, texts.importFailed('job-1', false, iso(10)));
    await addNotification(T, texts.importFailed('job-2', false, iso(5)));
    const first = (await listNotifications(T)).notifications;
    await markRead(T, [first[1]!.id, 'not-an-id', '../../x']);
    const after = await listNotifications(T);
    expect(after.notifications.map((n) => n.read)).toEqual([false, true]);
    expect(after.unreadCount).toBe(1);

    await markAllRead(T);
    expect((await listNotifications(T)).unreadCount).toBe(0);
  });

  it('refuses keys that could break the sort key', async () => {
    await expect(addNotification(T, { ...texts.importFailed('x', false, iso(1)), key: 'bad key/../' })).rejects.toThrow(
      'Invalid notification key',
    );
  });

  it('another seller never sees them', async () => {
    await addNotification(T, texts.importFailed('job-1', false, iso(1)));
    expect((await listNotifications('11111111-1111-4111-8111-111111111111')).notifications).toEqual([]);
  });
});

describe('notification wording', () => {
  const all = [
    texts.importCompleted('j1', { created: 48, updated: 3, duplicates: 1, validationFailed: 2 }, iso(1)),
    texts.importCompleted('j2', { created: 1, updated: 0, duplicates: 0, validationFailed: 1 }, iso(1)),
    texts.importFailed('j3', true, iso(1)),
    texts.imageRejected('i1', 'p1', 'Ceramic mug, blue', iso(1)),
    texts.imageFailed('i2', 'p1', null, iso(1)),
    texts.paymentReceived('pay', 'Starter', '2026-12-25T10:00:00.000Z', iso(1)),
    texts.referralEarned('r1', iso(1)),
    texts.referralApplied('r1', '2027-01-25T10:00:00.000Z', iso(1)),
    texts.paymentDue('2026-12-25T10:00:00.000Z', false, iso(1)),
    texts.paymentDue('2026-12-25T10:00:00.000Z', true, iso(1)),
    texts.planPausedNote('2026-12-25T10:00:00.000Z', '2027-01-31T10:00:00.000Z', iso(1)),
    texts.closingSoon('2026-12-25T10:00:00.000Z', '2027-01-31T10:00:00.000Z', iso(1)),
    texts.trialUsage(12, 15, iso(1)),
    texts.trialUsage(15, 15, iso(1)),
  ];

  it('reads naturally', () => {
    expect(all[0]!.message).toBe('48 products added, 3 updated, 1 duplicate skipped. 2 rows need fixing.');
    expect(all[1]!.message).toBe('1 product added, 0 updated. 1 row needs fixing.');
    expect(all[3]!.message).toContain('on "Ceramic mug, blue"');
    expect(all[4]!.message).toContain('on one of your products');
    expect(all[5]!.message).toBe('Starter plan. You are paid up until 25 December 2026.');
    expect(all[12]).toMatchObject({ title: 'Free trial: 12 of 15 products used', message: '3 free products left. Pick a plan to keep adding.' });
    expect(all[13]).toMatchObject({ title: 'Free trial used up', key: 'trial-used' });
  });

  it('no em dashes, no "AI", and every link is a dashboard path', () => {
    for (const n of all) {
      expect(`${n.title} ${n.message}`).not.toMatch(/\u2014|\bAI\b/);
      expect(n.link).toMatch(/^\/(imports|products|billing|referrals)(\/|$)/);
    }
  });
});
