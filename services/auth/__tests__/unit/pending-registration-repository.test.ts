import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  getPendingRegistration,
  deletePendingRegistration,
  isPendingRegistrationExpired,
  resetPendingRegistrationRepositoryClient,
  pendingRegistrationPK,
  PENDING_REGISTRATION_SK,
} from '../../repository/pending-registration-repository';

const ddbMock = mockClient(DynamoDBDocumentClient);
const TABLE = 'merch-os-tenants-dev';

describe('pending-registration-repository', () => {
  beforeEach(() => {
    ddbMock.reset();
    resetPendingRegistrationRepositoryClient();
  });

  it('reads by primary key with a strongly consistent GetItem (no scan/index)', async () => {
    const item = { PK: pendingRegistrationPK('reg-1'), SK: 'META', registrationId: 'reg-1' };
    ddbMock.on(GetCommand).resolves({ Item: item });

    const result = await getPendingRegistration(TABLE, 'reg-1');

    expect(result).toEqual(item);
    const calls = ddbMock.commandCalls(GetCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.Key).toEqual({ PK: 'PENDINGREG#reg-1', SK: PENDING_REGISTRATION_SK });
    expect(input.ConsistentRead).toBe(true);
    expect(input.TableName).toBe(TABLE);
    // Prove there is no index/scan hint on the request.
    expect((input as Record<string, unknown>)['IndexName']).toBeUndefined();
  });

  it('returns undefined when the pending record is absent', async () => {
    ddbMock.on(GetCommand).resolves({});
    expect(await getPendingRegistration(TABLE, 'missing')).toBeUndefined();
  });

  it('isPendingRegistrationExpired: future expiry is not expired, past/zero/missing is expired', () => {
    const now = 1_000_000;
    expect(isPendingRegistrationExpired({ expiresAt: now + 60 }, now)).toBe(false);
    expect(isPendingRegistrationExpired({ expiresAt: now - 1 }, now)).toBe(true);
    expect(isPendingRegistrationExpired({ expiresAt: now }, now)).toBe(true);
    // Missing/invalid TTL is treated as expired (fail safe).
    expect(isPendingRegistrationExpired({ expiresAt: undefined as unknown as number }, now)).toBe(true);
  });

  it('deletes with a conditional attribute_exists(PK) guard', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await deletePendingRegistration(TABLE, 'reg-1');
    const calls = ddbMock.commandCalls(DeleteCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.Key).toEqual({ PK: 'PENDINGREG#reg-1', SK: 'META' });
    expect(input.ConditionExpression).toBe('attribute_exists(PK)');
  });

  it('delete is a no-op (no throw) when the record was already removed concurrently', async () => {
    ddbMock
      .on(DeleteCommand)
      .rejects(Object.assign(new Error('conditional failed'), { name: 'ConditionalCheckFailedException' }));
    await expect(deletePendingRegistration(TABLE, 'reg-1')).resolves.toBeUndefined();
  });

  it('delete surfaces non-conditional errors to the caller', async () => {
    ddbMock
      .on(DeleteCommand)
      .rejects(Object.assign(new Error('boom'), { name: 'InternalServerError' }));
    await expect(deletePendingRegistration(TABLE, 'reg-1')).rejects.toThrow('boom');
  });
});
