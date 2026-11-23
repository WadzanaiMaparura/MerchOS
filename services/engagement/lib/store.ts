/**
 * Engagement data in one DynamoDB table (merch-os-engagement-<env>, platform CMK).
 *
 *   PK                   SK                    item
 *   TENANT#<id>          PROFILE               who to email + lifecycle state (opt-out, subscribedAt, referral)
 *   TENANT#<id>          SENT#<emailKey>       one marker per lifecycle email (never sent twice)
 *   TENANT#<id>          REVIEW                pointer: this tenant has left its one review
 *   TENANT#<referrer>    REFERRAL#<referred>   a referral (GSI1: REFERRALS / <claimedAt>)
 *   REFCODE#<code>       META                  referral code -> owning tenant
 *   REVIEW#<id>          META                  a review (GSI1: REVIEWS#<status> / <sortKey>)
 *   RL#<scope>#<hash>    <window>              rate-limit counters (TTL)
 *
 * Approved reviews sort by approval time, oldest first, so the first approved
 * review fills the first slot on the website and later ones fill the next.
 */

import { createHash, randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { config } from './config';

let client: DynamoDBDocumentClient | undefined;
export function db(): DynamoDBDocumentClient {
  client ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return client;
}

/** @internal tests only */
export function _setDb(value: DynamoDBDocumentClient | undefined): void {
  client = value;
}

const tenantPK = (tenantId: string) => `TENANT#${tenantId}`;
const epoch = (secondsFromNow: number) => Math.floor(Date.now() / 1000) + secondsFromNow;

export function isConditionalFailure(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'ConditionalCheckFailedException' || name === 'TransactionCanceledException';
}

// ─── Profiles ────────────────────────────────────────────────────────────────

export interface Profile {
  tenantId: string;
  userId: string;
  email: string;
  firstName?: string | undefined;
  businessName?: string | undefined;
  createdAt: string;
  /** First paid activation. Set once; later renewals do not change it. */
  subscribedAt?: string | undefined;
  planId?: string | undefined;
  referralCode?: string | undefined;
  /** Who referred this tenant (set once, before it subscribes). */
  referredByTenantId?: string | undefined;
  marketingOptOut?: boolean | undefined;
  optOutAt?: string | undefined;
}

export async function getProfile(tenantId: string): Promise<Profile | null> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: tenantPK(tenantId), SK: 'PROFILE' }, ConsistentRead: true }),
  );
  return (out.Item as Profile | undefined) ?? null;
}

