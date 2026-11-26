import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const get = vi.fn();
const transactWrite = vi.fn();
const put = vi.fn();
const update = vi.fn();
vi.mock('../../utils/dynamo-client', async (orig) => ({
  ...(await orig<typeof import('../../utils/dynamo-client')>()),
  createTenantDynamoClient: () => ({ get, transactWrite, put, update }),
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
  markSubscribed,
  getTrialUsage,
  PlanLimitReachedError,
  PlanPausedError,
  effectiveStatus,
  monthKey,
  monthCounterSK,
  monthProductSK,
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
  put.mockReset();
  update.mockReset();
  delete process.env['TRIAL_ENFORCEMENT'];
  delete process.env['TRIAL_ACTIVATION'];
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
  it('in card mode, refuses a tenant that has not activated its trial', async () => {
    process.env['TRIAL_ACTIVATION'] = 'card';
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
    expect(counter.Update.ConditionExpression).toBe(
      '#status = :active AND (attribute_not_exists(#used) OR #used < #limit)',
    );
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

  it('in card mode, blocks everything with TRIAL_NOT_ACTIVATED when the trial was never activated', async () => {
    process.env['TRIAL_ACTIVATION'] = 'card';
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
  it('in card mode, refuses a tenant that has not activated', async () => {
    process.env['TRIAL_ACTIVATION'] = 'card';
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

describe('automatic activation (default)', () => {
  it("starts the trial with the seller's first product (put-if-absent), then reserves", async () => {
    get.mockResolvedValueOnce({}).mockResolvedValue(entitlement());
    put.mockResolvedValue({});
    transactWrite.mockResolvedValue({});
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('reserved');
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ SK: ENTITLEMENT_SK, status: 'active', productsUsed: 0, productLimit: TRIAL_PRODUCT_LIMIT, activation: 'auto' }),
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
  });

  it('is safe when two first products race (the loser re-reads the winner)', async () => {
    get.mockResolvedValueOnce({}).mockResolvedValue(entitlement({ productsUsed: 1 }));
    put.mockRejectedValue(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }));
    transactWrite.mockResolvedValue({});
    expect(await reserveProductSlot(T, 'p2', ON)).toBe('reserved');
  });
});

describe('subscriptions', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  it('a paid-up subscription is unlimited, and still is during the 3-day grace period', async () => {
    get.mockResolvedValue(entitlement({ status: 'subscribed', subscribedUntil: future }));
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('unlimited');

    get.mockResolvedValue(entitlement({ status: 'subscribed', subscribedUntil: past })); // 1 day ago: grace
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('unlimited');
    await expect(assertCanGenerate(T, 'p1', ON)).resolves.toBeUndefined();
    expect(transactWrite).not.toHaveBeenCalled();
  });

  it('after the grace period the plan is paused: no new products, no new listings, and no free trial again', async () => {
    get.mockResolvedValue(entitlement({ status: 'subscribed', subscribedUntil: daysAgo(4), productsUsed: 2 }));
    const err = await reserveProductSlot(T, 'p1', ON).catch((e) => e);
    expect(err).toBeInstanceOf(PlanPausedError);
    expect(err.code).toBe('PLAN_PAUSED');
    expect(err.status).toBe(402);
    expect(isTrialError(err)).toBe(true);
    await expect(assertCanGenerate(T, 'p1', ON)).rejects.toBeInstanceOf(PlanPausedError);
    await expect(assertCanGenerate(T, undefined, ON)).rejects.toBeInstanceOf(PlanPausedError);
    // The unused trial slots are not handed out again.
    expect(transactWrite).not.toHaveBeenCalled();
    expect(await reserveProductSlots(T, ['a', 'b'], ON)).toEqual({ allowed: [], blocked: ['a', 'b'], reason: 'PLAN_PAUSED' });
  });

  it('effectiveStatus: paid, grace, then lapsed; exempt and trial unchanged', () => {
    const e = (over: Record<string, unknown>) => ({ status: 'subscribed', productsUsed: 0, productLimit: 15, ...over }) as never;
    expect(effectiveStatus(e({ subscribedUntil: future }))).toBe('subscribed');
    expect(effectiveStatus(e({ subscribedUntil: daysAgo(2.9) }))).toBe('subscribed');
    expect(effectiveStatus(e({ subscribedUntil: daysAgo(3.01) }))).toBe('lapsed');
    expect(effectiveStatus(e({ subscribedUntil: undefined }))).toBe('subscribed');
    expect(effectiveStatus(e({ status: 'exempt', subscribedUntil: daysAgo(90) }))).toBe('exempt');
    expect(effectiveStatus(e({ status: 'active' }))).toBe('active');
  });

  it('bulk import by a subscribed seller costs one read, not one per product', async () => {
    get.mockResolvedValue(entitlement({ status: 'subscribed', subscribedUntil: future }));
    const ids = Array.from({ length: 500 }, (_, i) => `p${i}`);
    expect((await reserveProductSlots(T, ids, ON)).allowed).toHaveLength(500);
    expect(get).toHaveBeenCalledTimes(1);
    expect(transactWrite).not.toHaveBeenCalled();
  });

  it('markSubscribed creates the record for a tenant with none', async () => {
    put.mockResolvedValue({});
    await markSubscribed(T, future, { tableName: 'products-test' });
    expect(put).toHaveBeenCalledWith(expect.objectContaining({
      Item: expect.objectContaining({ status: 'subscribed', subscribedUntil: future }),
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it('markSubscribed updates an existing record, never downgrades exempt or shortens a period', async () => {
    put.mockRejectedValue(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }));
    update.mockResolvedValue({});
    await markSubscribed(T, future, { tableName: 'products-test' });
    const call = update.mock.calls[0]![0];
    // No plan limit passed: unlimited (custom plan) clears any previous monthly limit.
    expect(call.UpdateExpression).toBe('SET #status = :subscribed, #until = :until REMOVE #mpl');
    expect(call.ConditionExpression).toContain('#status <> :exempt');
    expect(call.ConditionExpression).toContain('#until <= :until');

    update.mockRejectedValue(Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' }));
    await expect(markSubscribed(T, past, { tableName: 'products-test' })).resolves.toBeUndefined();
  });
});

describe('getTrialUsage', () => {
  it('reports not_started without creating anything', async () => {
    get.mockResolvedValue({});
    expect(await getTrialUsage(T, ON)).toMatchObject({ enforced: true, status: 'not_started', productsUsed: 0, productLimit: 15, remaining: 15 });
    expect(put).not.toHaveBeenCalled();
  });
  it('reports trial usage and never a negative remainder', async () => {
    get.mockResolvedValue(entitlement({ productsUsed: 17 }));
    expect(await getTrialUsage(T, ON)).toMatchObject({ status: 'trial', productsUsed: 17, remaining: 0 });
  });
  it('a lapsed subscription reads as paused', async () => {
    get.mockResolvedValue(entitlement({ status: 'subscribed', subscribedUntil: '2000-01-01T00:00:00.000Z', productsUsed: 4 }));
    expect(await getTrialUsage(T, ON)).toMatchObject({ status: 'paused' });
  });
});

describe('paid plans: new products per month', () => {
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const paid = (over: Record<string, unknown> = {}) =>
    entitlement({ status: 'subscribed', subscribedUntil: future, monthlyProductLimit: 500, ...over });

  it("counts a new product against this month's allowance (cap checked in the write)", async () => {
    get.mockResolvedValue(paid());
    put.mockResolvedValue({});
    transactWrite.mockResolvedValue({});
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('reserved');
    const [counter, marker] = transactWrite.mock.calls[0]![0].TransactItems;
    expect(counter.Update.Key.SK).toBe(monthCounterSK(monthKey()));
    expect(counter.Update.ConditionExpression).toBe('attribute_not_exists(#used) OR #used < :limit');
    expect(counter.Update.ExpressionAttributeValues[':limit']).toBe(500);
    expect(marker.Put.Item.SK).toBe(monthProductSK(monthKey(), 'p1'));
  });

  it('refuses the 501st product with PLAN_LIMIT_REACHED, and a retry of a counted product is free', async () => {
    get.mockResolvedValue(paid());
    put.mockRejectedValue(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }));
    transactWrite.mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None'));
    const err = await reserveProductSlot(T, 'p501', ON).catch((e) => e);
    expect(err).toBeInstanceOf(PlanLimitReachedError);
    expect(err.code).toBe('PLAN_LIMIT_REACHED');
    expect(isTrialError(err)).toBe(true); // -> HTTP 402 via the existing mappers

    transactWrite.mockRejectedValueOnce(cancelled('None', 'ConditionalCheckFailed'));
    expect(await reserveProductSlot(T, 'p1', ON)).toBe('already');
  });

  it('a bulk import creates what fits this month and reports PLAN_LIMIT_REACHED for the rest', async () => {
    get.mockResolvedValue(paid({ monthlyProductLimit: 2 }));
    put.mockResolvedValue({});
    transactWrite
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None'));
    expect(await reserveProductSlots(T, ['a', 'b', 'c', 'd'], ON)).toEqual({
      allowed: ['a', 'b'], blocked: ['c', 'd'], reason: 'PLAN_LIMIT_REACHED',
    });
  });

  it('a custom plan without a monthly limit stays unlimited (one read for a bulk import)', async () => {
    get.mockResolvedValue(paid({ monthlyProductLimit: undefined }));
    expect((await reserveProductSlots(T, ['a', 'b', 'c'], ON)).allowed).toHaveLength(3);
    expect(transactWrite).not.toHaveBeenCalled();
  });

  it('markSubscribed records the plan allowance', async () => {
    put.mockRejectedValue(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }));
    update.mockResolvedValue({});
    await markSubscribed(T, future, { tableName: 'products-test', monthlyProductLimit: 1000 });
    const call = update.mock.calls[0]![0];
    expect(call.UpdateExpression).toBe('SET #status = :subscribed, #until = :until, #mpl = :mpl');
    expect(call.ExpressionAttributeValues[':mpl']).toBe(1000);
  });

  it("usage reports this month's count for a paid plan", async () => {
    get
      .mockResolvedValueOnce(paid())
      .mockResolvedValueOnce({ Item: { productsUsed: 120 } });
    expect(await getTrialUsage(T, ON)).toMatchObject({
      status: 'subscribed', period: 'month', productsUsed: 120, productLimit: 500, remaining: 380,
    });
  });

  it('a failed create gives the monthly slot back when there was no trial slot', async () => {
    transactWrite
      .mockRejectedValueOnce(cancelled('ConditionalCheckFailed', 'None')) // no trial marker
      .mockResolvedValueOnce({});
    await releaseProductSlot(T, 'p1', ON);
    const [del] = transactWrite.mock.calls[1]![0].TransactItems;
    expect(del.Delete.Key.SK).toBe(monthProductSK(monthKey(), 'p1'));
  });
});

describe('trial usage event for the seller bell (product.trial.usage)', () => {
  const sent: Array<Record<string, unknown>> = [];
  beforeEach(async () => {
    sent.length = 0;
    const { _setTrialEventsClient } = await import('../trial-events');
    _setTrialEventsClient({
      send: async (cmd: { input: { Entries: Array<Record<string, unknown>> } }) => {
        sent.push(...cmd.input.Entries);
        return {};
      },
    } as never);
  });
  afterEach(() => {
    delete process.env['EVENT_BUS_NAME'];
  });

  it('sent from 3 products left, with the count after this product', async () => {
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-test';
    transactWrite.mockResolvedValue({});
    get.mockResolvedValue(entitlement({ productsUsed: 12 }));
    expect(await reserveProductSlot(T, 'p12', ON)).toBe('reserved');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ Source: 'merch-os.product', DetailType: 'product.trial.usage', EventBusName: 'merch-os-events-test' });
    expect(JSON.parse(sent[0]!['Detail'] as string)).toEqual({ tenantId: T, productsUsed: 12, productLimit: 15 });
  });

  it('not sent earlier in the trial, nor where the bus is not configured', async () => {
    transactWrite.mockResolvedValue({});
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-test';
    get.mockResolvedValue(entitlement({ productsUsed: 11 }));
    await reserveProductSlot(T, 'p11', ON);
    delete process.env['EVENT_BUS_NAME'];
    get.mockResolvedValue(entitlement({ productsUsed: 14 }));
    await reserveProductSlot(T, 'p14', ON);
    expect(sent).toHaveLength(0);
  });

  it('a failure to send never stops the product being created', async () => {
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-test';
    const { _setTrialEventsClient } = await import('../trial-events');
    _setTrialEventsClient({ send: async () => { throw new Error('EventBridge down'); } } as never);
    transactWrite.mockResolvedValue({});
    get.mockResolvedValue(entitlement({ productsUsed: 15 }));
    expect(await reserveProductSlot(T, 'p15', ON)).toBe('reserved');
  });
});
