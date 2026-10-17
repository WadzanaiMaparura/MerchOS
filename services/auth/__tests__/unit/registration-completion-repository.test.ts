import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, TransactWriteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import {
  RegistrationCompletionRepository,
  RegistrationConsistencyError,
  ownerProfileSK,
  consentSK,
} from '../../registration/registration-completion-repository';
import type { CompleteRegistrationInput } from '../../registration/types';

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

const ddbMock = mockClient(DynamoDBDocumentClient);

const TABLE = 'merch-os-tenants-test';

function makeInput(overrides: Partial<CompleteRegistrationInput> = {}): CompleteRegistrationInput {
  return {
    tenantId: 'server-tenant-1',
    userId: 'user-1',
    email: 'seller@example.com',
    fullName: 'Ada Lovelace',
    phoneNumber: '+27831234567',
    organisationName: 'Analytical Engines',
    marketingConsent: { granted: true, capturedAt: '2026-01-01T00:00:00.000Z' },
    registrationId: 'reg-1',
    ...overrides,
  };
}

function repo() {
  return new RegistrationCompletionRepository({
    tableName: TABLE,
    docClient: ddbMock as unknown as DynamoDBDocumentClient,
  });
}

/** Build a TransactionCanceledException with the given reason codes. */
function canceled(codes: string[]): TransactionCanceledException {
  return new TransactionCanceledException({
    $metadata: {},
    message: 'Transaction cancelled',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });
}

const PK = 'TENANT#server-tenant-1';

