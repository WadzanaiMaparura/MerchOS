import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  PendingRegistrationRepository,
  PENDING_REGISTRATION_TTL_SECONDS,
  pendingRegistrationPK,
} from '../../registration/pending-registration-repository';

const ddbMock = mockClient(DynamoDBDocumentClient);

function makeRepo() {
  // Let the repository build its own doc client; aws-sdk-client-mock patches
  // DynamoDBDocumentClient globally so all sends are intercepted.
  return new PendingRegistrationRepository({
    tableName: 'merch-os-invitations-test',
    ttlSeconds: PENDING_REGISTRATION_TTL_SECONDS,
  });
}

describe('PendingRegistrationRepository', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('creates a record with server-generated registrationId and tenantId', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = makeRepo();

    const result = await repo.create({
      email: 'seller@example.com',
      fullName: 'Ada Lovelace',
      phoneNumber: '+27831234567',
      organisationName: 'Analytical Engines',
      marketingConsent: true,
    });

    expect(result.registrationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.tenantId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(result.registrationId).not.toBe(result.tenantId);
  });

  it('writes under the PENDINGREG# key with a METADATA sort key and TTL', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = makeRepo();

    await repo.create({
      email: 'seller@example.com',
      fullName: 'Ada',
      phoneNumber: '+27831234567',
      organisationName: 'Org',
      marketingConsent: false,
    });

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    const item = put.Item as Record<string, unknown>;
    expect(String(item.PK)).toMatch(/^PENDINGREG#/);
    expect(item.SK).toBe('METADATA');
    expect(item.expiresAt).toBeTypeOf('number');
    expect(item.expiresAt as number).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // Guards against id collision.
    expect(put.ConditionExpression).toContain('attribute_not_exists(PK)');
  });

  it('NEVER stores password, passwordConfirmation, or verification code', async () => {
    ddbMock.on(PutCommand).resolves({});
    const repo = makeRepo();

    await repo.create({
      email: 'seller@example.com',
      fullName: 'Ada',
      phoneNumber: '+27831234567',
      organisationName: 'Org',
      marketingConsent: false,
    });

    const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item as Record<string, unknown>;
    const keys = Object.keys(item).map((k) => k.toLowerCase());
    expect(keys.some((k) => k.includes('password'))).toBe(false);
    expect(keys.some((k) => k.includes('code'))).toBe(false);
    expect(keys.some((k) => k.includes('confirm'))).toBe(false);
  });

  it('findActiveByEmail returns null when all matches are expired', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: pendingRegistrationPK('old'),
          SK: 'METADATA',
          registrationId: 'old',
          email: 'seller@example.com',
          tenantId: 't',
          status: 'pending',
          createdAt: '2020-01-01T00:00:00.000Z',
          expiresAt: nowSeconds - 100,
        },
      ],
    });
    const repo = makeRepo();

    const result = await repo.findActiveByEmail('seller@example.com');
    expect(result).toBeNull();
  });

  it('findActiveByEmail returns the most recent active record', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: pendingRegistrationPK('older'),
          SK: 'METADATA',
          registrationId: 'older',
          email: 'seller@example.com',
          tenantId: 't-older',
          status: 'pending',
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: nowSeconds + 1000,
        },
        {
          PK: pendingRegistrationPK('newer'),
          SK: 'METADATA',
          registrationId: 'newer',
          email: 'seller@example.com',
          tenantId: 't-newer',
          status: 'pending',
          createdAt: '2026-02-01T00:00:00.000Z',
          expiresAt: nowSeconds + 1000,
        },
      ],
    });
    const repo = makeRepo();

    const result = await repo.findActiveByEmail('seller@example.com');
    expect(result?.registrationId).toBe('newer');
  });

  it('deleteById issues a delete for the correct key', async () => {
    ddbMock.on(DeleteCommand).resolves({});
    const repo = makeRepo();

    await repo.deleteById('reg-1');

    const del = ddbMock.commandCalls(DeleteCommand)[0].args[0].input;
    expect(del.Key).toEqual({ PK: pendingRegistrationPK('reg-1'), SK: 'METADATA' });
  });

  it('isExpired reflects the TTL boundary', () => {
    const now = 1000;
    expect(PendingRegistrationRepository.isExpired({ expiresAt: 999 }, now)).toBe(true);
    expect(PendingRegistrationRepository.isExpired({ expiresAt: 1001 }, now)).toBe(false);
  });
});