/** Creates the profile unless one exists; returns whichever is stored. */
export async function putProfileIfAbsent(profile: Profile): Promise<Profile> {
  try {
    await db().send(
      new PutCommand({
        TableName: config.table,
        Item: { PK: tenantPK(profile.tenantId), SK: 'PROFILE', ...profile },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return profile;
  } catch (error) {
    if (!isConditionalFailure(error)) throw error;
    return (await getProfile(profile.tenantId)) ?? profile;
  }
}

/** True only for the FIRST paid activation of this tenant. */
export async function markFirstSubscription(tenantId: string, planId: string, at: string): Promise<boolean> {
  try {
    await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: { PK: tenantPK(tenantId), SK: 'PROFILE' },
        UpdateExpression: 'SET subscribedAt = :at, planId = :plan',
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(subscribedAt)',
        ExpressionAttributeValues: { ':at': at, ':plan': planId },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function setMarketingOptOut(tenantId: string): Promise<boolean> {
  try {
    await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: { PK: tenantPK(tenantId), SK: 'PROFILE' },
        UpdateExpression: 'SET marketingOptOut = :t, optOutAt = if_not_exists(optOutAt, :now)',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':t': true, ':now': new Date().toISOString() },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

// ─── Sent markers (idempotency) ──────────────────────────────────────────────

/** Claims the right to send `key` to this tenant. False if already claimed. */
export async function claimSend(tenantId: string, key: string): Promise<boolean> {
  try {
    await db().send(
      new PutCommand({
        TableName: config.table,
        Item: { PK: tenantPK(tenantId), SK: `SENT#${key}`, claimedAt: new Date().toISOString() },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function wasSent(tenantId: string, key: string): Promise<boolean> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: tenantPK(tenantId), SK: `SENT#${key}` }, ConsistentRead: true }),
  );
  return !!out.Item;
}

/** Gives a claim back when the send failed, so a retry can send it. */
export async function releaseSend(tenantId: string, key: string): Promise<void> {
  await db().send(new DeleteCommand({ TableName: config.table, Key: { PK: tenantPK(tenantId), SK: `SENT#${key}` } }));
}

export async function recordSent(tenantId: string, key: string, messageId: string | undefined): Promise<void> {
  await db().send(
    new UpdateCommand({
      TableName: config.table,
      Key: { PK: tenantPK(tenantId), SK: `SENT#${key}` },
      UpdateExpression: 'SET sentAt = :now, messageId = :mid',
      ExpressionAttributeValues: { ':now': new Date().toISOString(), ':mid': messageId ?? 'unknown' },
    }),
  );
}

// ─── Referral codes ──────────────────────────────────────────────────────────

/** Reserves `code` for the tenant and stores it on the profile. False if taken. */
export async function reserveReferralCode(tenantId: string, code: string): Promise<boolean> {
  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.table,
              Item: { PK: `REFCODE#${code}`, SK: 'META', tenantId, createdAt: new Date().toISOString() },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Update: {
              TableName: config.table,
              Key: { PK: tenantPK(tenantId), SK: 'PROFILE' },
              UpdateExpression: 'SET referralCode = :code',
              ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(referralCode)',
              ExpressionAttributeValues: { ':code': code },
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

export async function tenantForReferralCode(code: string): Promise<string | null> {
  const out = await db().send(new GetCommand({ TableName: config.table, Key: { PK: `REFCODE#${code}`, SK: 'META' } }));
  return (out.Item?.['tenantId'] as string | undefined) ?? null;
}

// ─── Referrals ───────────────────────────────────────────────────────────────

/**
 *  PENDING     signed up through the link, not paying yet
 *  SUBSCRIBED  paying; qualifies once 14 days have passed, still subscribed,
 *              and at least 10 products added (actively using MerchOS)
 *  QUALIFIED   the referrer has earned one free month
 *  LAPSED      stopped paying, or still under 10 products 90 days after paying (no reward)
 */
export type ReferralStatus = 'PENDING' | 'SUBSCRIBED' | 'QUALIFIED' | 'LAPSED';
export const REFERRAL_STATUSES: readonly ReferralStatus[] = ['PENDING', 'SUBSCRIBED', 'QUALIFIED', 'LAPSED'];

/** EARNED = owed; APPLIED = taken off a payment (once checkout is live). */
export type RewardStatus = 'EARNED' | 'APPLIED';

export interface Referral {
  referrerTenantId: string;
  referredTenantId: string;
  referredBusiness?: string | undefined;
  code: string;
  status: ReferralStatus;
  claimedAt: string;
  subscribedAt?: string | undefined;
  qualifyAt?: string | undefined;
  qualifiedAt?: string | undefined;
  lapsedAt?: string | undefined;
  /** Why it lapsed: stopped paying, or not actively using MerchOS in time. */
  lapseReason?: 'stopped-paying' | 'not-active' | undefined;
  /** Products the referred seller had at the last check (activity rule). */
  productsAtLastCheck?: number | undefined;
  lastCheckedAt?: string | undefined;
  reward?: RewardStatus | undefined;
  rewardAppliedAt?: string | undefined;
  rewardAppliedBy?: string | undefined;
}

const referralKey = (referrer: string, referred: string) => ({
  PK: tenantPK(referrer),
  SK: `REFERRAL#${referred}`,
});

/**
 * Links a new tenant to the referrer. Only once per referred tenant, only
 * before it subscribes. False when it was already referred or has subscribed.
 */
export async function createReferral(r: Referral): Promise<boolean> {
  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: config.table,
              Key: { PK: tenantPK(r.referredTenantId), SK: 'PROFILE' },
              UpdateExpression: 'SET referredByTenantId = :ref',
              ConditionExpression:
                'attribute_exists(PK) AND attribute_not_exists(referredByTenantId) AND attribute_not_exists(subscribedAt)',
              ExpressionAttributeValues: { ':ref': r.referrerTenantId },
            },
          },
          {
            Put: {
              TableName: config.table,
              Item: {
                ...referralKey(r.referrerTenantId, r.referredTenantId),
                ...r,
                GSI1PK: 'REFERRALS',
                GSI1SK: r.claimedAt,
              },
              ConditionExpression: 'attribute_not_exists(PK)',
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

export async function getReferral(referrer: string, referred: string): Promise<Referral | null> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: referralKey(referrer, referred), ConsistentRead: true }),
  );
  return (out.Item as Referral | undefined) ?? null;
}

/** Moves a referral between statuses; false if it was not in one of `from`. */
export async function transitionReferral(
  referrer: string,
  referred: string,
  from: ReferralStatus[],
  to: ReferralStatus,
  fields: Partial<Referral> = {},
): Promise<boolean> {
  const sets = Object.entries({ ...fields, status: to }).filter(([, v]) => v !== undefined);
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  sets.forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
  });
  from.forEach((s, i) => (values[`:from${i}`] = s));
  names['#status'] = 'status';
  try {
    await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: referralKey(referrer, referred),
        UpdateExpression: `SET ${sets.map((_, i) => `#f${i} = :v${i}`).join(', ')}`,
        ConditionExpression: `attribute_exists(PK) AND #status IN (${from.map((_, i) => `:from${i}`).join(', ')})`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

/** Admin: mark an earned free month as taken off a payment. */
export async function markRewardApplied(referrer: string, referred: string, by: string): Promise<boolean> {
  try {
    await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: referralKey(referrer, referred),
        UpdateExpression: 'SET reward = :applied, rewardAppliedAt = :now, rewardAppliedBy = :by',
        ConditionExpression: 'reward = :earned',
        ExpressionAttributeValues: {
          ':applied': 'APPLIED',
          ':earned': 'EARNED',
          ':now': new Date().toISOString(),
          ':by': by,
        },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalFailure(error)) return false;
    throw error;
  }
}

export async function listReferralsBy(referrerTenantId: string): Promise<Referral[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': tenantPK(referrerTenantId), ':sk': 'REFERRAL#' },
    }),
  );
  return (out.Items ?? []) as Referral[];
}

export async function listAllReferrals(limit = 200): Promise<Referral[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'REFERRALS' },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (out.Items ?? []) as Referral[];
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export interface Review {
  reviewId: string;
  tenantId: string;
  rating: number;
  text: string;
  /** Shown on the website, e.g. "Thandi K." */
  displayName: string;
  /** Shown under the name, e.g. "Home & Kitchen" or the business name. */
  businessLabel?: string | undefined;
  /** The seller agreed we may show it on the website. */
  consentToPublish: boolean;
  status: ReviewStatus;
  createdAt: string;
  decidedAt?: string | undefined;
  decidedBy?: string | undefined;
}

export type NewReview = Omit<Review, 'reviewId' | 'status' | 'createdAt'>;

/** Saves the tenant's one review. Null when it has already left one. */
export async function createReview(input: NewReview): Promise<Review | null> {
  const review: Review = {
    ...input,
    reviewId: randomUUID(),
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  };
  try {
    await db().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: config.table,
              Item: { PK: tenantPK(review.tenantId), SK: 'REVIEW', reviewId: review.reviewId, createdAt: review.createdAt },
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          {
            Put: {
              TableName: config.table,
              Item: {
                PK: `REVIEW#${review.reviewId}`,
                SK: 'META',
                ...review,
                GSI1PK: 'REVIEWS#PENDING',
                GSI1SK: review.createdAt,
              },
            },
          },
        ],
      }),
    );
    return review;
  } catch (error) {
    if (isConditionalFailure(error)) return null;
    throw error;
  }
}

