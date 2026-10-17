import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, TransactWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import {
  completeOwnerProfile,
  TransientPersistenceError,
  __setProfileCompletionDocClientForTesting,
  type CompleteOwnerProfileParams,
} from '../../repository/profile-completion-repository';

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);
const TABLE = 'merch-os-tenants-test';
const PK = 'TENANT#tenant-1';
// Canonical keys (shared with PR #28 PostConfirmation path).
const OWNER_SK = 'PROFILE#USER#user-1';
const CONSENT_SK = 'CONSENT#USER#user-1';

function params(overrides: Partial<CompleteOwnerProfileParams> = {}): CompleteOwnerProfileParams {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    email: 'seller@example.com',
    role: 'owner',
    fullName: 'Ada Lovelace',
    phone: '+27831234567',
    organisationName: 'Analytical Engines',
    registrationId: 'reg-1',
    consentGranted: true,
    consentChannels: ['email'],
    consentTextVersion: 'draft-2026-10-11',
    ...overrides,
  };
}

function canceled(codes: string[]): TransactionCanceledException {
  return new TransactionCanceledException({
    $metadata: {},
    message: 'Transaction cancelled',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

describe('profile-completion-repository (canonical schema)', () => {
  beforeEach(() => {
    ddbMock.reset();
    __setProfileCompletionDocClientForTesting(ddbMock as unknown as DynamoDBDocumentClient);
  });

  it('writes the CANONICAL keys/fields in one transaction (ownerId, PROFILE#USER#, CONSENT#USER#)', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const result = await completeOwnerProfile(TABLE, params());

    expect(result).toEqual({ result: 'created' });
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(3);
    const bySk = Object.fromEntries(items.map((i) => [i.Put!.Item!['SK'], i.Put!.Item!]));

    // Tenant metadata — canonical ownerId field.
    expect(bySk['METADATA']).toMatchObject({
      PK, tenantId: 'tenant-1', organisationName: 'Analytical Engines', ownerId: 'user-1', status: 'active',
    });
    // Owner profile — canonical SK + phoneNumber field + role owner.
    expect(bySk[OWNER_SK]).toMatchObject({
      PK, tenantId: 'tenant-1', userId: 'user-1', email: 'seller@example.com',
      fullName: 'Ada Lovelace', phoneNumber: '+27831234567', role: 'owner',
    });
    // Consent — canonical SK + required fields.
    expect(bySk[CONSENT_SK]).toMatchObject({ PK, tenantId: 'tenant-1', userId: 'user-1', type: 'marketing', granted: true });
    // Create-only guard on each item.
    for (const i of items) {
      expect(i.Put!.ConditionExpression).toBe('attribute_not_exists(SK)');
    }
  });

  it('preserves the richer consent AUDIT metadata (channels, consentTextVersion, source)', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await completeOwnerProfile(TABLE, params({ consentGranted: true, consentChannels: ['email', 'sms'] }));
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    const consent = items.map((i) => i.Put!.Item!).find((it) => it['SK'] === CONSENT_SK)!;
    expect(consent['channels']).toEqual(['email', 'sms']);
    expect(consent['consentTextVersion']).toBe('draft-2026-10-11');
    expect(consent['source']).toBe('profile-completion');
  });

  it('stores NO channels when consent not granted (channels only under explicit opt-in)', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await completeOwnerProfile(TABLE, params({ consentGranted: false, consentChannels: [] }));
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    const consent = items.map((i) => i.Put!.Item!).find((it) => it['SK'] === CONSENT_SK)!;
    expect(consent['granted']).toBe(false);
    expect(consent['channels']).toEqual([]);
  });

  it('idempotent replay: all three records exist for THIS subject -> already_completed', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: { ownerId: 'user-1', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({ Item: { userId: 'user-1', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: CONSENT_SK } }).resolves({ Item: { userId: 'user-1', tenantId: 'tenant-1' } });

    const result = await completeOwnerProfile(TABLE, params());
    expect(result).toEqual({ result: 'already_completed' });
    // Verification reads are strongly consistent.
    for (const c of ddbMock.commandCalls(GetCommand)) {
      expect(c.args[0].input.ConsistentRead).toBe(true);
    }
  });

  it('conflict: owner profile belongs to a DIFFERENT subject -> never overwrites', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: { ownerId: 'other', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({ Item: { userId: 'other', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: CONSENT_SK } }).resolves({});

    const result = await completeOwnerProfile(TABLE, params());
    expect(result.result).toBe('conflict');
  });

  it('conflict: partial/inconsistent durable state fails safe', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'None', 'None']));
    ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: { ownerId: 'user-1', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({}); // owner missing
    ddbMock.on(GetCommand, { Key: { PK, SK: CONSENT_SK } }).resolves({});

    const result = await completeOwnerProfile(TABLE, params());
    expect(result.result).toBe('conflict');
  });

  it('throws TransientPersistenceError on a purely transient cancellation (caller retries)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['TransactionConflict', 'None', 'None']));
    await expect(completeOwnerProfile(TABLE, params())).rejects.toBeInstanceOf(TransientPersistenceError);
  });
});
