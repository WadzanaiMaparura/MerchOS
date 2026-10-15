import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { PreSignUpTriggerEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@aws-lambda-powertools/logger', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

const ddbDocMock = mockClient(DynamoDBDocumentClient);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function buildPreSignUpEvent(overrides: Partial<PreSignUpTriggerEvent> = {}): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'eu-west-1',
    userPoolId: 'eu-west-1_testPool',
    userName: 'test-user-id',
    callerContext: {
      awsSdkVersion: '3.0.0',
      clientId: 'test-client-id',
    },
    triggerSource: 'PreSignUp_SignUp',
    request: {
      userAttributes: {
        email: 'newuser@example.com',
      },
      clientMetadata: undefined,
      validationData: undefined,
    },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
    ...overrides,
  } as PreSignUpTriggerEvent;
}

describe('pre-sign-up trigger', () => {
  beforeEach(() => {
    ddbDocMock.reset();
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    process.env['AWS_REGION'] = 'eu-west-1';
  });

  it('auto-confirms an invited user WITHOUT mutating identity attributes (assignment deferred to PostConfirmation)', async () => {
    // Arrange: invitation exists for this email
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-123',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-123',
          role: 'editor',
          status: 'pending',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act
    const result = await handler(event);

    // Assert: auto-confirm requested, but NO identity attributes mutated here.
    // request.userAttributes is not a supported persistence path; PostConfirmation
    // assigns the invited tenant/role authoritatively.
    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.response.autoVerifyEmail).toBe(true);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(result.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('defers self-signup identity assignment to PostConfirmation (no owner attrs set here)', async () => {
    // Arrange: successful lookup with no invitation = legitimate self-signup
    ddbDocMock.on(QueryCommand).resolves({ Items: [] });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act
    const result = await handler(event);

    // Assert: not auto-confirmed, and NO custom attributes are mutated here.
    // Identity is assigned later (server-trusted) in PostConfirmation.
    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.response.autoVerifyEmail).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(result.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('fails closed (throws) when INVITATIONS_TABLE is not configured', async () => {
    delete process.env['INVITATIONS_TABLE'];

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act + Assert: lookup cannot be performed, so sign-up must be rejected
    // rather than silently creating a new owner.
    await expect(handler(event)).rejects.toThrow();
    expect(event.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('fails closed (throws) on a DynamoDB/KMS lookup error — never grants owner', async () => {
    // Arrange: lookup fails (e.g. KMS decrypt / DynamoDB error)
    ddbDocMock.on(QueryCommand).rejects(new Error('AccessDeniedException: kms:Decrypt'));

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    // Act + Assert: must throw, and must not assign owner identity
    await expect(handler(event)).rejects.toThrow();
    expect(event.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(event.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('preserves invited tenant and role and never converts invitee to owner', async () => {
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-xyz',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-xyz',
          role: 'viewer',
          status: 'pending',
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    const result = await handler(event);

    // Invitation recognised → auto-confirm requested. Identity attributes are
    // NOT mutated here; PostConfirmation assigns the invited tenant/role.
    expect(result.response.autoConfirmUser).toBe(true);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(result.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('accepts a genuine invitation whose numeric expiresAt is in the future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-future',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-future',
          role: 'editor',
          status: 'pending',
          expiresAt: future,
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const result = await handler(buildPreSignUpEvent());

    expect(result.response.autoConfirmUser).toBe(true);
  });

  it('accepts a valid legacy ISO-string expiry (backward compatibility)', async () => {
    const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-legacy',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-legacy',
          role: 'editor',
          status: 'pending',
          expiresAt: futureIso,
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const result = await handler(buildPreSignUpEvent());

    expect(result.response.autoConfirmUser).toBe(true);
  });

  it('rejects an EXPIRED legacy ISO-string invitation', async () => {
    const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-legacy-exp',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-legacy-exp',
          role: 'editor',
          status: 'pending',
          expiresAt: pastIso,
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const result = await handler(buildPreSignUpEvent());

    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
  });

  it('fails closed when expiry is MISSING (not treated as a valid invitation)', async () => {
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-noexp',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-noexp',
          role: 'editor',
          status: 'pending',
          // expiresAt intentionally absent
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const result = await handler(buildPreSignUpEvent());

    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(result.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('fails closed when expiry is MALFORMED', async () => {
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-badexp',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-badexp',
          role: 'editor',
          status: 'pending',
          expiresAt: 'not-a-date',
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const result = await handler(buildPreSignUpEvent());

    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
  });

  it('rejects an EXPIRED invitation and never auto-confirms (TTL deletion is async)', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#tenant-expired',
          SK: 'INVITE#newuser@example.com',
          email: 'newuser@example.com',
          tenantId: 'tenant-expired',
          role: 'editor',
          status: 'pending',
          expiresAt: past,
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const result = await handler(buildPreSignUpEvent());

    // Expired invitation must NOT be honoured: no auto-confirm, no invited
    // tenant/role, and no self-signup owner attrs set here either.
    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.response.autoVerifyEmail).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(result.request.userAttributes['custom:role']).toBeUndefined();
  });

  it('never auto-confirms for a non-invitation row (e.g. a pending-registration-shaped record)', async () => {
    // A record that is NOT a genuine invitation (wrong key shape, no role).
    // Even if such a row shared the email index, it must be ignored and the
    // flow must proceed as self-registration (no auto-confirm/verify).
    ddbDocMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'PENDINGREG#reg-1',
          SK: 'METADATA',
          email: 'newuser@example.com',
          tenantId: 'server-tenant-1',
          status: 'pending',
        },
      ],
    });

    const { handler } = await import('../../triggers/pre-sign-up');
    const event = buildPreSignUpEvent();

    const result = await handler(event);

    expect(result.response.autoConfirmUser).toBe(false);
    expect(result.response.autoVerifyEmail).toBe(false);
    expect(result.request.userAttributes['custom:tenantId']).toBeUndefined();
    expect(result.request.userAttributes['custom:role']).toBeUndefined();
  });
});
