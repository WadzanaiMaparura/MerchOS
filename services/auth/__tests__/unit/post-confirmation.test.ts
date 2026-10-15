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

/** Fake repository resolving by exact id. */
function fakeRepo(byId: Record<string, ReturnType<typeof makePending> | null>) {
  return {
    getById: vi.fn(async (id: string) => byId[id] ?? null),
    deleteById: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
  } as unknown as PendingRegistrationRepository;
}

function buildEvent(
  registrationId?: string,
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
      clientMetadata: registrationId ? { registrationId } : undefined,
    },
    response: {},
    ...overrides,
  } as PostConfirmationTriggerEvent;
}

function attrsFromCall(index = 0) {
  const input = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)[index].args[0].input;
  return Object.fromEntries((input.UserAttributes ?? []).map((a) => [a.Name, a.Value]));
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

  it('resolves the EXACT registrationId from clientMetadata and assigns its tenantId', async () => {
    const repo = fakeRepo({ 'reg-1': makePending() });
    __setPendingRegistrationRepositoryForTesting(repo);

    await handler(buildEvent('reg-1'));

    expect(repo.getById).toHaveBeenCalledWith('reg-1');
    const attrs = attrsFromCall();
    expect(attrs['custom:tenantId']).toBe('server-tenant-1');
    expect(attrs['custom:role']).toBe('owner');
  });

  it('does NOT select by email when registrationId is absent (uses recovery fallback)', async () => {
    const repo = fakeRepo({ 'reg-1': makePending() });
    __setPendingRegistrationRepositoryForTesting(repo);

    await handler(buildEvent(undefined));

    // Never looked anything up by id, and did not touch the stored record.
    expect(repo.getById).not.toHaveBeenCalled();
    const attrs = attrsFromCall();
    // Fallback tenant (a fresh UUID), not the stored one.
    expect(attrs['custom:tenantId']).not.toBe('server-tenant-1');
    expect(attrs['custom:tenantId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(attrs['custom:role']).toBe('owner');
  });

  it('falls back when the pending email does not match the verified identity', async () => {
    const mismatched = makePending({ email: 'someone-else@example.com', tenantId: 'wrong-tenant' });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': mismatched }));

    await handler(buildEvent('reg-1'));

    expect(attrsFromCall()['custom:tenantId']).not.toBe('wrong-tenant');
  });

  it('falls back (not the stale tenantId) when the pending registration is expired', async () => {
    const expired = makePending({ expiresAt: NOW_SECONDS - 10, tenantId: 'stale-tenant' });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': expired }));

    await handler(buildEvent('reg-1'));

    expect(attrsFromCall()['custom:tenantId']).not.toBe('stale-tenant');
  });

  it('uses a server-generated fallback tenantId when the id resolves to nothing', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    await handler(buildEvent('missing-id'));

    const attrs = attrsFromCall();
    expect(attrs['custom:tenantId']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(attrs['custom:role']).toBe('owner');
  });

  it('preserves invited tenant/role and does NOT call AdminUpdateUserAttributes', async () => {
    const repo = fakeRepo({ 'reg-1': makePending() });
    __setPendingRegistrationRepositoryForTesting(repo);

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantId'] = 'invited-tenant';
    event.request.userAttributes['custom:role'] = 'editor';

    await handler(event);

    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(repo.getById).not.toHaveBeenCalled();
    expect(mockEmitAuthEvent).toHaveBeenCalledTimes(1);
  });

  it('throws (does not report success) when AdminUpdateUserAttributes fails', async () => {
    cognitoMock.on(AdminUpdateUserAttributesCommand).rejects(new Error('AccessDenied'));
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await expect(handler(buildEvent('reg-1'))).rejects.toThrow();
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('is idempotent — repeated runs converge to the same tenantId/role', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));
    await handler(buildEvent('reg-1'));
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));
    await handler(buildEvent('reg-1'));

    const calls = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand);
    expect(calls).toHaveLength(2);
    expect(attrsFromCall(0)).toEqual(attrsFromCall(1));
  });

  it('does NOT delete the pending registration after assigning attributes', async () => {
    const repo = fakeRepo({ 'reg-1': makePending() });
    __setPendingRegistrationRepositoryForTesting(repo);

    await handler(buildEvent('reg-1'));

    // Retained until the durable downstream completion path commits.
    expect(repo.deleteById).not.toHaveBeenCalled();
  });
});
