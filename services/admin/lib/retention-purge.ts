/**
 * Deletes one seller account's data (the data retention job, handlers/data-retention.ts).
 *
 * Order: sign-in first (nobody can use the account while it is being removed),
 * then the records, then the files. Every step can run again safely, and a
 * deletion that stops part way is finished on the next run (retention-store
 * marks it before the first step).
 *
 *   Cognito         every user of the account
 *   engagement      profile, emails sent, notifications, referrals, referral code,
 *                   feedback; the referrer's record loses this seller's name; a
 *                   PUBLISHED review stays on the website, no longer linked to an
 *                   account (agreed); unpublished reviews are deleted
 *   tenants         business profile, owner profile, consent, and the email, phone
 *                   and business-name claims (the seller can sign up again)
 *   products, inventory, stock history, suppliers, imports, photos jobs,
 *   generated listings and usage, invitations: everything under the account
 *   billing         KEPT for tax law: invoices, payments, subscription summary,
 *                   free months; each gets an expiry INVOICE_RETENTION_YEARS after
 *                   its date (DynamoDB deletes it then). Deleted now: billing
 *                   details, unpaid checkouts, monthly credit usage. The card token
 *                   is removed from the subscription.
 *   S3              raw uploads, photos and exports, EVERY version (the buckets are
 *                   versioned: a plain delete would only hide them). Invoice PDFs
 *                   stay; the invoices bucket expires them by the same rule.
 *
 * Refuses (RetentionBlockedError) while a card subscription is still active at
 * PayFast: it would keep charging. Staff cancel it first.
 */

import { BatchWriteCommand, DeleteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from '@aws-sdk/client-s3';
import { claimKeys } from '../../auth/registration/identity-claims';
import { config, retentionConfig } from './config';
import { deleteUser, type SellerUser } from './cognito';
import { db } from './data';

/**
 * SARS (Tax Administration Act s29): 5 years from when the return was
 * SUBMITTED, which can be up to a year after the invoice. Counted from the
 * record's own date, 6 years covers that.
 */
export const INVOICE_RETENTION_YEARS = 6;

export class RetentionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetentionBlockedError';
  }
}

let s3: S3Client | undefined;
/** @internal tests only */
export function _setS3(value: S3Client | undefined): void {
  s3 = value;
}
const s3c = () => (s3 ??= new S3Client({}));

type Item = Record<string, unknown>;
const pk = (tenantId: string) => `TENANT#${tenantId}`;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All keys of one partition (optionally only some sort keys), every page. */
async function partitionKeys(table: string, PK: string): Promise<Array<{ PK: string; SK: string; item: Item }>> {
  const out: Array<{ PK: string; SK: string; item: Item }> = [];
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 10_000; page++) {
    const r = await db().send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': PK },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const i of r.Items ?? []) out.push({ PK: String(i['PK']), SK: String(i['SK']), item: i });
    startKey = r.LastEvaluatedKey;
    if (!startKey) break;
  }
  return out;
}

async function deleteKeys(table: string, keys: Array<{ PK: string; SK: string }>): Promise<number> {
  for (let i = 0; i < keys.length; i += 25) {
    let pending: Array<Record<string, unknown>> | undefined = keys
      .slice(i, i + 25)
      .map((k) => ({ DeleteRequest: { Key: { PK: k.PK, SK: k.SK } } }));
    for (let attempt = 0; pending && pending.length; attempt++) {
      if (attempt >= 8) throw new Error(`Could not delete every item in ${table}`);
      if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const res = await db().send(new BatchWriteCommand({ RequestItems: { [table]: pending as never } }));
      pending = res.UnprocessedItems?.[table] as Array<Record<string, unknown>> | undefined;
    }
  }
  return keys.length;
}

/** Deletes a whole partition (or the part `keep` does not protect). */
async function deletePartition(table: string, PK: string, keep: (sk: string) => boolean = () => false): Promise<number> {
  const keys = (await partitionKeys(table, PK)).filter((k) => !keep(k.SK));
  return deleteKeys(table, keys);
}

