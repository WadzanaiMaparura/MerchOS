import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
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
    tableName: 'merch-os-tenants-test',
    ttlSeconds: PENDING_REGISTRATION_TTL_SECONDS,
  });
}

describe('PendingRegistrationRepository', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('uses the approved ~1 hour TTL by default', () => {
    expect(PENDING_REGISTRATION_TTL_SECONDS).toBe(60 * 60);
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

  it('writes to the tenants table under PENDINGREG#/METADATA with a TTL', async () => {
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
    expect(put.TableName).toBe('merch-os-tenants-test');
    const item = put.Item as Record<string, unknown>;
    expect(String(item.PK)).toMatch(/^PENDINGREG#/);
    expect(item.SK).toBe('METADATA');
    expect(item.expiresAt).toBeTypeOf('number');
    expect(item.expiresAt as number).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // ~1 hour TTL (allow a little slack for execution time).
    const delta = (item.expiresAt as number) - Math.floor(Date.now() / 1000);
    expect(delta).toBeLessThanOrEqual(3600);
    expect(delta).toBeGreaterThan(3600 - 60);
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

  it('getById resolves the exact record by registrationId', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: {
        PK: pendingRegistrationPK('reg-1'),
        SK: 'METADATA',
        registrationId: 'reg-1',
        email: 'seller@example.com',
        tenantId: 't-1',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: Math.floor(Date.now() / 1000) + 1000,
      },
    });
    const repo = makeRepo();

    const result = await repo.getById('reg-1');
    expect(result?.registrationId).toBe('reg-1');

    const get = ddbMock.commandCalls(GetCommand)[0].args[0].input;
    expect(get.Key).toEqual({ PK: pendingRegistrationPK('reg-1'), SK: 'METADATA' });
  });

  it('getById returns null when the record does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});
    const repo = makeRepo();
    expect(await repo.getById('missing')).toBeNull();
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
