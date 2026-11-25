import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

process.env['CHAT_TABLE'] = process.env['CHAT_TABLE'] ?? 'chat-test';

import { touchPresence } from '../lib/store';

const ddb = mockClient(DynamoDBDocumentClient);

beforeEach(() => ddb.reset());

describe('presence heartbeat', () => {
  it('aliases "online" (a DynamoDB reserved word), keeping the agent switch as it is', async () => {
    ddb.on(UpdateCommand).resolves({});
    await touchPresence('agent-1');
    const input = ddb.commandCalls(UpdateCommand)[0]!.args[0].input;
    expect(input.UpdateExpression).toBe('SET agentId = :id, lastSeenAt = :t, #online = if_not_exists(#online, :off)');
    expect(input.ExpressionAttributeNames).toEqual({ '#online': 'online' });
    expect(input.Key).toEqual({ PK: 'PRESENCE', SK: 'AGENT#agent-1' });
  });
});

/**
 * The mocks above cannot see what real DynamoDB rejects, so check every
 * expression in the store for attribute names DynamoDB reserves. (This bug
 * took the Support inbox offline: every agent connect failed.)
 */
describe('store expressions use no bare reserved words', () => {
  const RESERVED = ['online', 'name', 'status', 'count', 'date', 'data', 'timestamp', 'ttl', 'value', 'user', 'role', 'type', 'source', 'comment', 'size', 'level', 'hour', 'current', 'connection', 'session'];
  const src = readFileSync(join(__dirname, '../lib/store.ts'), 'utf8');
  const expressions = [...src.matchAll(/(?:Update|Condition|KeyCondition|Projection|Filter)Expression:\s*(['`])([\s\S]*?)\1/g)].map((m) => m[2]!);

  it('finds the expressions', () => {
    expect(expressions.length).toBeGreaterThan(5);
  });

  it.each(RESERVED)('"%s" is always aliased', (word) => {
    const bare = new RegExp(`(^|[^#:\\w])${word}(?![\\w])`, 'i');
    expect(expressions.filter((e) => bare.test(e))).toEqual([]);
  });
});
