import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory tables and buckets with the few DynamoDB/S3 behaviours the purge
 * relies on (partition queries, batch deletes, conditional deletes/updates,
 * versioned listings). The real IAM and conditions are exercised in AWS.
 */
const mem = vi.hoisted(() => ({
  tables: new Map<string, Map<string, Record<string, any>>>(),
  buckets: new Map<string, Array<{ Key: string; VersionId: string; marker?: boolean }>>(),
  deletedUsers: [] as string[],
}));

vi.mock('../lib/cognito', () => ({
  deleteUser: vi.fn(async (id: string) => {
    mem.deletedUsers.push(id);
  }),
}));

const conditional = () => Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' });
const table = (name: string) => {
  if (!mem.tables.has(name)) mem.tables.set(name, new Map());
  return mem.tables.get(name)!;
};
const key = (k: { PK: string; SK: string }) => `${k.PK}|${k.SK}`;

function checkCondition(item: Record<string, any> | undefined, expr: string | undefined, values: Record<string, any> = {}) {
  if (!expr) return;
  if (expr.includes('attribute_exists(PK)') && !item) throw conditional();
  if (expr.includes('tenantId = :t') && item?.['tenantId'] !== values[':t']) throw conditional();
}

function applyUpdate(item: Record<string, any>, expr: string, values: Record<string, any>, names: Record<string, string> = {}) {
  const [setPart, removePart] = expr.split(/\s+REMOVE\s+/);
  for (const a of (setPart ?? '').replace(/^SET\s+/, '').split(/,\s*(?![^()]*\))/)) {
    const m = a.match(/^\s*([#\w]+)\s*=\s*(?:if_not_exists\([^,]+,\s*)?(:\w+)\)?\s*$/);
    if (m) item[names[m[1]!] ?? m[1]!] = values[m[2]!];
  }
  for (const r of (removePart ?? '').split(',').map((s) => s.trim()).filter(Boolean)) delete item[names[r] ?? r];
}

const fakeDb = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const i = cmd.input;
    switch (cmd.constructor.name) {
      case 'QueryCommand': {
        const pk = i.ExpressionAttributeValues[':pk'];
        return { Items: [...table(i.TableName).values()].filter((x) => x['PK'] === pk) };
      }
      case 'GetCommand':
        return { Item: table(i.TableName).get(key(i.Key)) };
      case 'BatchWriteCommand': {
        for (const [t, reqs] of Object.entries(i.RequestItems as Record<string, Array<{ DeleteRequest: { Key: any } }>>)) {
          for (const r of reqs) table(t).delete(key(r.DeleteRequest.Key));
        }
        return { UnprocessedItems: {} };
      }
      case 'DeleteCommand': {
        checkCondition(table(i.TableName).get(key(i.Key)), i.ConditionExpression, i.ExpressionAttributeValues);
        table(i.TableName).delete(key(i.Key));
        return {};
      }
      case 'UpdateCommand': {
        const existing = table(i.TableName).get(key(i.Key));
        checkCondition(existing, i.ConditionExpression, i.ExpressionAttributeValues);
        const item = existing ?? { ...i.Key };
        applyUpdate(item, i.UpdateExpression, i.ExpressionAttributeValues ?? {}, i.ExpressionAttributeNames);
        table(i.TableName).set(key(i.Key), item);
        return {};
      }
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  },
};

const fakeS3 = {
  send: async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
    const i = cmd.input;
    const objs = mem.buckets.get(i.Bucket) ?? [];
    if (cmd.constructor.name === 'ListObjectVersionsCommand') {
      const mine = objs.filter((o) => o.Key.startsWith(i.Prefix));
      return {
        Versions: mine.filter((o) => !o.marker).map((o) => ({ Key: o.Key, VersionId: o.VersionId })),
        DeleteMarkers: mine.filter((o) => o.marker).map((o) => ({ Key: o.Key, VersionId: o.VersionId })),
        IsTruncated: false,
      };
    }
    if (cmd.constructor.name === 'DeleteObjectsCommand') {
      const drop = new Set((i.Delete.Objects as Array<{ Key: string; VersionId: string }>).map((o) => `${o.Key}@${o.VersionId}`));
      mem.buckets.set(i.Bucket, objs.filter((o) => !drop.has(`${o.Key}@${o.VersionId}`)));
      return { Errors: [] };
    }
    throw new Error(`unexpected ${cmd.constructor.name}`);
  },
};

