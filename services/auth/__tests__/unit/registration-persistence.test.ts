import { describe, it, expect, beforeEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import {
  completeOwnerProfile,
  resetRegistrationRepositoryClient,
  consentSK,
  TransientPersistenceError,
} from '../../repository/registration-persistence';

const ddbMock = mockClient(DynamoDBDocumentClient);
const TABLE = 'merch-os-tenants-dev';

const baseParams = {
  tenantId: 'tenant-1',
  userId: 'sub-1',
  email: 'owner@example.com',
  role: 'owner',
  fullName: 'Owner One',
  phone: '+27123456789',
  organisationName: 'Acme',
  registrationId: 'reg-1',
  consentStatus: 'declined' as const,
  consentChannels: [] as Array<'email' | 'sms'>,
  consentTextVersion: 'draft-2026-10-11',
};

function cancelled(reasons: Array<{ Code: string }>): TransactionCanceledException {
  return new TransactionCanceledException({
    message: 'cancelled',
    $metadata: {},
    CancellationReasons: reasons,
  });
}

describe('completeOwnerProfile', () => {
  beforeEach(() => {
    ddbMock.reset();
    resetRegistrationRepositoryClient();
  });

  it('creates tenant, owner and consent atomically (one TransactWrite, 3 puts, attribute_not_exists)', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const outcome = await completeOwnerProfile(TABLE, baseParams);

    expect(outcome).toEqual({ result: 'created' });
    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);
    const items = calls[0].args[0].input.TransactItems!;
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.Put!.ConditionExpression).toBe('attribute_not_exists(SK)');
    }
    // keys
    expect(items[0].Put!.Item!.SK).toBe('METADATA');
    expect(items[1].Put!.Item!.SK).toBe('USER#sub-1');
    expect(items[2].Put!.Item!.SK).toBe(consentSK('sub-1', 'reg-1'));
  });

  it('persists no channels when consent is declined', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await completeOwnerProfile(TABLE, { ...baseParams, consentStatus: 'declined', consentChannels: ['email'] });
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(items[2].Put!.Item!.channels).toEqual([]);
  });

  it('persists selected channels when consent granted', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});
    await completeOwnerProfile(TABLE, { ...baseParams, consentStatus: 'granted', consentChannels: ['email', 'sms'] });
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    expect(items[2].Put!.Item!.channels).toEqual(['email', 'sms']);
    expect(items[2].Put!.Item!.status).toBe('granted');
  });

  it('treats a fully-present prior commit for THIS subject as already_completed (verification read)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }, { Code: 'None' }]));
    // verification reads: metadata, owner, consent all exist for this subject
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: 'METADATA' } })
      .resolves({ Item: { ownerUserId: 'sub-1', tenantId: 'tenant-1' } });
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: 'USER#sub-1' } })
      .resolves({ Item: { userId: 'sub-1', tenantId: 'tenant-1' } });
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: consentSK('sub-1', 'reg-1') } })
      .resolves({ Item: { registrationId: 'reg-1' } });

    const outcome = await completeOwnerProfile(TABLE, baseParams);
    expect(outcome).toEqual({ result: 'already_completed' });
  });

  it('returns conflict when owner belongs to a different subject', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' }]));
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: 'METADATA' } })
      .resolves({ Item: { ownerUserId: 'someone-else', tenantId: 'tenant-1' } });
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: 'USER#sub-1' } })
      .resolves({ Item: { userId: 'someone-else', tenantId: 'tenant-1' } });
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: consentSK('sub-1', 'reg-1') } })
      .resolves({});

    const outcome = await completeOwnerProfile(TABLE, baseParams);
    expect(outcome.result).toBe('conflict');
  });

  it('returns conflict on partial/inconsistent durable state (does not fabricate success)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }, { Code: 'None' }]));
    // metadata exists for us, but owner + consent missing
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: 'METADATA' } })
      .resolves({ Item: { ownerUserId: 'sub-1', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: 'USER#sub-1' } }).resolves({});
    ddbMock
      .on(GetCommand, { Key: { PK: 'TENANT#tenant-1', SK: consentSK('sub-1', 'reg-1') } })
      .resolves({});

    const outcome = await completeOwnerProfile(TABLE, baseParams);
    expect(outcome.result).toBe('conflict');
  });

  it('throws TransientPersistenceError on transaction conflict (retryable, no conditional failure)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(cancelled([{ Code: 'TransactionConflict' }]));
    await expect(completeOwnerProfile(TABLE, baseParams)).rejects.toBeInstanceOf(TransientPersistenceError);
  });

  it('throws TransientPersistenceError on throttling', async () => {
    const err = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    ddbMock.on(TransactWriteCommand).rejects(err);
    await expect(completeOwnerProfile(TABLE, baseParams)).rejects.toBeInstanceOf(TransientPersistenceError);
  });

  // --- Stage A assertion #3: recovery is independent of any pending record ---
  it('creates the tenant with NO prior pending-registration read (recovery works when pending is absent/expired)', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const outcome = await completeOwnerProfile(TABLE, baseParams);

    expect(outcome).toEqual({ result: 'created' });
    // The recovery write path performs exactly one TransactWrite and makes no
    // read against a PENDINGREG# record — so a missing/expired pending record
    // can never block recovery.
    expect(ddbMock.commandCalls(TransactWriteCommand)).toHaveLength(1);
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    const keys = items.map((it) => it.Put!.Item!.SK as string);
    expect(keys.some((k) => k.startsWith('PENDINGREG#'))).toBe(false);
    expect(items.some((it) => (it.Put!.Item!.PK as string).startsWith('PENDINGREG#'))).toBe(false);
  });

  // --- Stage A assertion #5: only genuine, user-supplied data is persisted ---
  it('persists the exact user-supplied organisation name, full name and phone verbatim (nothing fabricated)', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await completeOwnerProfile(TABLE, {
      ...baseParams,
      email: 'owner@acme-corp.example',
      organisationName: 'Acme Trading Co',
      fullName: 'Jane Owner',
      phone: '+27115550100',
    });

    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems!;
    const metadata = items[0].Put!.Item!;
    const owner = items[1].Put!.Item!;

    // Organisation name is the exact submitted value...
    expect(metadata.organisationName).toBe('Acme Trading Co');
    // ...and is NOT derived from the email local-part (the discarded legacy
    // PostConfirmation behaviour).
    expect(metadata.organisationName).not.toBe('owner');
    expect(metadata.organisationName).not.toContain('@');

    // Owner profile carries the submitted name/phone and the trusted-claim email
    // verbatim — no inference or fabrication.
    expect(owner.fullName).toBe('Jane Owner');
    expect(owner.phone).toBe('+27115550100');
    expect(owner.email).toBe('owner@acme-corp.example');
    expect(owner.userId).toBe('sub-1');
    expect(owner.tenantId).toBe('tenant-1');

    // Metadata ownership is the authenticated subject, not anything client-derived.
    expect(metadata.ownerUserId).toBe('sub-1');
    expect(metadata.tenantId).toBe('tenant-1');
  });
});
