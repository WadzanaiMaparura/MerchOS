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

// Durable records that FULLY match the default params() (same-data retry).
// createdAt/capturedAt use different timestamps than a fresh request on purpose —
// the verifier must NOT compare those volatile values for equality.
function storedTenant(overrides: Record<string, unknown> = {}) {
  return {
    PK, SK: 'METADATA', tenantId: 'tenant-1', organisationName: 'Analytical Engines',
    ownerId: 'user-1', registrationId: 'some-earlier-reg-id', status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}
function storedOwner(overrides: Record<string, unknown> = {}) {
  return {
    PK, SK: OWNER_SK, tenantId: 'tenant-1', userId: 'user-1', email: 'seller@example.com',
    fullName: 'Ada Lovelace', phoneNumber: '+27831234567', role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}
function storedConsent(overrides: Record<string, unknown> = {}) {
  return {
    PK, SK: CONSENT_SK, tenantId: 'tenant-1', userId: 'user-1', type: 'marketing',
    granted: true, capturedAt: '2026-01-01T00:00:00.000Z', channels: ['email'],
    consentTextVersion: 'draft-2026-10-11', source: 'profile-completion', ...overrides,
  };
}

/** Stub a conditional cancellation + read-back of the three stored records. */
function stubRetry(records: { tenant?: unknown; owner?: unknown; consent?: unknown }) {
  ddbMock.on(TransactWriteCommand).rejects(canceled(['ConditionalCheckFailed', 'ConditionalCheckFailed', 'ConditionalCheckFailed']));
  ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: records.tenant as Record<string, unknown> | undefined });
  ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({ Item: records.owner as Record<string, unknown> | undefined });
  ddbMock.on(GetCommand, { Key: { PK, SK: CONSENT_SK } }).resolves({ Item: records.consent as Record<string, unknown> | undefined });
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

  it('idempotent same-data replay: all three records exist AND every field matches -> already_completed', async () => {
    // Stored records fully match params() (but with different volatile
    // registrationId/createdAt/capturedAt — which must NOT be compared).
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent() });

    const result = await completeOwnerProfile(TABLE, params());
    expect(result).toEqual({ result: 'already_completed' });
    // Verification reads are strongly consistent.
    for (const c of ddbMock.commandCalls(GetCommand)) {
      expect(c.args[0].input.ConsistentRead).toBe(true);
    }
  });

  it('idempotent replay tolerates different registrationId/timestamps (volatile values not compared)', async () => {
    stubRetry({
      tenant: storedTenant({ registrationId: 'totally-different-reg', createdAt: '2025-06-01T12:00:00.000Z' }),
      owner: storedOwner({ createdAt: '2025-06-01T12:00:00.000Z' }),
      consent: storedConsent({ capturedAt: '2025-06-01T12:00:00.000Z' }),
    });
    const result = await completeOwnerProfile(TABLE, params());
    expect(result).toEqual({ result: 'already_completed' });
  });

  it('conflict: owner profile belongs to a DIFFERENT subject -> never overwrites', async () => {
    stubRetry({
      tenant: storedTenant({ ownerId: 'other' }),
      owner: storedOwner({ userId: 'other' }),
      consent: undefined,
    });
    const result = await completeOwnerProfile(TABLE, params());
    expect(result.result).toBe('conflict');
  });

  it('conflict: partial/inconsistent durable state fails safe (owner missing)', async () => {
    stubRetry({ tenant: storedTenant(), owner: undefined, consent: undefined });
    const result = await completeOwnerProfile(TABLE, params());
    expect(result.result).toBe('conflict');
  });

  // ---------------------------------------------------------------------------
  // Data-mismatch regression: records exist for THIS subject but hold different
  // submitted data. Must fail closed (conflict), never already_completed, never
  // overwrite.
  // ---------------------------------------------------------------------------

  it('conflict when stored organisationName differs from submitted', async () => {
    stubRetry({ tenant: storedTenant({ organisationName: 'Different Org Ltd' }), owner: storedOwner(), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored tenant status is not active', async () => {
    stubRetry({ tenant: storedTenant({ status: 'suspended' }), owner: storedOwner(), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored owner fullName differs from submitted', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner({ fullName: 'Someone Else' }), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored owner phoneNumber differs from submitted', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner({ phoneNumber: '+27110000000' }), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored owner email differs from submitted', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner({ email: 'other@example.com' }), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored consent granted state differs from submitted', async () => {
    // Submitted consentGranted:true, but stored says false.
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent({ granted: false, channels: [] }) });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored consent channels differ from submitted', async () => {
    // Submitted ['email'], stored ['email','sms'].
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent({ channels: ['email', 'sms'] }) });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored consentTextVersion differs from submitted', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent({ consentTextVersion: 'draft-old-version' }) });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when stored consent is missing its capturedAt audit timestamp', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent({ capturedAt: '' }) });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('same-data retry with consent NOT granted and no channels -> already_completed', async () => {
    const notGranted = params({ consentGranted: false, consentChannels: [] });
    stubRetry({
      tenant: storedTenant(),
      owner: storedOwner(),
      consent: storedConsent({ granted: false, channels: [] }),
    });
    const r = await completeOwnerProfile(TABLE, notGranted);
    expect(r).toEqual({ result: 'already_completed' });
  });

  // ---------------------------------------------------------------------------
  // Timestamp / registrationId validity regression. These volatile fields are
  // validated independently (never compared to the request's regenerated
  // values). Missing or malformed values must fail closed.
  // ---------------------------------------------------------------------------

  it('conflict when tenant registrationId is missing', async () => {
    stubRetry({ tenant: storedTenant({ registrationId: undefined }), owner: storedOwner(), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when tenant registrationId is an empty string', async () => {
    stubRetry({ tenant: storedTenant({ registrationId: '' }), owner: storedOwner(), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when tenant createdAt is a malformed timestamp', async () => {
    stubRetry({ tenant: storedTenant({ createdAt: 'not-a-date' }), owner: storedOwner(), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when tenant createdAt is missing', async () => {
    stubRetry({ tenant: storedTenant({ createdAt: undefined }), owner: storedOwner(), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when owner createdAt is a malformed timestamp', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner({ createdAt: '2026-13-45T99:99:99Z' }), consent: storedConsent() });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when consent capturedAt is a malformed timestamp (not merely non-empty)', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent({ capturedAt: 'yesterday' }) });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('conflict when consent capturedAt is missing', async () => {
    stubRetry({ tenant: storedTenant(), owner: storedOwner(), consent: storedConsent({ capturedAt: undefined }) });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r.result).toBe('conflict');
  });

  it('already_completed accepts valid stored timestamps that differ from the request values', async () => {
    // Well-formed but different timestamps + a different registrationId → still
    // a valid same-data retry (volatile values validated, not compared).
    stubRetry({
      tenant: storedTenant({ registrationId: 'older-reg', createdAt: '2025-02-03T04:05:06.000Z' }),
      owner: storedOwner({ createdAt: '2025-02-03T04:05:06.000Z' }),
      consent: storedConsent({ capturedAt: '2025-02-03T04:05:06.000Z' }),
    });
    const r = await completeOwnerProfile(TABLE, params());
    expect(r).toEqual({ result: 'already_completed' });
  });

  it('throws TransientPersistenceError on a purely transient cancellation (caller retries)', async () => {
    ddbMock.on(TransactWriteCommand).rejects(canceled(['TransactionConflict', 'None', 'None']));
    await expect(completeOwnerProfile(TABLE, params())).rejects.toBeInstanceOf(TransientPersistenceError);
  });
});