import { _setDb } from '../lib/data';
import { INVOICE_RETENTION_YEARS, RetentionBlockedError, _setS3, purgeTenant } from '../lib/retention-purge';

const T = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const OTHER = '11111111-1111-4111-8111-111111111111';
const REFERRER = '22222222-2222-4222-8222-222222222222';
const env = {
  TENANTS_TABLE: 'tenants', PRODUCTS_TABLE: 'products', BILLING_TABLE: 'billing', ENGAGEMENT_TABLE: 'engagement', ADMIN_TABLE: 'admin',
  INVENTORY_TABLE: 'inventory', INVENTORY_TRANSACTIONS_TABLE: 'inventory-txn', SUPPLIERS_TABLE: 'suppliers', IMPORT_JOBS_TABLE: 'imports',
  IMAGE_JOBS_TABLE: 'image-jobs', INTELLIGENCE_TABLE: 'intelligence', INVITATIONS_TABLE: 'invitations',
  RAW_UPLOADS_BUCKET: 'raw', ASSETS_BUCKET: 'assets', EXPORTS_BUCKET: 'exports',
};
Object.assign(process.env, env);

const put = (t: string, item: Record<string, any>) => table(t).set(key(item as never), item);
const users = [
  { userId: 'u-owner', email: 'Thandi.K+shop@gmail.com', emailVerified: true, tenantId: T, status: 'CONFIRMED', enabled: true, createdAt: '' },
  { userId: 'u-team', email: 'sipho@example.co.za', emailVerified: true, tenantId: T, status: 'CONFIRMED', enabled: true, createdAt: '' },
  { userId: 'u-other', email: 'other@example.co.za', emailVerified: true, tenantId: OTHER, status: 'CONFIRMED', enabled: true, createdAt: '' },
];