/** Every version and delete marker under the prefix. */
async function deletePrefix(bucket: string, prefix: string): Promise<number> {
  if (!prefix.endsWith('/') || prefix.length < 10) throw new Error('Refusing a short prefix');
  let count = 0;
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  for (let page = 0; page < 100_000; page++) {
    const r = await s3c().send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 1000,
        ...(keyMarker ? { KeyMarker: keyMarker } : {}),
        ...(versionMarker ? { VersionIdMarker: versionMarker } : {}),
      }),
    );
    const objects = [...(r.Versions ?? []), ...(r.DeleteMarkers ?? [])]
      .filter((v) => v.Key?.startsWith(prefix))
      .map((v) => ({ Key: v.Key!, ...(v.VersionId ? { VersionId: v.VersionId } : {}) }));
    for (let i = 0; i < objects.length; i += 1000) {
      const res = await s3c().send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects.slice(i, i + 1000), Quiet: true } }),
      );
      if (res.Errors?.length) throw new Error(`S3 refused ${res.Errors.length} deletions in ${bucket}`);
    }
    count += objects.length;
    if (!r.IsTruncated) break;
    keyMarker = r.NextKeyMarker;
    versionMarker = r.NextVersionIdMarker;
  }
  return count;
}

const epochAfterYears = (iso: string, years: number): number => {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return Math.floor(d.getTime() / 1000);
};

const CARD_ACTIVE =
  'A card subscription is still active at PayFast. Cancel it before the data can be deleted.';

/** A live card subscription would keep charging: never delete under it. */
export async function assertNoActiveCard(tenantId: string): Promise<void> {
  const r = await db().send(
    new GetCommand({ TableName: config.billingTable, Key: { PK: pk(tenantId), SK: 'SUBSCRIPTION#current' }, ConsistentRead: true }),
  );
  const s = r.Item;
  if (s && s['autoRenew'] === true && str(s['payfastToken']) && !str(s['cancelledAt'])) throw new RetentionBlockedError(CARD_ACTIVE);
}

/** Billing: keep the tax records (with an expiry), delete the rest. */
async function billing(tenantId: string, now: Date): Promise<{ deleted: number; kept: number; keptUntil?: string }> {
  const items = await partitionKeys(config.billingTable, pk(tenantId));
  const isTaxRecord = (sk: string) => /^(INVOICE#|PAYMENT#|CREDIT#|SUBSCRIPTION#current$)/.test(sk);
  const dateOf = (i: Item) => str(i['createdAt']) ?? str(i['periodStart']) ?? str(i['updatedAt']) ?? now.toISOString();
  const tax = items.filter((i) => isTaxRecord(i.SK));
  const latest = tax.map((i) => dateOf(i.item)).sort().at(-1) ?? now.toISOString();

  let keptUntil = 0;
  for (const t of tax) {
    // The subscription summary and free months explain the amounts on the invoices: keep them as long as the last one.
    const from = t.SK.startsWith('INVOICE#') || t.SK.startsWith('PAYMENT#') ? dateOf(t.item) : latest;
    const ttl = epochAfterYears(from, INVOICE_RETENTION_YEARS);
    keptUntil = Math.max(keptUntil, ttl);
    await db().send(
      new UpdateCommand({
        TableName: config.billingTable,
        Key: { PK: t.PK, SK: t.SK },
        UpdateExpression: `SET #ttl = :ttl, accountDeleted = :true${t.SK === 'SUBSCRIPTION#current' ? ' REMOVE payfastToken' : ''}`,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ttl': ttl, ':true': true },
      }),
    );
  }
  const deleted = await deleteKeys(
    config.billingTable,
    items.filter((i) => !isTaxRecord(i.SK)),
  );
  return { deleted, kept: tax.length, ...(keptUntil ? { keptUntil: new Date(keptUntil * 1000).toISOString() } : {}) };
}

async function engagement(tenantId: string): Promise<number> {
  const table = config.engagementTable;
  const items = await partitionKeys(table, pk(tenantId));
  const profile = items.find((i) => i.SK === 'PROFILE')?.item;
  const pointer = items.find((i) => i.SK === 'REVIEW')?.item;
  let extra = 0;

  const reviewId = str(pointer?.['reviewId']);
  if (reviewId) {
    const r = await db().send(new GetCommand({ TableName: table, Key: { PK: `REVIEW#${reviewId}`, SK: 'META' } }));
    if (r.Item?.['status'] === 'APPROVED') {
      // Published with the seller's consent: stays on the website, no longer linked to an account.
      await db().send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: `REVIEW#${reviewId}`, SK: 'META' },
          UpdateExpression: 'SET accountDeleted = :true REMOVE tenantId',
          ExpressionAttributeValues: { ':true': true },
        }),
      );
    } else if (r.Item) {
      await db().send(new DeleteCommand({ TableName: table, Key: { PK: `REVIEW#${reviewId}`, SK: 'META' } }));
      extra++;
    }
  }
  const code = str(profile?.['referralCode']);
  if (code) {
    await db().send(new DeleteCommand({ TableName: table, Key: { PK: `REFCODE#${code}`, SK: 'META' } }));
    extra++;
  }
  const referrer = str(profile?.['referredByTenantId']);
  if (referrer && UUID.test(referrer)) {
    // The referrer keeps their free-month record, without this seller's name.
    await db()
      .send(
        new UpdateCommand({
          TableName: table,
          Key: { PK: pk(referrer), SK: `REFERRAL#${tenantId}` },
          UpdateExpression: 'SET referredDeleted = :true REMOVE referredBusiness',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':true': true },
        }),
      )
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      });
  }
  return extra + (await deleteKeys(table, items));
}

