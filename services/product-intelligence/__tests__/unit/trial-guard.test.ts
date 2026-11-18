import { describe, it, expect, vi, beforeEach } from 'vitest';

const assertCanGenerate = vi.fn();
vi.mock('../../../shared/entitlements/trial-gate', async (orig) => ({
  ...(await orig<typeof import('../../../shared/entitlements/trial-gate')>()),
  assertCanGenerate: (...a: unknown[]) => assertCanGenerate(...a),
}));

import { trialGateResponse, trialFailedResult } from '../../handlers/trial-guard';
import { TrialLimitReachedError, TrialNotActivatedError } from '../../../shared/entitlements/trial-gate';
import { generateRequestSchema } from '../../schemas/generate.schema';
import { batchGenerationRequestSchema } from '../../schemas/batch.schema';

beforeEach(() => {
  // Braces matter: returning the mock from beforeEach makes vitest call it as a teardown hook.
  assertCanGenerate.mockReset();
});

describe('trialGateResponse (used by /generate)', () => {
  it('lets the request through (null) when the gate allows it, passing tenant and product', async () => {
    assertCanGenerate.mockResolvedValue(undefined);
    expect(await trialGateResponse('t1', 'p1')).toBeNull();
    expect(assertCanGenerate).toHaveBeenCalledWith('t1', 'p1');
  });

  it.each([
    [new TrialLimitReachedError(), 'TRIAL_LIMIT_REACHED'],
    [new TrialNotActivatedError(), 'TRIAL_NOT_ACTIVATED'],
  ])('answers 402 Payment Required with the error code when the gate refuses (%#)', async (err, code) => {
    assertCanGenerate.mockRejectedValue(err);
    const res = (await trialGateResponse('t1', undefined)) as { statusCode: number; body: string; headers: Record<string, string> };
    expect(res.statusCode).toBe(402);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(res.body).error).toEqual({ code, message: err.message });
  });

  it('NEVER treats an unexpected failure as "allowed": it is rethrown', async () => {
    assertCanGenerate.mockRejectedValue(new Error('dynamo down'));
    await expect(trialGateResponse('t1', 'p1')).rejects.toThrow('dynamo down');
  });
});

describe('trialFailedResult (used by /batch)', () => {
  it('is a failed item carrying the gate error, shaped like the budget failure', () => {
    const r = trialFailedResult('title', 'TRIAL_LIMIT_REACHED', 'used up');
    expect(r.status).toBe('failed');
    expect(r.type).toBe('title');
    expect(r.error).toEqual({ code: 'TRIAL_LIMIT_REACHED', message: 'used up' });
    expect(r.metadata.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(r.confidenceScore).toBe(0);
    expect(typeof r.resultId).toBe('string');
  });
});

describe('request schemas accept an optional productId', () => {
  const base = { type: 'title', productData: { name: 'x' } };
  it('accepts it, and accepts its absence', () => {
    expect(generateRequestSchema.safeParse({ ...base, productId: 'a1b2-c3' }).success).toBe(true);
    expect(generateRequestSchema.safeParse(base).success).toBe(true);
  });
  it.each(['', 'a b', '../x', 'x'.repeat(101), 'p;DROP'])('rejects a malformed productId (%j)', (id) => {
    expect(generateRequestSchema.safeParse({ ...base, productId: id }).success).toBe(false);
  });
  it('carries it through on each batch item', () => {
    const r = batchGenerationRequestSchema.safeParse({ items: [{ ...base, productId: 'p1' }] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0]!.productId).toBe('p1');
  });
});
