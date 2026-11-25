/**
 * Read-only lookups in other services' data, to address and personalise emails:
 *
 *  - Cognito (AdminGetUser): the account email, and whether the account still exists
 *  - tenants table: owner profile (full name) and tenant metadata (business name)
 *  - products table: how many products the tenant has, and its paid status
 *    (ENTITLEMENT#trial, written by billing via markSubscribed)
 *
 * This service never writes to any of them.
 */

import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db, putProfileIfAbsent, getProfile, type Profile } from './store';

let cognito: CognitoIdentityProviderClient | undefined;

/** @internal tests only */
export function _setCognito(value: CognitoIdentityProviderClient | undefined): void {
  cognito = value;
}

export interface AccountUser {
  email: string;
  enabled: boolean;
}

/** Null when the user no longer exists (deleted account: send nothing). */
export async function getUser(userId: string): Promise<AccountUser | null> {
  cognito ??= new CognitoIdentityProviderClient({});
  try {
    const out = await cognito.send(new AdminGetUserCommand({ UserPoolId: config.userPoolId, Username: userId }));
    const email = out.UserAttributes?.find((a) => a.Name === 'email')?.Value;
    if (!email) return null;
    return { email, enabled: out.Enabled !== false };
  } catch (error) {
    if (error instanceof UserNotFoundException || (error as { name?: string }).name === 'UserNotFoundException') {
      return null;
    }
    throw error;
  }
}

/** First word of a full name, tidied ("thandi khumalo" -> "Thandi"). */
export function firstNameOf(fullName: string | undefined): string | undefined {
  const first = fullName?.trim().split(/\s+/)[0];
  if (!first || first.length > 40 || !/^[\p{L}'-]+$/u.test(first)) return undefined;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/** "Thandi Khumalo" -> "Thandi K." (how reviews are signed on the website). */
export function shortName(fullName: string | undefined): string | undefined {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  const first = firstNameOf(parts[0]);
  if (!first) return undefined;
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  const initial = /^\p{L}/u.test(last) ? ` ${last.charAt(0).toUpperCase()}.` : '';
  return `${first}${initial}`;
}

export interface OwnerDetails {
  fullName?: string | undefined;
  businessName?: string | undefined;
}

export async function getOwnerDetails(tenantId: string, userId: string): Promise<OwnerDetails> {
  const pk = `TENANT#${tenantId}`;
  const [profile, meta] = await Promise.all([
    db().send(new GetCommand({ TableName: config.tenantsTable, Key: { PK: pk, SK: `PROFILE#USER#${userId}` } })),
    db().send(new GetCommand({ TableName: config.tenantsTable, Key: { PK: pk, SK: 'METADATA' } })),
  ]);
  const fullName = profile.Item?.['fullName'];
  const businessName = meta.Item?.['organisationName'] ?? profile.Item?.['organisationName'];
  return {
    fullName: typeof fullName === 'string' ? fullName : undefined,
    businessName: typeof businessName === 'string' ? businessName : undefined,
  };
}

/** The tenant's owner (the account that signed up). */
export async function getOwnerUserId(tenantId: string): Promise<string | null> {
  const out = await db().send(
    new GetCommand({ TableName: config.tenantsTable, Key: { PK: `TENANT#${tenantId}`, SK: 'METADATA' } }),
  );
  const owner = out.Item?.['ownerId'];
  return typeof owner === 'string' ? owner : null;
}

/**
 * The engagement profile, created on first use from Cognito + the tenants
 * table. Null when the account no longer exists.
 */
export async function ensureProfile(tenantId: string, userId?: string): Promise<Profile | null> {
  const existing = await getProfile(tenantId);
  if (existing) return existing;
  const owner = userId ?? (await getOwnerUserId(tenantId));
  if (!owner) return null;
  const user = await getUser(owner);
  if (!user) return null;
  const details = await getOwnerDetails(tenantId, owner);
  return putProfileIfAbsent({
    tenantId,
    userId: owner,
    email: user.email,
    firstName: firstNameOf(details.fullName),
    businessName: details.businessName,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Number of products the tenant has (items PRODUCT#<id>, not their sub-items
 * such as PRODUCT#<id>#ENRICHMENT). Stops counting at `cap`.
 */
export async function countProducts(tenantId: string, cap = 10_000): Promise<number> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  for (let page = 0; page < 50; page++) {
    const out = await db().send(
      new QueryCommand({
        TableName: config.productsTable,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `TENANT#${tenantId}`, ':sk': 'PRODUCT#' },
        ProjectionExpression: 'SK',
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    count += (out.Items ?? []).filter((i) => String(i['SK']).split('#').length === 2).length;
    startKey = out.LastEvaluatedKey;
    if (!startKey || count >= cap) break;
  }
  return Math.min(count, cap);
}

/** The paid status as billing recorded it (ENTITLEMENT#trial), for the payment-cycle emails. */
export async function getPaidStatus(
  tenantId: string,
): Promise<{ status: string; subscribedUntil?: string | undefined } | null> {
  const out = await db().send(
    new GetCommand({
      TableName: config.productsTable,
      Key: { PK: `TENANT#${tenantId}`, SK: 'ENTITLEMENT#trial' },
      ConsistentRead: true,
    }),
  );
  const item = out.Item;
  if (!item || typeof item['status'] !== 'string') return null;
  const until = item['subscribedUntil'];
  return { status: item['status'], subscribedUntil: typeof until === 'string' ? until : undefined };
}

/** True while the tenant has a paid period that has not ended. */
export async function isSubscribedNow(tenantId: string, now: Date = new Date()): Promise<boolean> {
  const out = await db().send(
    new GetCommand({
      TableName: config.productsTable,
      Key: { PK: `TENANT#${tenantId}`, SK: 'ENTITLEMENT#trial' },
      ConsistentRead: true,
    }),
  );
  const item = out.Item;
  if (!item || item['status'] !== 'subscribed') return false;
  const until = item['subscribedUntil'];
  return typeof until !== 'string' || until > now.toISOString();
}