async function tenantRecords(tenantId: string, users: SellerUser[]): Promise<number> {
  const table = config.tenantsTable;
  const items = await partitionKeys(table, pk(tenantId));
  const meta = items.find((i) => i.SK === 'METADATA')?.item;
  const org = str(meta?.['organisationName']) ?? '';
  const profiles = items.filter((i) => i.SK.startsWith('PROFILE#')).map((i) => i.item);

  // The "already registered" claims, for every email and phone we know of.
  const identities = [
    ...profiles.map((p) => ({ email: str(p['email']) ?? '', phoneNumber: str(p['phoneNumber']) ?? '', organisationName: org })),
    ...users.map((u) => ({ email: u.email, phoneNumber: '', organisationName: org })),
  ];
  const claimPKs = new Set(identities.flatMap((id) => claimKeys(id).map((k) => k.PK)));
  let claims = 0;
  for (const PK of claimPKs) {
    try {
      // Only this account's own claim (another account may hold the same business name).
      await db().send(
        new DeleteCommand({
          TableName: table,
          Key: { PK, SK: 'CLAIM' },
          ConditionExpression: 'tenantId = :t',
          ExpressionAttributeValues: { ':t': tenantId },
        }),
      );
      claims++;
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
    }
  }
  return claims + (await deleteKeys(table, items));
}

export interface PurgeResult {
  counts: Record<string, number>;
  keptUntil?: string | undefined;
}

export async function purgeTenant(tenantId: string, users: SellerUser[], now: Date = new Date()): Promise<PurgeResult> {
  if (!UUID.test(tenantId)) throw new Error('Invalid tenant id');
  const t = retentionConfig.tables;
  const b = retentionConfig.buckets;
  const counts: Record<string, number> = {};

  // Checked before anything is removed.
  await assertNoActiveCard(tenantId);

  for (const u of users.filter((u) => u.tenantId === tenantId)) await deleteUser(u.userId);
  counts['signInAccounts'] = users.filter((u) => u.tenantId === tenantId).length;

  counts['engagement'] = await engagement(tenantId);
  counts['account'] = await tenantRecords(tenantId, users.filter((u) => u.tenantId === tenantId));
  counts['products'] = await deletePartition(config.productsTable, pk(tenantId));
  counts['inventory'] = await deletePartition(t.inventory, pk(tenantId));
  counts['stockHistory'] = await deletePartition(t.inventoryTransactions, pk(tenantId));
  counts['suppliers'] = await deletePartition(t.suppliers, pk(tenantId));
  counts['imports'] = await deletePartition(t.importJobs, pk(tenantId));
  counts['photoJobs'] = await deletePartition(t.imageJobs, pk(tenantId));
  counts['listings'] =
    (await deletePartition(t.intelligence, pk(tenantId))) + (await deletePartition(t.intelligence, `${pk(tenantId)}#USAGE`));
  counts['invitations'] = await deletePartition(t.invitations, pk(tenantId));

  const bill = await billing(tenantId, now);
  counts['billingDeleted'] = bill.deleted;
  counts['billingKeptForTax'] = bill.kept;

  counts['files'] =
    (await deletePrefix(b.rawUploads, `suppliers/${tenantId}/`)) +
    (await deletePrefix(b.rawUploads, `images/${tenantId}/`)) +
    (await deletePrefix(b.assets, `assets/${tenantId}/`)) +
    (await deletePrefix(b.assets, `images/${tenantId}/`)) +
    (await deletePrefix(b.exports, `tenants/${tenantId}/`));

  return { counts, ...(bill.keptUntil ? { keptUntil: bill.keptUntil } : {}) };
}
