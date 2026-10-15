import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PostConfirmationTriggerEvent } from 'aws-lambda';

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

const mockEmitAuthEvent = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}));

const cognitoMock = mockClient(CognitoIdentityProviderClient);

// ---------------------------------------------------------------------------
// Fake repository
// ---------------------------------------------------------------------------

import { PendingRegistrationRepository } from '../../registration/pending-registration-repository';
import {
  handler,
  __setPendingRegistrationRepositoryForTesting,
} from '../../triggers/post-confirmation';

const NOW_SECONDS = Math.floor(Date.now() / 1000);

function makePending(overrides: Record<string, unknown> = {}) {
  return {
    PK: 'PENDINGREG#reg-1',
    SK: 'METADATA',
    registrationId: 'reg-1',
    tenantId: 'server-tenant-1',
    email: 'seller@example.com',
    fullName: 'Ada Lovelace',
    phoneNumber: '+27831234567',
    organisationName: 'Analytical Engines',
    marketingConsent: { granted: false, capturedAt: '2026-01-01T00:00:00.000Z' },
    status: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: NOW_SECONDS + 3600,
    ...overrides,
  };
}

/** Builds a fake repository with spy-able methods. */
function fakeRepo(pending: ReturnType<typeof makePending> | null) {
  return {
    findActiveByEmail: vi.fn().mockResolvedValue(pending),
    deleteById: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    getById: vi.fn(),
  } as unknown as PendingRegistrationRepository;
}

function buildEvent(
  overrides: Partial<PostConfirmationTriggerEvent> = {},
): PostConfirmationTriggerEvent {
  return {
    version: '1',
    region: 'eu-west-1',
    userPoolId: 'eu-west-1_testPool',
    userName: 'confirmed-user-id',
    callerContext: { awsSdkVersion: '3.0.0', clientId: 'client-id' },
    triggerSource: 'PostConfirmation_ConfirmSignUp',
    request: {
      userAttributes: { email: 'seller@example.com' },
    },
    response: {},
    ...overrides,
  } as PostConfirmationTriggerEvent;
}

describe('post-confirmation trigger — trusted identity assignment', () => {
  beforeEach(() => {
    cognitoMock.reset();
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
    mockEmitAuthEvent.mockClear();
    process.env['AWS_REGION'] = 'eu-west-1';
  });

  afterEach(() => {
    __setPendingRegistrationRepositoryForTesting(null);
  });

  it('assigns the server-generated tenantId and owner role for a valid pending registration', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo(makePending()));

    await handler(buildEvent());

    const calls = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.UserPoolId).toBe('eu-west-1_testPool');
    expect(input.Username).toBe('confirmed-user-id');
    const attrs = Object.fromEntries(
      (input.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    expect(attrs['custom:tenantId']).toBe('server-tenant-1');
    expect(attrs['custom:role']).toBe('owner');
    expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1);
  });

  it('preserves invited tenant/role and does NOT call AdminUpdateUserAttributes', async () => {
    const repo = fakeRepo(null);
    __setPendingRegistrationRepositoryForTesting(repo);

    const event = buildEvent();
    event.request.userAttributes['custom:tenantId'] = 'invited-tenant';
    event.request.userAttributes['custom:role'] = 'editor';

    await handler(event);

    // Invited identity is authoritative; no re-assignment, no owner conversion.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(repo.findActiveByEmail).not.toHaveBeenCalled();
    expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1);
  });

  it('uses a server-generated fallback tenantId when the pending registration is missing', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo(null));

    await handler(buildEvent());

    const input = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)[0].args[0].input;
    const attrs = Object.fromEntries(
      (input.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    // A real UUID tenantId is assigned; role is owner; nothing derived from email.
    expect(attrs['custom:tenantId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(attrs['custom:role']).toBe('owner');
  });

  it('uses the fallback (not the stale tenantId) when the pending registration is expired', async () => {
    const expired = makePending({ expiresAt: NOW_SECONDS - 10, tenantId: 'stale-tenant' });
    __setPendingRegistrationRepositoryForTesting(fakeRepo(expired));

    await handler(buildEvent());

    const input = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)[0].args[0].input;
    const attrs = Object.fromEntries(
      (input.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    expect(attrs['custom:tenantId']).not.toBe('stale-tenant');
  });

  it('throws (does not report success) when AdminUpdateUserAttributes fails', async () => {
    cognitoMock.on(AdminUpdateUserAttributesCommand).rejects(new Error('AccessDenied'));
    __setPendingRegistrationRepositoryForTesting(fakeRepo(makePending()));

    await expect(handler(buildEvent())).rejects.toThrow();
    // No success event emitted on failed identity assignment.
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('is idempotent — repeated runs converge to the same tenantId/role', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo(makePending()));

    await handler(buildEvent());
    __setPendingRegistrationRepositoryForTesting(fakeRepo(makePending()));
    await handler(buildEvent());

    const calls = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand);
    expect(calls).toHaveLength(2);
    const extract = (i: number) =>
      Object.fromEntries(
        (calls[i].args[0].input.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
      );
    expect(extract(0)).toEqual(extract(1));
  });

  it('deletes the consumed pending registration after assignment', async () => {
    const repo = fakeRepo(makePending());
    __setPendingRegistrationRepositoryForTesting(repo);

    await handler(buildEvent());

    expect(repo.deleteById).toHaveBeenCalledWith('reg-1');
  });
});