function seed() {
  mem.tables.clear();
  mem.buckets.clear();
  mem.deletedUsers.length = 0;
  const p = `TENANT#${T}`;
  put('tenants', { PK: p, SK: 'METADATA', tenantId: T, organisationName: 'Thandi Home Goods (Pty) Ltd', ownerId: 'u-owner' });
  put('tenants', { PK: p, SK: 'PROFILE#USER#u-owner', email: 'thandi.k@gmail.com', phoneNumber: '+27 82 000 0000' });
  put('tenants', { PK: p, SK: 'CONSENT#USER#u-owner', granted: true });
  put('tenants', { PK: 'CLAIM#EMAIL#thandik@gmail.com', SK: 'CLAIM', tenantId: T });
  put('tenants', { PK: 'CLAIM#PHONE#+27820000000', SK: 'CLAIM', tenantId: T });
  // Same business name claimed by ANOTHER account first: must stay.
  put('tenants', { PK: 'CLAIM#ORG#thandi home goods', SK: 'CLAIM', tenantId: OTHER });
  put('tenants', { PK: `TENANT#${OTHER}`, SK: 'METADATA', tenantId: OTHER });

  for (const [t, sk] of [
    ['products', 'PRODUCT#p1'], ['products', 'PRODUCT#p1#ENRICHMENT'], ['products', 'ENTITLEMENT#trial'],
    ['inventory', 'SKU#A#WH#1'], ['inventory-txn', 'TXN#1'], ['suppliers', 'SUPPLIER#s1'], ['imports', 'IMPORT#j1'],
    ['image-jobs', 'IMAGEJOB#i1'], ['intelligence', 'RESULT#r1'], ['invitations', 'INVITE#a@b.c'],
  ] as const) put(t, { PK: p, SK: sk });
  put('intelligence', { PK: `${p}#USAGE`, SK: 'MONTH#202611' });
  put('products', { PK: `TENANT#${OTHER}`, SK: 'PRODUCT#keep' });

  put('engagement', { PK: p, SK: 'PROFILE', referralCode: 'THANDI7K', referredByTenantId: REFERRER });
  put('engagement', { PK: p, SK: 'SENT#trial-welcome' });
  put('engagement', { PK: p, SK: 'REVIEW', reviewId: 'rev-1' });
  put('engagement', { PK: p, SK: 'ACTIVITY', lastActiveAt: '2026-01-01' });
  put('engagement', { PK: 'REVIEW#rev-1', SK: 'META', tenantId: T, status: 'APPROVED', displayName: 'Thandi K.', text: 'Great' });
  put('engagement', { PK: 'REFCODE#THANDI7K', SK: 'META', tenantId: T });
  put('engagement', { PK: `TENANT#${REFERRER}`, SK: `REFERRAL#${T}`, referredBusiness: 'Thandi Home Goods', reward: 'APPLIED' });

  put('billing', { PK: p, SK: 'SUBSCRIPTION#current', autoRenew: false, payfastToken: 'tok', cancelledAt: '2027-01-01', updatedAt: '2027-01-01T00:00:00.000Z' });
  put('billing', { PK: p, SK: 'INVOICE#i1', createdAt: '2026-12-01T00:00:00.000Z', buyerSnapshot: { name: 'Thandi' } });
  put('billing', { PK: p, SK: 'PAYMENT#m1', createdAt: '2026-12-01T00:00:00.000Z' });
  put('billing', { PK: p, SK: 'CREDIT#REF-x', createdAt: '2026-11-01T00:00:00.000Z' });
  put('billing', { PK: p, SK: 'PROFILE#billing', vatNumber: '4000000000' });
  put('billing', { PK: p, SK: 'CHECKOUT#m2' });
  put('billing', { PK: p, SK: 'CREDITS#202612' });
  put('billing', { PK: 'COUNTER#INVOICE', SK: 'META', value: 16800 });

  mem.buckets.set('raw', [
    { Key: `suppliers/${T}/s1/files/j1/a.csv`, VersionId: 'v1' },
    { Key: `suppliers/${T}/s1/files/j1/a.csv`, VersionId: 'v2' },
    { Key: `images/${T}/p1/source/x.jpg`, VersionId: 'v1', marker: true },
    { Key: `suppliers/${OTHER}/s9/files/j9/keep.csv`, VersionId: 'v1' },
  ]);
  mem.buckets.set('assets', [{ Key: `images/${T}/p1/takealot/800x800.jpg`, VersionId: 'v1' }, { Key: `assets/${T}/s1/j1/a.jpg`, VersionId: 'v1' }]);
  mem.buckets.set('exports', [{ Key: `tenants/${T}/exports/e1/f.csv`, VersionId: 'v1' }]);
}

beforeEach(() => {
  seed();
  _setDb(fakeDb as never);
  _setS3(fakeS3 as never);
});

const left = (t: string, pk: string) => [...table(t).values()].filter((x) => x['PK'] === pk).map((x) => x['SK']);

