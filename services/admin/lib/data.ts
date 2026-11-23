/**
 * Read-only lookups in other services' tables (all PK = TENANT#<tenantId>):
 *
 *   tenants     METADATA (business, owner), PROFILE#USER#<id> (name, phone), CONSENT#USER#<id>
 *   products    PRODUCT#<id> (count), ENTITLEMENT#trial (trial / subscribed / exempt)
 *   billing     SUBSCRIPTION#current, INVOICE#<id>
 *   engagement  PROFILE, SENT#<email>, REFERRAL#<referred>, REVIEW (+ REVIEW#<id>/META)
 *
 * The only write outside this service's own table is the trial exemption
 * (lib/exempt.ts).
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';

let client: DynamoDBDocumentClient | undefined;
export function db(): DynamoDBDocumentClient {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  return client;
}

/** @internal tests only */
export function _setDb(value: DynamoDBDocumentClient | undefined): void {
  client = value;
}

type Item = Record<string, unknown>;
const pk = (tenantId: string) => `TENANT#${tenantId}`;
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** BatchGet across one table (chunks of 100, retries unprocessed keys). */
async function batchGet(table: string, keys: Array<{ PK: string; SK: string }>): Promise<Item[]> {
  const out: Item[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    let pending: Array<Record<string, unknown>> | undefined = keys.slice(i, i + 100);
    for (let attempt = 0; pending && pending.length && attempt < 5; attempt++) {
      const res = await db().send(new BatchGetCommand({ RequestItems: { [table]: { Keys: pending } } }));
      out.push(...((res.Responses?.[table] ?? []) as Item[]));
      pending = res.UnprocessedKeys?.[table]?.Keys as Array<Record<string, unknown>> | undefined;
    }
  }
  return out;
}

// ─── Tenants ─────────────────────────────────────────────────────────────────

export interface TenantInfo {
  tenantId: string;
  businessName?: string | undefined;
  ownerId?: string | undefined;
  createdAt?: string | undefined;
  ownerName?: string | undefined;
  phone?: string | undefined;
}

/** Tenant metadata + owner profile for many tenants (owner ids from metadata or the caller). */
export async function getTenantInfos(tenants: Array<{ tenantId: string; ownerId?: string }>): Promise<Map<string, TenantInfo>> {
  const metas = await batchGet(
    config.tenantsTable,
    tenants.map((t) => ({ PK: pk(t.tenantId), SK: 'METADATA' })),
  );
  const metaBy = new Map(metas.map((m) => [String(m['tenantId'] ?? String(m['PK']).slice(7)), m]));
  const owners = tenants.map((t) => ({ tenantId: t.tenantId, ownerId: str(metaBy.get(t.tenantId)?.['ownerId']) ?? t.ownerId }));
  const profiles = await batchGet(
    config.tenantsTable,
    owners.filter((o) => o.ownerId).map((o) => ({ PK: pk(o.tenantId), SK: `PROFILE#USER#${o.ownerId}` })),
  );
  const profileBy = new Map(profiles.map((p) => [String(p['PK']).slice(7), p]));
  const out = new Map<string, TenantInfo>();
  for (const o of owners) {
    const m = metaBy.get(o.tenantId);
    const p = profileBy.get(o.tenantId);
    out.set(o.tenantId, {
      tenantId: o.tenantId,
      businessName: str(m?.['organisationName']) ?? str(p?.['organisationName']),
      ownerId: o.ownerId,
      createdAt: str(m?.['createdAt']),
      ownerName: str(p?.['fullName']),
      phone: str(p?.['phoneNumber']),
    });
  }
  return out;
}

export async function getConsent(tenantId: string, userId: string): Promise<{ granted: boolean; capturedAt?: string } | null> {
  const res = await db().send(
    new GetCommand({ TableName: config.tenantsTable, Key: { PK: pk(tenantId), SK: `CONSENT#USER#${userId}` } }),
  );
  if (!res.Item) return null;
  return { granted: res.Item['granted'] === true, ...(str(res.Item['capturedAt']) ? { capturedAt: str(res.Item['capturedAt'])! } : {}) };
}

// ─── Products and trial entitlement ─────────────────────────────────────────