export async function hasReviewed(tenantId: string): Promise<boolean> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: tenantPK(tenantId), SK: 'REVIEW' }, ConsistentRead: true }),
  );
  return !!out.Item;
}

export async function getReview(reviewId: string): Promise<Review | null> {
  const out = await db().send(
    new GetCommand({ TableName: config.table, Key: { PK: `REVIEW#${reviewId}`, SK: 'META' }, ConsistentRead: true }),
  );
  return (out.Item as Review | undefined) ?? null;
}

export async function listReviews(status: ReviewStatus, limit = 100): Promise<Review[]> {
  const out = await db().send(
    new QueryCommand({
      TableName: config.table,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': `REVIEWS#${status}` },
      // Approved: oldest approval first (website slot order). Others: newest first.
      ScanIndexForward: status === 'APPROVED',
      Limit: limit,
    }),
  );
  return (out.Items ?? []) as Review[];
}

/** Approve or reject. Approving requires the seller's consent to publish. */
export async function decideReview(
  reviewId: string,
  status: 'APPROVED' | 'REJECTED',
  by: string,
): Promise<Review | null> {
  const now = new Date().toISOString();
  try {
    const out = await db().send(
      new UpdateCommand({
        TableName: config.table,
        Key: { PK: `REVIEW#${reviewId}`, SK: 'META' },
        UpdateExpression: 'SET #status = :status, decidedAt = :now, decidedBy = :by, GSI1PK = :gpk, GSI1SK = :now',
        ConditionExpression:
          status === 'APPROVED' ? 'attribute_exists(PK) AND consentToPublish = :true' : 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':status': status,
          ':now': now,
          ':by': by,
          ':gpk': `REVIEWS#${status}`,
          ...(status === 'APPROVED' ? { ':true': true } : {}),
        },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return (out.Attributes as Review | undefined) ?? null;
  } catch (error) {
    if (isConditionalFailure(error)) return null;
    throw error;
  }
}

/** Removes a review entirely (POPIA request). The seller may then review again. */
export async function deleteReview(review: Review): Promise<void> {
  await db().send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: config.table, Key: { PK: `REVIEW#${review.reviewId}`, SK: 'META' } } },
        { Delete: { TableName: config.table, Key: { PK: tenantPK(review.tenantId), SK: 'REVIEW' } } },
      ],
    }),
  );
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

/** Fixed-window counter: true while within `limit` per `windowSeconds`. */
export async function withinRateLimit(scope: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
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
