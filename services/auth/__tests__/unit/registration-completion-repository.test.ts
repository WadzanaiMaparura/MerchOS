import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

import {
  RegistrationCompletionRepository,
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

  it('is idempotent: a pure ConditionalCheckFailed cancellation resolves committed:false (no throw)', async () => {
    ddbMock
      .on(TransactWriteCommand)
      .rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));

    const result = await repo().complete(makeInput());
    expect(result).toEqual({ committed: false });
  });

  it('treats a mix of ConditionalCheckFailed + None as an idempotent retry', async () => {
    // Can occur when only some of the three records already existed.
    ddbMock
      .on(TransactWriteCommand)
      .rejects(canceled(['ConditionalCheckFailed', 'None', 'ConditionalCheckFailed']));

    const result = await repo().complete(makeInput());
    expect(result).toEqual({ committed: false });
  });

  it('propagates (throws) when a cancellation includes a non-conditional reason (e.g. throttling)', async () => {
    ddbMock
      .on(TransactWriteCommand)
      .rejects(canceled(['ConditionalCheckFailed', 'TransactionConflict', 'None']));

    await expect(repo().complete(makeInput())).rejects.toBeInstanceOf(TransactionCanceledException);
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