export async function countProducts(tenantId: string): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 100; page++) {
    const res = await db().send(
      new QueryCommand({
        TableName: config.productsTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': pk(tenantId), ':sk': 'PRODUCT#' },
        ProjectionExpression: 'SK',
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    // PRODUCT#<id> only, not sub-items like PRODUCT#<id>#ENRICHMENT.
    count += (res.Items ?? []).filter((i) => String(i['SK']).split('#').length === 2).length;
    startKey = res.LastEvaluatedKey;
    if (!startKey) break;
  }
  return count;
}

export interface EntitlementInfo {
  status: 'active' | 'subscribed' | 'exempt';
  subscribedUntil?: string | undefined;
  monthlyProductLimit?: number | undefined;
  exemptAt?: string | undefined;
}

export async function getEntitlements(tenantIds: string[]): Promise<Map<string, EntitlementInfo>> {
  const items = await batchGet(
    config.productsTable,
    tenantIds.map((t) => ({ PK: pk(t), SK: 'ENTITLEMENT#trial' })),
  );
  const out = new Map<string, EntitlementInfo>();
  for (const i of items) {
    const status = i['status'];
    if (status !== 'active' && status !== 'subscribed' && status !== 'exempt') continue;
    out.set(String(i['PK']).slice(7), {
      status,
      subscribedUntil: str(i['subscribedUntil']),
      monthlyProductLimit: num(i['monthlyProductLimit']),
      exemptAt: str(i['exemptAt']),
    });
  }
  return out;
}

/**
 * New products this calendar month on a paid plan (ENTITLEMENT#month#<yyyyMM>).
 * Only counted while the product limit is switched on; null when there is no counter.
 */
export async function getMonthUsage(tenantId: string, now: Date = new Date()): Promise<number | null> {
  const yyyyMM = now.toISOString().slice(0, 7).replace('-', '');
  const res = await db().send(
    new GetCommand({ TableName: config.productsTable, Key: { PK: pk(tenantId), SK: `ENTITLEMENT#month#${yyyyMM}` } }),
  );
  return num(res.Item?.['productsUsed']) ?? null;
}

// ─── Billing ────────────────────────────────────────────────────────────────

export interface SubscriptionInfo {
  planId: string;
  status: string;
  currentPeriodEnd?: string | undefined;
  priceZARCents?: number | undefined;
}

export async function getSubscriptions(tenantIds: string[]): Promise<Map<string, SubscriptionInfo>> {
  const items = await batchGet(
    config.billingTable,
    tenantIds.map((t) => ({ PK: pk(t), SK: 'SUBSCRIPTION#current' })),
  );
  const out = new Map<string, SubscriptionInfo>();
  for (const i of items) {
    out.set(String(i['PK']).slice(7), {
      planId: String(i['planId'] ?? ''),
      status: String(i['status'] ?? ''),
      currentPeriodEnd: str(i['currentPeriodEnd']),
      priceZARCents: num(i['priceZARCents']),
    });
  }
  return out;
}

export interface InvoiceInfo {
  invoiceId: string;
  invoiceNumber?: string | undefined;
  planId?: string | undefined;
  amountCents: number;
  periodStart?: string | undefined;
  createdAt?: string | undefined;
}

export async function listInvoices(tenantId: string): Promise<InvoiceInfo[]> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.billingTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk(tenantId), ':sk': 'INVOICE#' },
    }),
  );
  return (res.Items ?? [])
    .map((i) => ({
      invoiceId: String(i['invoiceId'] ?? ''),
      invoiceNumber: str(i['invoiceNumber']),
      planId: str(i['planId']),
      amountCents: num(i['amountPaid']) ?? num(i['amountDue']) ?? 0,
      periodStart: str(i['periodStart']),
      createdAt: str(i['createdAt']),
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// ─── Engagement ─────────────────────────────────────────────────────────────

export interface EngagementInfo {
  emailsSent: Array<{ email: string; sentAt?: string | undefined }>;
  marketingOptOut: boolean;
  referralCode?: string | undefined;
  referredByTenantId?: string | undefined;
  referralsMade: number;
  freeMonthsEarned: number;
  /** Earned but not yet taken off a payment. */
  freeMonthsOwed: number;
  review?: { rating: number; status: string; createdAt?: string | undefined } | undefined;
}

export async function getEngagement(tenantId: string): Promise<EngagementInfo> {
  const res = await db().send(
    new QueryCommand({
      TableName: config.engagementTable,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': pk(tenantId) },
    }),
  );
  const items = res.Items ?? [];
  const profile = items.find((i) => i['SK'] === 'PROFILE');
  const referrals = items.filter((i) => String(i['SK']).startsWith('REFERRAL#'));
  const pointer = items.find((i) => i['SK'] === 'REVIEW');
  let review: EngagementInfo['review'];
  if (pointer && str(pointer['reviewId'])) {
    const r = await db().send(
      new GetCommand({ TableName: config.engagementTable, Key: { PK: `REVIEW#${pointer['reviewId']}`, SK: 'META' } }),
    );
    if (r.Item) review = { rating: num(r.Item['rating']) ?? 0, status: String(r.Item['status'] ?? ''), createdAt: str(r.Item['createdAt']) };
  }
  return {
    emailsSent: items
      .filter((i) => String(i['SK']).startsWith('SENT#'))
      .map((i) => ({ email: String(i['SK']).slice(5), sentAt: str(i['sentAt']) ?? str(i['claimedAt']) }))
      .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt))),
    marketingOptOut: profile?.['marketingOptOut'] === true,
    referralCode: str(profile?.['referralCode']),
    referredByTenantId: str(profile?.['referredByTenantId']),
    referralsMade: referrals.length,
    freeMonthsEarned: referrals.filter((r) => r['reward'] === 'EARNED' || r['reward'] === 'APPLIED').length,
    freeMonthsOwed: referrals.filter((r) => r['reward'] === 'EARNED').length,
    review,
  };
}
