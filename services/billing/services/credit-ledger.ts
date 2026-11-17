/**
 * Credit ledger — per-tenant, per-month credit accounting.
 *
 * DynamoDB layout (BILLING_TABLE):
 *   PK = TENANT#<tenantId>
 *   SK = CREDITS#<yyyyMM>
 *   attributes: granted (number), consumed (number), overage (number)
 *
 * This module is intentionally dependency-light so OTHER services
 * (product-intelligence, image-intelligence) can import `consumeCredit` /
 * `getBalance` directly to meter their own usage without pulling in HTTP/middy.
 *
 * DynamoDB gotchas this file is written around (both bit us in testing):
 *   - `consumed` is a DynamoDB RESERVED WORD. Every attribute is therefore
 *     referenced through ExpressionAttributeNames (#g/#c/#o/...), never bare.
 *   - ConditionExpressions cannot contain arithmetic or `if_not_exists`
 *     (those are UpdateExpression-only). The hard-cap check is therefore done
 *     as optimistic concurrency: read the balance, then write with a condition
 *     that `consumed` is still the value we read, retrying on contention.
 */

import {
  BILLING_TABLE,
  createTenantDynamoClient,
  creditsSK,
  tenantPK,
} from '../../shared/utils/dynamo-client';

/** How the ledger behaves when consumption would exceed the granted allowance. */
export type CreditPolicy = 'hard_cap' | 'soft_cap' | 'overage';

/**
 * Default policy when a caller does not specify one.
 * PLACEHOLDER — 'soft_cap' lets work continue past the allowance (tracked as
 * overage) rather than hard-blocking; confirm desired enforcement per plan.
 */
export const DEFAULT_CREDIT_POLICY: CreditPolicy = 'soft_cap';

/** Max optimistic-concurrency retries for the hard-cap path. */
const HARD_CAP_MAX_ATTEMPTS = 5;

/** Thrown when a hard-capped tenant attempts to consume beyond its allowance. */
export class CreditLimitError extends Error {
  readonly code = 'CREDIT_LIMIT_EXCEEDED';
  readonly status = 402; // Payment Required
  constructor(tenantId: string, yyyyMM: string) {
    super(`Credit limit exceeded for tenant=${tenantId} month=${yyyyMM}`);
    this.name = 'CreditLimitError';
  }
}

export interface CreditBalanceResult {
  granted: number;
  consumed: number;
  overage: number;
  remaining: number;
}

/** Attribute-name aliases (see header: `consumed` is reserved). */
const NAMES = {
  '#g': 'granted',
  '#c': 'consumed',
  '#o': 'overage',
  '#m': 'billingMonth',
  '#u': 'updatedAt',
} as const;

/**
 * Returns the credit balance for a tenant+month. Returns all-zero if no record
 * exists yet (treated as "no allowance granted").
 */
export async function getBalance(
  tenantId: string,
  yyyyMM: string
): Promise<CreditBalanceResult> {
  const client = createTenantDynamoClient(tenantId);
  const res = await client.get({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: creditsSK(yyyyMM) },
  });
  return toBalance(res.Item as Record<string, unknown> | undefined);
}

/**
 * Sets (initialises) the monthly granted allowance for a tenant+month.
 *
 * Idempotent: `granted` is set to `amount`. `consumed`/`overage` are only
 * initialised to 0 if they do not already exist, so re-granting the same month
 * (e.g. a resumed/replayed activation) does NOT reset consumption.
 *
 * Uses UpdateItem so it creates the record if absent. (TenantDynamoClient.update
 * appends `attribute_exists(PK)`; for the very first grant of a month we use a
 * Put-if-absent first so that condition can then be satisfied.)
 */
