/**
 * Free unlimited account ("exempt"): the trial limit never applies, and
 * billing never overwrites it (see markSubscribed in trial-gate.ts).
 *
 * Lives on the tenant's ENTITLEMENT#trial item in the products table, the one
 * record every service checks before creating products or writing listings.
 * Removing it puts the account back where billing says it should be: paying
 * (if a paid period is still running) or the free trial.
 */

import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { db, type EntitlementInfo, type SubscriptionInfo } from './data';

const TRIAL_PRODUCT_LIMIT = 15;
const key = (tenantId: string) => ({ PK: `TENANT#${tenantId}`, SK: 'ENTITLEMENT#trial' });

const isConditional = (e: unknown) => (e as { name?: string }).name === 'ConditionalCheckFailedException';

export async function grantExempt(tenantId: string, by: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    // No entitlement yet (no product created): create it as exempt.
    await db().send(
      new PutCommand({
        TableName: config.productsTable,
        Item: {
          ...key(tenantId),
          tenantId,
          status: 'exempt',
          productsUsed: 0,
          productLimit: TRIAL_PRODUCT_LIMIT,
          exemptAt: now,
          exemptBy: by,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    return;
  } catch (error) {
    if (!isConditional(error)) throw error;
  }
  // Keep the usage counters; only the status changes.
  await db().send(
    new UpdateCommand({
      TableName: config.productsTable,
      Key: key(tenantId),
      UpdateExpression: 'SET #s = :exempt, exemptAt = :now, exemptBy = :by',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':exempt': 'exempt', ':now': now, ':by': by },
    }),
  );
}

/** What the account becomes when the exemption is removed. */
export function statusAfterExempt(
  subscription: SubscriptionInfo | undefined,
  monthlyProducts: number | null | undefined,
  now: Date = new Date(),
): Pick<EntitlementInfo, 'status' | 'subscribedUntil' | 'monthlyProductLimit'> {
  const paying =
    subscription?.status === 'active' && !!subscription.currentPeriodEnd && subscription.currentPeriodEnd > now.toISOString();
  if (!paying) return { status: 'active' };
  return {
    status: 'subscribed',
    subscribedUntil: subscription!.currentPeriodEnd,
    ...(typeof monthlyProducts === 'number' ? { monthlyProductLimit: monthlyProducts } : {}),
  };
}

/** False when the account was not exempt. */
export async function removeExempt(
  tenantId: string,
  next: ReturnType<typeof statusAfterExempt>,
): Promise<boolean> {
  const sets = ['#s = :next'];
  const values: Record<string, unknown> = { ':next': next.status, ':exempt': 'exempt' };
  if (next.subscribedUntil) {
    sets.push('subscribedUntil = :until');
    values[':until'] = next.subscribedUntil;
  }
  if (next.monthlyProductLimit !== undefined) {
    sets.push('monthlyProductLimit = :mpl');
    values[':mpl'] = next.monthlyProductLimit;
  }
  const removes = ['exemptAt', 'exemptBy', ...(next.monthlyProductLimit === undefined ? ['monthlyProductLimit'] : [])];
  try {
    await db().send(
      new UpdateCommand({
        TableName: config.productsTable,
        Key: key(tenantId),
        UpdateExpression: `SET ${sets.join(', ')} REMOVE ${removes.join(', ')}`,
        ConditionExpression: '#s = :exempt',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: values,
      }),
    );
    return true;
  } catch (error) {
    if (isConditional(error)) return false;
    throw error;
  }
}
