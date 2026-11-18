import { describe, it, expect, vi, beforeEach } from 'vitest';

const get = vi.fn();
const transactWrite = vi.fn();
vi.mock('../../utils/dynamo-client', async (orig) => ({
  ...(await orig<typeof import('../../utils/dynamo-client')>()),
  createTenantDynamoClient: () => ({ get, transactWrite }),
}));

import {
  TRIAL_PRODUCT_LIMIT,
  ENTITLEMENT_SK,
  trialProductSK,
  TrialLimitReachedError,
  TrialNotActivatedError,
  isTrialEnforced,
  getEntitlement,
  reserveProductSlot,
  reserveProductSlots,
  releaseProductSlot,
  assertCanGenerate,
  isTrialError,
} from '../trial-gate';

const ON = { enforced: true, tableName: 'products-test' };
const T = 'tenant-1';

const entitlement = (over: Record<string, unknown> = {}) => ({
  Item: { PK: `TENANT#${T}`, SK: ENTITLEMENT_SK, status: 'active', productsUsed: 0, productLimit: 15, ...over },
});
/** A DynamoDB transaction cancellation with per-item reason codes. */
const cancelled = (...codes: string[]) =>
  Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((c) => ({ Code: c })),
  });

beforeEach(() => {
  get.mockReset();
  transactWrite.mockReset();
  delete process.env['TRIAL_ENFORCEMENT'];
});

describe('enforcement switch', () => {
  it('is OFF by default, and only the exact string "true" turns it on', () => {
    expect(isTrialEnforced()).toBe(false);
    process.env['TRIAL_ENFORCEMENT'] = '1';
    expect(isTrialEnforced()).toBe(false);
    process.env['TRIAL_ENFORCEMENT'] = 'true';
    expect(isTrialEnforced()).toBe(true);
    expect(isTrialEnforced({ enforced: false })).toBe(false);
  });

  it('when OFF every operation returns immediately and never touches DynamoDB', async () => {
    const off = { enforced: false };
    expect(await reserveProductSlot(T, 'p1', off)).toBe('unlimited');
    expect(await reserveProductSlots(T, ['a', 'b'], off)).toEqual({ allowed: ['a', 'b'], blocked: [] });
    await releaseProductSlot(T, 'p1', off);
    await assertCanGenerate(T, 'p1', off);
    expect(get).not.toHaveBeenCalled();
    expect(transactWrite).not.toHaveBeenCalled();
  });

  it('fails loudly (not open) when enforcement is ON but no products table is configured', async () => {
    delete process.env['PRODUCTS_TABLE'];
    delete process.env['PRODUCTS_TABLE_NAME'];
    await expect(reserveProductSlot(T, 'p1', { enforced: true })).rejects.toThrow(/table name is not configured/);
  });
});

describe('getEntitlement', () => {
  it('returns null when the tenant has not activated', async () => {
    get.mockResolvedValue({});
    expect(await getEntitlement(T, ON)).toBeNull();
  });
  it('defaults the counters and ignores unknown statuses', async () => {
    get.mockResolvedValue({ Item: { status: 'active' } });
    expect(await getEntitlement(T, ON)).toEqual({ status: 'active', productsUsed: 0, productLimit: TRIAL_PRODUCT_LIMIT });
    get.mockResolvedValue({ Item: { status: 'banana' } });
    expect(await getEntitlement(T, ON)).toBeNull();
  });
  it('reads strongly consistent from the products table under the tenant partition', async () => {
    get.mockResolvedValue({});
    await getEntitlement(T, ON);
    expect(get).toHaveBeenCalledWith({
      TableName: 'products-test',
      Key: { PK: 'TENANT#tenant-1', SK: 'ENTITLEMENT#trial' },
      ConsistentRead: true,
    });
  });
});