export async function grantCredits(
  tenantId: string,
  yyyyMM: string,
  amount: number
): Promise<void> {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`grantCredits: invalid amount ${amount}`);
  }
  const client = createTenantDynamoClient(tenantId);
  const key = { PK: tenantPK(tenantId), SK: creditsSK(yyyyMM) };
  const now = new Date().toISOString();

  // Create the month's record if it doesn't exist yet. The tenant-isolation
  // condition on put + our own attribute_not_exists makes this a no-op when it
  // already exists (we swallow only that specific conditional failure).
  try {
    await client.put({
      TableName: BILLING_TABLE,
      Item: {
        ...key,
        granted: 0,
        consumed: 0,
        overage: 0,
        billingMonth: yyyyMM,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
    // already exists — fine, fall through to set the allowance.
  }

  await client.update({
    TableName: BILLING_TABLE,
    Key: key,
    UpdateExpression: 'SET #g = :g, #m = :m, #u = :now',
    ExpressionAttributeNames: { '#g': NAMES['#g'], '#m': NAMES['#m'], '#u': NAMES['#u'] },
    ExpressionAttributeValues: { ':g': amount, ':m': yyyyMM, ':now': now },
  });
}

/**
 * Atomically consumes `count` credits for a tenant+month.
 *
 * Behaviour depends on `policy`:
 *   - 'hard_cap': read the balance; if consumed + count would exceed granted,
 *     throw {@link CreditLimitError} and consume nothing. Otherwise write with a
 *     condition that `consumed` is unchanged since the read (optimistic
 *     concurrency), retrying a bounded number of times under contention.
 *   - 'soft_cap' / 'overage': always increments `consumed`; the portion beyond
 *     `granted` is additionally recorded in `overage`.
 *
 * Returns the post-consumption balance.
 */
export async function consumeCredit(
  tenantId: string,
  yyyyMM: string,
  count = 1,
  policy: CreditPolicy = DEFAULT_CREDIT_POLICY
): Promise<CreditBalanceResult> {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`consumeCredit: count must be a positive integer, got ${count}`);
  }

  const client = createTenantDynamoClient(tenantId);
  const key = { PK: tenantPK(tenantId), SK: creditsSK(yyyyMM) };

  if (policy === 'hard_cap') {
    for (let attempt = 0; attempt < HARD_CAP_MAX_ATTEMPTS; attempt++) {
      const current = await getBalance(tenantId, yyyyMM);
      if (current.consumed + count > current.granted) {
        throw new CreditLimitError(tenantId, yyyyMM);
      }
      try {
        const res = await client.update({
          TableName: BILLING_TABLE,
          Key: key,
          UpdateExpression: 'SET #c = :next, #u = :now',
          // Only succeed if nobody consumed since we read (optimistic lock).
          ConditionExpression: '#c = :prev',
          ExpressionAttributeNames: { '#c': NAMES['#c'], '#u': NAMES['#u'] },
          ExpressionAttributeValues: {
            ':prev': current.consumed,
            ':next': current.consumed + count,
            ':now': new Date().toISOString(),
          },
          ReturnValues: 'ALL_NEW',
        });
        return toBalance(res.Attributes);
      } catch (error) {
        if (isConditionalCheckFailed(error)) continue; // contention — re-read, retry
        throw error;
      }
    }
    // Persistent contention: fail closed rather than risk overspending the cap.
    throw new CreditLimitError(tenantId, yyyyMM);
  }

  // soft_cap / overage: ensure the record exists, then increment unconditionally.
  await ensureLedgerRecord(tenantId, yyyyMM);

  const incRes = await client.update({
    TableName: BILLING_TABLE,
    Key: key,
    UpdateExpression: 'ADD #c :n SET #u = :now',
    ExpressionAttributeNames: { '#c': NAMES['#c'], '#u': NAMES['#u'] },
    ExpressionAttributeValues: { ':n': count, ':now': new Date().toISOString() },
    ReturnValues: 'ALL_NEW',
  });

  const balance = toBalance(incRes.Attributes);

  // overage = max(0, consumed - granted). Reconcile if the stored counter differs.
  const expectedOverage = Math.max(0, balance.consumed - balance.granted);
  if (expectedOverage !== balance.overage) {
    const fixRes = await client.update({
      TableName: BILLING_TABLE,
      Key: key,
      UpdateExpression: 'SET #o = :o, #u = :now',
      ExpressionAttributeNames: { '#o': NAMES['#o'], '#u': NAMES['#u'] },
      ExpressionAttributeValues: { ':o': expectedOverage, ':now': new Date().toISOString() },
      ReturnValues: 'ALL_NEW',
    });
    return toBalance(fixRes.Attributes);
  }

  return balance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a zeroed ledger record for the month if none exists (idempotent). */
async function ensureLedgerRecord(tenantId: string, yyyyMM: string): Promise<void> {
  const client = createTenantDynamoClient(tenantId);
  const now = new Date().toISOString();
  try {
    await client.put({
      TableName: BILLING_TABLE,
      Item: {
        PK: tenantPK(tenantId),
        SK: creditsSK(yyyyMM),
        granted: 0,
        consumed: 0,
        overage: 0,
        billingMonth: yyyyMM,
        createdAt: now,
        updatedAt: now,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
  } catch (error) {
    if (!isConditionalCheckFailed(error)) throw error;
  }
}

function toBalance(attrs: Record<string, unknown> | undefined): CreditBalanceResult {
  const granted = typeof attrs?.['granted'] === 'number' ? (attrs['granted'] as number) : 0;
  const consumed = typeof attrs?.['consumed'] === 'number' ? (attrs['consumed'] as number) : 0;
  const overage = typeof attrs?.['overage'] === 'number' ? (attrs['overage'] as number) : 0;
  return { granted, consumed, overage, remaining: Math.max(0, granted - consumed) };
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'ConditionalCheckFailedException'
  );
}