describe('deleting one seller account', () => {
  it('removes everything that is the account, every file version, and the sign-in accounts', async () => {
    const r = await purgeTenant(T, users as never, new Date('2028-02-08T01:00:00Z'));
    const p = `TENANT#${T}`;
    expect(mem.deletedUsers.sort()).toEqual(['u-owner', 'u-team']);
    for (const t of ['tenants', 'products', 'inventory', 'inventory-txn', 'suppliers', 'imports', 'image-jobs', 'intelligence', 'invitations', 'engagement']) {
      expect(left(t, p)).toEqual([]);
    }
    expect(left('intelligence', `${p}#USAGE`)).toEqual([]);
    expect(mem.buckets.get('raw')!.map((o) => o.Key)).toEqual([`suppliers/${OTHER}/s9/files/j9/keep.csv`]);
    expect(mem.buckets.get('assets')).toEqual([]);
    expect(mem.buckets.get('exports')).toEqual([]);
    expect(r.counts['files']).toBe(6);
    expect(r.counts['signInAccounts']).toBe(2);
  });

  it('never touches another account', async () => {
    await purgeTenant(T, users as never);
    expect(left('products', `TENANT#${OTHER}`)).toEqual(['PRODUCT#keep']);
    expect(left('tenants', `TENANT#${OTHER}`)).toEqual(['METADATA']);
    expect(mem.deletedUsers).not.toContain('u-other');
    expect(table('tenants').get('CLAIM#ORG#thandi home goods|CLAIM')?.['tenantId']).toBe(OTHER);
  });

  it('frees the email and phone so the seller can sign up again', async () => {
    await purgeTenant(T, users as never);
    expect(table('tenants').has('CLAIM#EMAIL#thandik@gmail.com|CLAIM')).toBe(false);
    expect(table('tenants').has('CLAIM#PHONE#+27820000000|CLAIM')).toBe(false);
  });

  it('keeps the published review, unlinked; deletes the referral code; the referrer keeps the record without the name', async () => {
    await purgeTenant(T, users as never);
    const review = table('engagement').get('REVIEW#rev-1|META')!;
    expect(review).toMatchObject({ status: 'APPROVED', displayName: 'Thandi K.', text: 'Great', accountDeleted: true });
    expect(review['tenantId']).toBeUndefined();
    expect(table('engagement').has('REFCODE#THANDI7K|META')).toBe(false);
    const ref = table('engagement').get(`TENANT#${REFERRER}|REFERRAL#${T}`)!;
    expect(ref).toMatchObject({ reward: 'APPLIED', referredDeleted: true });
    expect(ref['referredBusiness']).toBeUndefined();
  });

  it('an unpublished review is deleted', async () => {
    table('engagement').get('REVIEW#rev-1|META')!['status'] = 'PENDING';
    await purgeTenant(T, users as never);
    expect(table('engagement').has('REVIEW#rev-1|META')).toBe(false);
  });

  it(`keeps invoices, payments, subscription and free months for ${INVOICE_RETENTION_YEARS} years (expiry set), deletes billing details`, async () => {
    const r = await purgeTenant(T, users as never);
    expect(left('billing', `TENANT#${T}`).sort()).toEqual(['CREDIT#REF-x', 'INVOICE#i1', 'PAYMENT#m1', 'SUBSCRIPTION#current']);
    const inv = table('billing').get(`TENANT#${T}|INVOICE#i1`)!;
    expect(new Date(inv['ttl'] * 1000).toISOString()).toBe('2032-12-01T00:00:00.000Z');
    expect(inv['buyerSnapshot']).toEqual({ name: 'Thandi' });
    const sub = table('billing').get(`TENANT#${T}|SUBSCRIPTION#current`)!;
    expect(sub['payfastToken']).toBeUndefined();
    // Summary and free months: as long as the latest tax record (the subscription changed on 1 Jan 2027).
    expect(new Date(sub['ttl'] * 1000).toISOString()).toBe('2033-01-01T00:00:00.000Z');
    expect(table('billing').has('COUNTER#INVOICE|META')).toBe(true);
    expect(r.keptUntil).toBe('2033-01-01T00:00:00.000Z');
  });

  it('refuses, before deleting anything, while a card subscription is still active', async () => {
    Object.assign(table('billing').get(`TENANT#${T}|SUBSCRIPTION#current`)!, { autoRenew: true, cancelledAt: undefined });
    await expect(purgeTenant(T, users as never)).rejects.toBeInstanceOf(RetentionBlockedError);
    expect(mem.deletedUsers).toEqual([]);
    expect(left('products', `TENANT#${T}`)).toHaveLength(3);
  });

  it('running again after it finished changes nothing and does not fail', async () => {
    await purgeTenant(T, users as never);
    const again = await purgeTenant(T, [] as never);
    expect(again.counts['products']).toBe(0);
    expect(again.counts['files']).toBe(0);
  });

  it('refuses a malformed tenant id', async () => {
    await expect(purgeTenant('../x', users as never)).rejects.toThrow('Invalid tenant id');
  });
});
