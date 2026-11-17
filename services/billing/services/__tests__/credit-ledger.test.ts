import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  grantCredits,
  consumeCredit,
  getBalance,
  CreditLimitError,
} from '../credit-ledger';

const ddb = mockClient(DynamoDBDocumentClient);

function conditionalFailure(): Error {
  return Object.assign(new Error('The conditional request failed'), {
    name: 'ConditionalCheckFailedException',
  });
}

/**
 * Words DynamoDB treats as reserved. Using any of them as a bare attribute name
 * in an expression is a ValidationException at runtime (this is exactly what
 * broke credit grants the first time: `consumed`).
 */
const RESERVED = ['consumed', 'status', 'name', 'data', 'timestamp', 'count', 'role', 'size', 'source', 'type', 'year', 'month'];

/** Strip #aliases, :values and function names, leaving bare identifiers. */
function bareIdentifiers(expr: string): string[] {
  return expr
    .replace(/#\w+/g, ' ')
    .replace(/:\w+/g, ' ')
    .replace(/\b(attribute_exists|attribute_not_exists|if_not_exists|begins_with|SET|ADD|REMOVE|DELETE|AND|OR|NOT)\b/g, ' ')
    .split(/[^A-Za-z_]+/)
    .filter(Boolean);
}

function allExpressions(): string[] {
  const out: string[] = [];
  for (const C of [PutCommand, UpdateCommand, GetCommand]) {
    for (const call of ddb.commandCalls(C as never)) {
      const input = call.args[0].input as Record<string, string | undefined>;
      for (const f of ['UpdateExpression', 'ConditionExpression', 'KeyConditionExpression']) {
        if (input[f]) out.push(input[f] as string);
      }
    }
  }
  return out;
}

beforeEach(() => {
  ddb.reset();
});

describe('credit-ledger DynamoDB expression hygiene', () => {
  it('never uses a reserved word as a bare attribute name, on any code path', async () => {
    ddb.on(GetCommand).resolves({ Item: { granted: 150, consumed: 10, overage: 0 } });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({ Attributes: { granted: 150, consumed: 11, overage: 0 } });

    await grantCredits('t1', '202611', 400);
    await consumeCredit('t1', '202611', 1, 'hard_cap');
    await consumeCredit('t1', '202611', 1, 'soft_cap');

    const exprs = allExpressions();
    expect(exprs.length).toBeGreaterThan(0);
    for (const expr of exprs) {
      const bare = bareIdentifiers(expr).filter((w) => RESERVED.includes(w.toLowerCase()));
      expect(bare, `bare reserved word in: ${expr}`).toEqual([]);
    }
  });

  it('never puts arithmetic or if_not_exists in a ConditionExpression (illegal in DynamoDB)', async () => {
    ddb.on(GetCommand).resolves({ Item: { granted: 150, consumed: 10, overage: 0 } });
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({ Attributes: { granted: 150, consumed: 11, overage: 0 } });

    await grantCredits('t1', '202611', 400);
    await consumeCredit('t1', '202611', 1, 'hard_cap');
    await consumeCredit('t1', '202611', 1, 'soft_cap');

    for (const C of [PutCommand, UpdateCommand]) {
      for (const call of ddb.commandCalls(C as never)) {
        const cond = (call.args[0].input as { ConditionExpression?: string }).ConditionExpression;
        if (!cond) continue;
        expect(cond, cond).not.toMatch(/if_not_exists/);
        expect(cond, cond).not.toMatch(/\+|\s-\s/);
      }
    }
  });
});

describe('grantCredits', () => {
  it('creates the month record then sets the allowance', async () => {
    ddb.on(PutCommand).resolves({});
    ddb.on(UpdateCommand).resolves({});
    await grantCredits('t1', '202611', 400);

    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(update.ExpressionAttributeValues?.[':g']).toBe(400);
    expect(update.Key?.['SK']).toBe('CREDITS#202611');
  });

  it('does not reset consumption when the month record already exists', async () => {
    ddb.on(PutCommand).rejects(conditionalFailure()); // already exists
    ddb.on(UpdateCommand).resolves({});
    await expect(grantCredits('t1', '202611', 400)).resolves.toBeUndefined();

    const update = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    // Only the allowance (and bookkeeping) is written — consumed is untouched.
    expect(update.UpdateExpression).not.toMatch(/#c\b/);
    expect(update.UpdateExpression).not.toMatch(/#o\b/);
  });

  it('rejects negative or non-finite amounts', async () => {
    await expect(grantCredits('t1', '202611', -1)).rejects.toThrow(/invalid amount/);
    await expect(grantCredits('t1', '202611', Number.NaN)).rejects.toThrow(/invalid amount/);
  });
});

describe('getBalance', () => {
  it('returns zeros when no record exists', async () => {
    ddb.on(GetCommand).resolves({});
    expect(await getBalance('t1', '202611')).toEqual({ granted: 0, consumed: 0, overage: 0, remaining: 0 });
  });

  it('computes remaining', async () => {
    ddb.on(GetCommand).resolves({ Item: { granted: 150, consumed: 40, overage: 0 } });
    expect((await getBalance('t1', '202611')).remaining).toBe(110);
  });
});

describe('consumeCredit — hard_cap', () => {
  it('throws CreditLimitError and writes nothing when the allowance would be exceeded', async () => {
    ddb.on(GetCommand).resolves({ Item: { granted: 150, consumed: 149, overage: 0 } });
    await expect(consumeCredit('t1', '202611', 2, 'hard_cap')).rejects.toBeInstanceOf(CreditLimitError);
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it('blocks when no allowance has been granted at all', async () => {
    ddb.on(GetCommand).resolves({});
    await expect(consumeCredit('t1', '202611', 1, 'hard_cap')).rejects.toBeInstanceOf(CreditLimitError);
  });

  it('allows consumption up to exactly the limit, using an optimistic-lock condition', async () => {
    ddb.on(GetCommand).resolves({ Item: { granted: 150, consumed: 149, overage: 0 } });
    ddb.on(UpdateCommand).resolves({ Attributes: { granted: 150, consumed: 150, overage: 0 } });

    const bal = await consumeCredit('t1', '202611', 1, 'hard_cap');
    expect(bal).toEqual({ granted: 150, consumed: 150, overage: 0, remaining: 0 });

    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.ExpressionAttributeValues?.[':prev']).toBe(149);
    expect(input.ExpressionAttributeValues?.[':next']).toBe(150);
    expect(input.ConditionExpression).toContain('#c = :prev');
  });

  it('retries on contention, re-reading the balance', async () => {
    ddb
      .on(GetCommand)
      .resolvesOnce({ Item: { granted: 150, consumed: 10, overage: 0 } })
      .resolvesOnce({ Item: { granted: 150, consumed: 12, overage: 0 } });
    ddb
      .on(UpdateCommand)
      .rejectsOnce(conditionalFailure()) // someone else consumed first
      .resolvesOnce({ Attributes: { granted: 150, consumed: 13, overage: 0 } });

    const bal = await consumeCredit('t1', '202611', 1, 'hard_cap');
    expect(bal.consumed).toBe(13);
    const updates = ddb.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(2);
    expect(updates[1]!.args[0].input.ExpressionAttributeValues?.[':prev']).toBe(12);
  });

  it('fails closed (CreditLimitError) under persistent contention', async () => {
    ddb.on(GetCommand).resolves({ Item: { granted: 150, consumed: 10, overage: 0 } });
    ddb.on(UpdateCommand).rejects(conditionalFailure());
    await expect(consumeCredit('t1', '202611', 1, 'hard_cap')).rejects.toBeInstanceOf(CreditLimitError);
  });
});

describe('consumeCredit — soft_cap', () => {
  it('lets consumption run past the allowance and records the overage', async () => {
    ddb.on(PutCommand).resolves({});
    ddb
      .on(UpdateCommand)
      .resolvesOnce({ Attributes: { granted: 150, consumed: 152, overage: 0 } }) // increment
      .resolvesOnce({ Attributes: { granted: 150, consumed: 152, overage: 2 } }); // reconcile overage

    const bal = await consumeCredit('t1', '202611', 2, 'soft_cap');
    expect(bal.overage).toBe(2);
    expect(bal.remaining).toBe(0);

    const reconcile = ddb.commandCalls(UpdateCommand)[1]!.args[0].input;
    expect(reconcile.ExpressionAttributeValues?.[':o']).toBe(2);
  });

  it('rejects non-positive or fractional counts', async () => {
    await expect(consumeCredit('t1', '202611', 0)).rejects.toThrow(/positive integer/);
    await expect(consumeCredit('t1', '202611', 1.5)).rejects.toThrow(/positive integer/);
  });
});