/** The three durable records as a COMPLETE, matching prior commit. */
function existingTenant(overrides: Record<string, unknown> = {}) {
  return {
    PK,
    SK: 'METADATA',
    tenantId: 'server-tenant-1',
    organisationName: 'Analytical Engines',
    status: 'active',
    ownerId: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    registrationId: 'reg-1',
    ...overrides,
  };
}
function existingProfile(overrides: Record<string, unknown> = {}) {
  return {
    PK,
    SK: ownerProfileSK('user-1'),
    tenantId: 'server-tenant-1',
    userId: 'user-1',
    email: 'seller@example.com',
    fullName: 'Ada Lovelace',
    phoneNumber: '+27831234567',
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
function existingConsent(overrides: Record<string, unknown> = {}) {
  return {
    PK,
    SK: consentSK('user-1'),
    tenantId: 'server-tenant-1',
    userId: 'user-1',
    type: 'marketing',
    granted: true,
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Stubs the three read-back GetCommands by SK. Pass undefined for a record to
 * simulate it being absent.
 */
function stubReadBack(records: {
  tenant?: Record<string, unknown>;
  profile?: Record<string, unknown>;
  consent?: Record<string, unknown>;
}) {
  ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: records.tenant });
  ddbMock
    .on(GetCommand, { Key: { PK, SK: ownerProfileSK('user-1') } })
    .resolves({ Item: records.profile });
  ddbMock
    .on(GetCommand, { Key: { PK, SK: consentSK('user-1') } })
    .resolves({ Item: records.consent });
}

describe('RegistrationCompletionRepository', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('commits tenant, owner-profile and consent in ONE transaction with create-only conditions', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    const result = await repo().complete(makeInput());

    expect(result).toEqual({ committed: true });
    const calls = ddbMock.commandCalls(TransactWriteCommand);
    expect(calls).toHaveLength(1);

    const items = calls[0].args[0].input.TransactItems ?? [];
    expect(items).toHaveLength(3);

    // All three target the same table and share the tenant partition key.
    const puts = items.map((i) => i.Put!);
    for (const put of puts) {
      expect(put.TableName).toBe(TABLE);
      expect(put.Item!['PK']).toBe('TENANT#server-tenant-1');
      // Create-only: must not overwrite an existing record (idempotency guard).
      expect(put.ConditionExpression).toContain('attribute_not_exists(PK)');
      expect(put.ConditionExpression).toContain('attribute_not_exists(SK)');
    }

    // Correct SK layout.
    const bySk = Object.fromEntries(puts.map((p) => [p.Item!['SK'], p.Item!]));
    expect(bySk['METADATA']).toBeDefined();
    expect(bySk[ownerProfileSK('user-1')]).toBeDefined();
    expect(bySk[consentSK('user-1')]).toBeDefined();
  });

  it('persists the full profile + consent fields using the server tenantId and verified identity', async () => {
    ddbMock.on(TransactWriteCommand).resolves({});

    await repo().complete(makeInput());

    const items = ddbMock.commandCalls(TransactWriteCommand)[0].args[0].input.TransactItems ?? [];
    const bySk = Object.fromEntries(items.map((i) => [i.Put!.Item!['SK'], i.Put!.Item!]));

    expect(bySk['METADATA']).toMatchObject({
      tenantId: 'server-tenant-1',
      organisationName: 'Analytical Engines',
      status: 'active',
      ownerId: 'user-1',
      registrationId: 'reg-1',
    });
    expect(bySk[ownerProfileSK('user-1')]).toMatchObject({
      tenantId: 'server-tenant-1',
      userId: 'user-1',
      email: 'seller@example.com',
      fullName: 'Ada Lovelace',
      phoneNumber: '+27831234567',
      role: 'owner',
    });
    expect(bySk[consentSK('user-1')]).toMatchObject({
      tenantId: 'server-tenant-1',
      userId: 'user-1',
      type: 'marketing',
      granted: true,
      // Original capture time preserved (not the completion time).
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('idempotent retry: a cancelled transaction whose THREE records all exist and match resolves committed:false', async () => {
    // Fully completed prior commit: all three records present + matching.
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    stubReadBack({ tenant: existingTenant(), profile: existingProfile(), consent: existingConsent() });

    const result = await repo().complete(makeInput());

    expect(result).toEqual({ committed: false });
    // It actually read all three records back to verify (did not trust codes).
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(3);
  });

  it('uses STRONGLY CONSISTENT reads for all three verification reads', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    stubReadBack({ tenant: existingTenant(), profile: existingProfile(), consent: existingConsent() });

    await repo().complete(makeInput());

    const getCalls = ddbMock.commandCalls(GetCommand);
    expect(getCalls).toHaveLength(3);
    // Deciding whether a prior atomic transaction committed must not rely on
    // eventually consistent reads — every verification Get requests ConsistentRead.
    for (const call of getCalls) {
      expect(call.args[0].input.ConsistentRead).toBe(true);
    }
    // And all three SKs are covered by a consistent read.
    const consistentSks = getCalls
      .filter((c) => c.args[0].input.ConsistentRead === true)
      .map((c) => c.args[0].input.Key?.['SK']);
    expect(consistentSks).toEqual(
      expect.arrayContaining(['METADATA', ownerProfileSK('user-1'), consentSK('user-1')]),
    );
  });

  it('fails closed: cancelled transaction but the OWNER PROFILE is missing (tenant exists only) → throws', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['None', 'ConditionalCheckFailed', 'None']));
    // Tenant metadata landed on a prior partial attempt, but no profile/consent.
    stubReadBack({ tenant: existingTenant(), profile: undefined, consent: undefined });

    await expect(repo().complete(makeInput())).rejects.toBeInstanceOf(RegistrationConsistencyError);
  });

  it('fails closed: cancelled transaction but the CONSENT record is missing → throws', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'None']));
    stubReadBack({ tenant: existingTenant(), profile: existingProfile(), consent: undefined });

    await expect(repo().complete(makeInput())).rejects.toBeInstanceOf(RegistrationConsistencyError);
  });

  it('fails closed: an existing record has CONFLICTING ownership (different registrationId) → throws', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    // All three exist, but the tenant slot belongs to a DIFFERENT registration.
    stubReadBack({
      tenant: existingTenant({ registrationId: 'some-other-registration' }),
      profile: existingProfile(),
      consent: existingConsent(),
    });

    await expect(repo().complete(makeInput())).rejects.toBeInstanceOf(RegistrationConsistencyError);
  });

  it('fails closed: an existing profile belongs to a DIFFERENT user → throws', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    stubReadBack({
      tenant: existingTenant(),
      profile: existingProfile({ userId: 'different-user' }),
      consent: existingConsent(),
    });

    await expect(repo().complete(makeInput())).rejects.toBeInstanceOf(RegistrationConsistencyError);
  });

  // ---------------------------------------------------------------------------
  // Full field verification: records that belong to the right user but hold
  // INCORRECT registration data must still fail closed (pending retained).
  // ---------------------------------------------------------------------------

  /**
   * All three records exist for the correct user, but one field diverges from
   * the expected input. Every such case must throw RegistrationConsistencyError
   * so the PostConfirmation flow keeps the pending record and emits no event.
   */
  function expectFailClosedWith(records: {
    tenant?: Record<string, unknown>;
    profile?: Record<string, unknown>;
    consent?: Record<string, unknown>;
  }) {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    stubReadBack({
      tenant: records.tenant ?? existingTenant(),
      profile: records.profile ?? existingProfile(),
      consent: records.consent ?? existingConsent(),
    });
    return expect(repo().complete(makeInput())).rejects.toBeInstanceOf(RegistrationConsistencyError);
  }

  it('fails closed: tenant metadata organisationName does not match → throws', async () => {
    await expectFailClosedWith({ tenant: existingTenant({ organisationName: 'Someone Else Ltd' }) });
  });

  it('fails closed: tenant metadata status is not active → throws', async () => {
    await expectFailClosedWith({ tenant: existingTenant({ status: 'suspended' }) });
  });

  it('fails closed: owner profile fullName does not match → throws', async () => {
    await expectFailClosedWith({ profile: existingProfile({ fullName: 'Someone Else' }) });
  });

  it('fails closed: owner profile phoneNumber does not match → throws', async () => {
    await expectFailClosedWith({ profile: existingProfile({ phoneNumber: '+27110000000' }) });
  });

  it('fails closed: owner profile email does not match → throws', async () => {
    await expectFailClosedWith({ profile: existingProfile({ email: 'other@example.com' }) });
  });

  it('fails closed: owner profile role is not owner → throws', async () => {
    await expectFailClosedWith({ profile: existingProfile({ role: 'editor' }) });
  });

  it('fails closed: consent granted state does not match → throws', async () => {
    // Expected input has granted:true; the stored record says false.
    await expectFailClosedWith({ consent: existingConsent({ granted: false }) });
  });

  it('fails closed: consent capturedAt timestamp does not match → throws', async () => {
    await expectFailClosedWith({ consent: existingConsent({ capturedAt: '2025-12-31T23:59:59.000Z' }) });
  });

  it('fails closed: consent type is not marketing → throws', async () => {
    await expectFailClosedWith({ consent: existingConsent({ type: 'transactional' }) });
  });

  it('idempotent retry succeeds when EVERY field matches (full-field verification passes)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
    stubReadBack({ tenant: existingTenant(), profile: existingProfile(), consent: existingConsent() });

    const result = await repo().complete(makeInput());

    expect(result).toEqual({ committed: false });
  });

  it('propagates (throws) when the cancellation has NO conditional failure (e.g. pure throttling) — no read-back', async () => {
    ddbMock
      .on(TransactWriteCommand)
      .rejects(canceled(['TransactionConflict', 'TransactionConflict', 'TransactionConflict']));

    await expect(repo().complete(makeInput())).rejects.toBeInstanceOf(TransactionCanceledException);
    // A non-"records exist" cancellation must NOT trigger a verification read.
    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });

  it('propagates any non-transaction error (e.g. access denied) for safe retry', async () => {
    ddbMock.on(TransactWriteCommand).rejects(new Error('AccessDeniedException'));

    await expect(repo().complete(makeInput())).rejects.toThrow('AccessDeniedException');
  });

  it('requires a table name (throws when TENANTS_TABLE is absent and none supplied)', () => {
    const prev = process.env['TENANTS_TABLE'];
    delete process.env['TENANTS_TABLE'];
    try {
      expect(
        () =>
          new RegistrationCompletionRepository({
            docClient: ddbMock as unknown as DynamoDBDocumentClient,
          }),
      ).toThrow(/TENANTS_TABLE/);
    } finally {
      if (prev !== undefined) process.env['TENANTS_TABLE'] = prev;
    }
  });
});
