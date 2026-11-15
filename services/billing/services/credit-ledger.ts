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

  const item = res.Item;
  const granted = typeof item?.['granted'] === 'number' ? (item['granted'] as number) : 0;
  const consumed = typeof item?.['consumed'] === 'number' ? (item['consumed'] as number) : 0;
  const overage = typeof item?.['overage'] === 'number' ? (item['overage'] as number) : 0;
  const remaining = Math.max(0, granted - consumed);

  return { granted, consumed, overage, remaining };
}

/**
 * Sets (initialises) the monthly granted allowance for a tenant+month.
 *
 * Idempotent-ish: `granted` is set to `amount`. `consumed`/`overage` are only
 * initialised to 0 if they do not already exist, so re-granting the same month
 * (e.g. a replayed activation) does NOT reset consumption.
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
  await client.update({
    TableName: BILLING_TABLE,
    Key: { PK: tenantPK(tenantId), SK: creditsSK(yyyyMM) },
    UpdateExpression:
      'SET granted = :g, consumed = if_not_exists(consumed, :z), overage = if_not_exists(overage, :z), billingMonth = :m, updatedAt = :now',
    ExpressionAttributeValues: {
      ':g': amount,
      ':z': 0,
      ':m': yyyyMM,
      ':now': new Date().toISOString(),
    },
  });
}

/**
 * Atomically consumes `count` credits for a tenant+month.
 *
 * Behaviour depends on `policy`:
 *   - 'hard_cap': uses a ConditionExpression so the ADD only succeeds while
 *     consumed + count <= granted. On breach, throws {@link CreditLimitError}
 *     and consumes nothing.
 *   - 'soft_cap' / 'overage': always increments `consumed`; the portion beyond
 *     `granted` is additionally recorded in `overage`. Two steps are used
 *     because the overage delta depends on the pre-increment consumed value.
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
    try {
      const res = await client.update({
        TableName: BILLING_TABLE,
        Key: key,
        // Only succeed while there's enough allowance. granted must exist and
        // consumed + count must not exceed it. We seed consumed via ADD.
        UpdateExpression: 'ADD consumed :n SET updatedAt = :now',
        ConditionExpression:
          'attribute_exists(granted) AND (if_not_exists(consumed, :z) + :n) <= granted',
        ExpressionAttributeValues: {
          ':n': count,
          ':z': 0,
          ':now': new Date().toISOString(),
        },
        ReturnValues: 'ALL_NEW',
      });
      return toBalance(res.Attributes);
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new CreditLimitError(tenantId, yyyyMM);
      }
      throw error;
    }
  }

  // soft_cap / overage: increment consumed unconditionally, then reconcile overage.
  const incRes = await client.update({
    TableName: BILLING_TABLE,
    Key: key,
    UpdateExpression:
      'ADD consumed :n SET granted = if_not_exists(granted, :z), overage = if_not_exists(overage, :z), billingMonth = :m, updatedAt = :now',
    ExpressionAttributeValues: {
      ':n': count,
      ':z': 0,
      ':m': yyyyMM,
      ':now': new Date().toISOString(),
    },
    ReturnValues: 'ALL_NEW',
  });

  const balance = toBalance(incRes.Attributes);

  // Recompute what the overage counter SHOULD be given consumed vs granted and
  // nudge it to match. overage = max(0, consumed - granted).
  const expectedOverage = Math.max(0, balance.consumed - balance.granted);
  if (expectedOverage !== balance.overage) {
    const fixRes = await client.update({
      TableName: BILLING_TABLE,
      Key: key,
      UpdateExpression: 'SET overage = :o, updatedAt = :now',
      ExpressionAttributeValues: {
        ':o': expectedOverage,
        ':now': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    });
    return toBalance(fixRes.Attributes);
  }

  return balance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