describe('reserveProductSlot', () => {
  it('refuses a tenant that has not activated its trial', async () => {
    get.mockResolvedValue({});
    await expect(reserveProductSlot(T, 'p1', ON)).rejects.toBeInstanceOf(TrialNotActivatedError);
    expect(transactWrite).not.toHaveBeenCalled();
  });

  it.each(['subscribed', 'exempt'])('does not limit or count a %s tenant', async (status) => {
    get.mockResolvedValue(entitlement({ status }));
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('unlimited');
    expect(transactWrite).not.toHaveBeenCalled();
  });

  it('takes a slot with ONE transaction: capped counter bump + allow-list marker', async () => {
    get.mockResolvedValue(entitlement());
    transactWrite.mockResolvedValue({});
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('reserved');
    const [counter, marker] = transactWrite.mock.calls[0]![0].TransactItems;
    expect(counter.Update.Key).toEqual({ PK: 'TENANT#tenant-1', SK: 'ENTITLEMENT#trial' });
    expect(counter.Update.UpdateExpression).toBe('ADD #used :one');
    // The cap is checked INSIDE the write, which is what makes concurrent creates safe.
    expect(counter.Update.ConditionExpression).toBe('#status = :active AND (attribute_not_exists(#used) OR #used < #limit)');
    expect(marker.Put.Item).toMatchObject({ PK: 'TENANT#tenant-1', SK: trialProductSK('p1'), productId: 'p1' });
    expect(marker.Put.ConditionExpression).toBe('attribute_not_exists(SK)');
  });

  it('is idempotent: a product that already holds a slot is not charged twice', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 3 }));
    transactWrite.mockRejectedValue(cancelled('None', 'ConditionalCheckFailed'));
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('already');
  });

  it('treats the marker as the truth even when the counter check ALSO failed', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 15 }));
    transactWrite.mockRejectedValue(cancelled('ConditionalCheckFailed', 'ConditionalCheckFailed'));
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('already');
  });

  it('refuses the 16th product with TRIAL_LIMIT_REACHED (402)', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 15 }));
    transactWrite.mockRejectedValue(cancelled('ConditionalCheckFailed', 'None'));
    const err = await reserveProductSlot(T, 'p16', ON).catch((e) => e);
    expect(err).toBeInstanceOf(TrialLimitReachedError);
    expect(err.code).toBe('TRIAL_LIMIT_REACHED');
    expect(err.status).toBe(402);
  });

  it('lets a tenant through if they subscribed between our read and our write', async () => {
    get.mockResolvedValueOnce(entitlement()).mockResolvedValueOnce(entitlement({ status: 'subscribed' }));
    transactWrite.mockRejectedValue(cancelled('ConditionalCheckFailed', 'None'));
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('unlimited');
  });

  it('propagates unexpected errors instead of guessing', async () => {
    get.mockResolvedValue(entitlement());
    transactWrite.mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    await expect(reserveProductSlot(T, 'p1', ON)).rejects.toThrow('throttled');
  });
});

describe('TransactionConflict (found by the live concurrency test)', () => {
  it('retries a conflicting reservation instead of failing the create', async () => {
    get.mockResolvedValue(entitlement());
    transactWrite
      .mockRejectedValueOnce(cancelled('TransactionConflict', 'None'))
      .mockRejectedValueOnce(cancelled('TransactionConflict', 'None'))
      .mockResolvedValueOnce({});
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('reserved');
    expect(transactWrite).toHaveBeenCalledTimes(3);
  });

  it('a conflict followed by a full cap is still a clean TRIAL_LIMIT_REACHED', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 15 }));
    transactWrite
      .mockRejectedValueOnce(cancelled('TransactionConflict', 'None'))
      .mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None'));
    await expect(reserveProductSlot(T, 'p1', ON)).rejects.toBeInstanceOf(TrialLimitReachedError);
  });

  it('gives up after a bounded number of attempts (never loops forever)', async () => {
    get.mockResolvedValue(entitlement());
    transactWrite.mockRejectedValue(cancelled('TransactionConflict', 'None'));
    await expect(reserveProductSlot(T, 'p1', ON)).rejects.toThrow(/Transaction cancelled/);
    expect(transactWrite).toHaveBeenCalledTimes(9); // first try + 8 retries
  });

  it('also retries a conflicting release', async () => {
    transactWrite.mockRejectedValueOnce(cancelled('None', 'TransactionConflict')).mockResolvedValueOnce({});
    await releaseProductSlot(T, 'p1', ON);
    expect(transactWrite).toHaveBeenCalledTimes(2);
  });
});

