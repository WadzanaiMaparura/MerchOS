/**
 * One free trial per person/business: sign-up identity claims.
 *
 * Each completed self-signup claims its normalised email, phone number and
 * business name. A new registration that matches ANY existing claim is refused
 * before its Cognito account is created, so the same seller cannot open a
 * second account to get another free trial.
 *
 * Stored in the tenants table as marker items (no GSI needed):
 *   PK = CLAIM#EMAIL#<normalised email>   SK = CLAIM
 *   PK = CLAIM#PHONE#<E.164>              SK = CLAIM
 *   PK = CLAIM#ORG#<normalised name>      SK = CLAIM
 *
 * Normalisation is deliberately conservative: it catches the cheap tricks
 * (case, spacing, "+tag" and Gmail dots, "(Pty) Ltd" suffixes) without merging
 * genuinely different businesses.
 */
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export type ClaimKind = 'EMAIL' | 'PHONE' | 'ORG';

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

export function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  // "name+anything@" delivers to "name@" at practically every provider.
  local = local.split('+')[0]!;
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, ''); // Gmail ignores dots
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}

/** Legal-form suffixes that do not distinguish one business from another. */
const ORG_SUFFIXES = [
  'pty ltd', 'pty limited', 'proprietary limited', 'ltd', 'limited', 'cc', 'inc', 'incorporated',
  'llc', 'plc', 'npc', 'soc ltd', 'co', 'company', 'corp', 'corporation', 'group', 'holdings',
  'trading', 'enterprises', 'sa', 'za',
];

export function normaliseOrganisation(raw: string): string {
  let s = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bt\/a\b.*$/, '') // "X t/a Y": the legal entity is X
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  // Strip trailing legal-form words repeatedly ("Acme Trading (Pty) Ltd" -> "acme").
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of ORG_SUFFIXES) {
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}

export interface IdentityInput {
  email: string;
  phoneNumber: string;
  organisationName: string;
}

export function claimKeys(input: IdentityInput): Array<{ kind: ClaimKind; PK: string }> {
  const keys: Array<{ kind: ClaimKind; PK: string }> = [];
  const email = normaliseEmail(input.email);
  const phone = normalisePhone(input.phoneNumber);
  const org = normaliseOrganisation(input.organisationName);
  if (email) keys.push({ kind: 'EMAIL', PK: `CLAIM#EMAIL#${email}` });
  if (phone) keys.push({ kind: 'PHONE', PK: `CLAIM#PHONE#${phone}` });
  // Very short names ("ab") are too generic to reserve.
  if (org.length >= 3) keys.push({ kind: 'ORG', PK: `CLAIM#ORG#${org}` });
  return keys;
}

/** Which of this registration's identities already belong to an account. */
export async function findTakenClaims(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  input: IdentityInput,
): Promise<ClaimKind[]> {
  const keys = claimKeys(input);
  const found = await Promise.all(
    keys.map(async (k) => {
      const res = await docClient.send(
        new GetCommand({ TableName: tableName, Key: { PK: k.PK, SK: 'CLAIM' }, ConsistentRead: true }),
      );
      return res.Item ? k.kind : null;
    }),
  );
  return found.filter((k): k is ClaimKind => k !== null);
}

/**
 * Records the claims for a completed registration. Each is create-only; a claim
 * already held by THIS tenant is fine (retry), one held by another tenant is
 * reported back (a race the pre-check could not see) and left untouched.
 */
export async function recordClaims(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  tenantId: string,
  input: IdentityInput,
): Promise<{ conflicts: ClaimKind[] }> {
  const conflicts: ClaimKind[] = [];
  const claimedAt = new Date().toISOString();
  for (const k of claimKeys(input)) {
    try {
      await docClient.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: k.PK, SK: 'CLAIM', kind: k.kind, tenantId, claimedAt },
          ConditionExpression: 'attribute_not_exists(PK) OR tenantId = :tid',
          ExpressionAttributeValues: { ':tid': tenantId },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name !== 'ConditionalCheckFailedException') throw error;
      conflicts.push(k.kind);
    }
  }
  return { conflicts };
}

/** Shown to the seller; deliberately does not say WHICH detail matched. */
export const ACCOUNT_EXISTS_MESSAGE =
  'An account already exists for this email address, phone number or business name. ' +
  'Sign in to that account instead, or contact admin@merchos.co.za if you think this is a mistake.';