describe('reserveProductSlots (bulk import)', () => {
  it('reserves what fits, blocks the rest, and stops calling DynamoDB at the first refusal', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 13 }));
    transactWrite
      .mockResolvedValueOnce({}) // 14th
      .mockResolvedValueOnce({}) // 15th
      .mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None')); // 16th
    const ids = Array.from({ length: 1000 }, (_, i) => `p${i}`);
    const r = await reserveProductSlots(T, ids, ON);
    expect(r.allowed).toEqual(['p0', 'p1']);
    expect(r.blocked).toHaveLength(998);
    expect(r.blocked[0]).toBe('p2');
    expect(r.reason).toBe('TRIAL_LIMIT_REACHED');
    // A 1000-row file costs 3 reservations, not 1000.
    expect(transactWrite).toHaveBeenCalledTimes(3);
  });

  it('blocks everything with TRIAL_NOT_ACTIVATED when the trial was never activated', async () => {
    get.mockResolvedValue({});
    expect(await reserveProductSlots(T, ['a', 'b'], ON)).toEqual({
      allowed: [],
      blocked: ['a', 'b'],
      reason: 'TRIAL_NOT_ACTIVATED',
    });
  });

  it('allows the whole batch for a subscriber', async () => {
    get.mockResolvedValue(entitlement({ status: 'subscribed' }));
    expect(await reserveProductSlots(T, ['a', 'b', 'c'], ON)).toEqual({ allowed: ['a', 'b', 'c'], blocked: [] });
  });

  it('rethrows non-limit errors so a real fault is not mistaken for "blocked"', async () => {
    get.mockResolvedValue(entitlement());
    transactWrite.mockRejectedValue(new Error('dynamo down'));
    await expect(reserveProductSlots(T, ['a'], ON)).rejects.toThrow('dynamo down');
  });
});

describe('releaseProductSlot', () => {
  it('removes the marker and decrements the counter in one transaction', async () => {
    transactWrite.mockResolvedValue({});
    await releaseProductSlot(T, 'p1', ON);
    const [del, upd] = transactWrite.mock.calls[0]![0].TransactItems;
    expect(del.Delete.Key).toEqual({ PK: 'TENANT#tenant-1', SK: trialProductSK('p1') });
    expect(del.Delete.ConditionExpression).toBe('attribute_exists(SK)');
    expect(upd.Update.ExpressionAttributeValues).toEqual({ ':minusOne': -1, ':zero': 0 });
    expect(upd.Update.ConditionExpression).toBe('#used > :zero'); // can never go negative
  });
  it('is a no-op when the product held no slot', async () => {
    transactWrite.mockRejectedValue(cancelled('ConditionalCheckFailed', 'None'));
    await expect(releaseProductSlot(T, 'p1', ON)).resolves.toBeUndefined();
  });
  it('propagates real errors', async () => {
    transactWrite.mockRejectedValue(new Error('boom'));
    await expect(releaseProductSlot(T, 'p1', ON)).rejects.toThrow('boom');
  });
});

describe('assertCanGenerate', () => {
  it('refuses a tenant that has not activated', async () => {
    get.mockResolvedValue({});
    await expect(assertCanGenerate(T, 'p1', ON)).rejects.toBeInstanceOf(TrialNotActivatedError);
  });
  it.each(['subscribed', 'exempt'])('always allows a %s tenant', async (status) => {
    get.mockResolvedValue(entitlement({ status }));
    await expect(assertCanGenerate(T, 'anything', ON)).resolves.toBeUndefined();
  });
  it('lets a trial seller keep working on a product that IS in their trial, even at the cap', async () => {
    get.mockResolvedValueOnce(entitlement({ productsUsed: 15 })).mockResolvedValueOnce({ Item: { SK: trialProductSK('p1') } });
    await expect(assertCanGenerate(T, 'p1', ON)).resolves.toBeUndefined();
    expect(get.mock.calls[1]![0].Key.SK).toBe(trialProductSK('p1'));
  });
  it('blocks a product that is NOT in the trial allow-list', async () => {
    get.mockResolvedValueOnce(entitlement({ productsUsed: 15 })).mockResolvedValueOnce({});
    const err = await assertCanGenerate(T, 'p99', ON).catch((e) => e);
    expect(err).toBeInstanceOf(TrialLimitReachedError);
    expect(err.message).toMatch(/not part of your free trial/);
  });
  it('allows free-form generation (no product) only while slots remain', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 14 }));
    await expect(assertCanGenerate(T, undefined, ON)).resolves.toBeUndefined();
    get.mockResolvedValue(entitlement({ productsUsed: 15 }));
    await expect(assertCanGenerate(T, undefined, ON)).rejects.toBeInstanceOf(TrialLimitReachedError);
  });
});

describe('isTrialError', () => {
  it('recognises both trial errors and nothing else', () => {
    expect(isTrialError(new TrialLimitReachedError())).toBe(true);
    expect(isTrialError(new TrialNotActivatedError())).toBe(true);
    expect(isTrialError(new Error('x'))).toBe(false);
  });
});
