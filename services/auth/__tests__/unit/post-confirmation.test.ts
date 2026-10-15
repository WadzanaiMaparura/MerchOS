import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminUpdateUserAttributesCommand,
  AdminAddUserToGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
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

// The identity-assignment stage must NOT emit auth.user.registered. We mock
// the emitter purely to prove it is never invoked here.
const mockEmitAuthEvent = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}));

const cognitoMock = mockClient(CognitoIdentityProviderClient);
// The invitation lookup (shared module) queries DynamoDB. Patched globally.
const ddbMock = mockClient(DynamoDBDocumentClient);

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
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.reset();
    // Default: no invitation for this email (self-signup path). Individual
    // tests override to simulate an invited user.
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    mockEmitAuthEvent.mockClear();
    process.env['AWS_REGION'] = 'eu-west-1';
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
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
    // Self-signup writes the MUTABLE attribute (immutable custom:tenantId
    // cannot be set after creation), and never writes custom:tenantId.
    expect(attrs['custom:tenantIdAssigned']).toBe('server-tenant-1');
    expect(attrs['custom:tenantId']).toBeUndefined();
    expect(attrs['custom:role']).toBe('owner');
  });

  it('assigns the INVITED tenant/role (not owner) when a genuine invitation matches the verified email', async () => {
    // A genuine, non-expired invitation exists for this verified email.
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    // Even if a self-signup pending record exists, the invitation wins.
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await handler(buildEvent('reg-1'));

    const attrs = attrsFromCall();
    expect(attrs['custom:tenantIdAssigned']).toBe('invited-tenant');
    expect(attrs['custom:role']).toBe('editor');
    // Never converted into an owner, never used the self-signup tenant.
    expect(attrs['custom:role']).not.toBe('owner');
    expect(attrs['custom:tenantIdAssigned']).not.toBe('server-tenant-1');

    // And the invited user is placed in the 'Seller' group so the RBAC
    // resolver (cognito:groups) authorizes them.
    const groupCalls = cognitoMock.commandCalls(AdminAddUserToGroupCommand);
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0].args[0].input).toMatchObject({
      Username: 'confirmed-user-id',
      GroupName: 'Seller',
    });
  });

  it('is retry-safe: after a prior group-add failure, a re-run repairs group membership without rewriting identity', async () => {
    // Genuine invitation for the verified email.
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    // Simulate the state AFTER a prior invocation that wrote the attributes
    // but FAILED at AdminAddUserToGroup: the user already has the assigned
    // identity on the event.
    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantIdAssigned'] = 'invited-tenant';
    event.request.userAttributes['custom:role'] = 'editor';

    await handler(event);

    // Attributes already correct → NOT rewritten.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    // But group membership IS (re)applied — the repair.
    const groupCalls = cognitoMock.commandCalls(AdminAddUserToGroupCommand);
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0].args[0].input).toMatchObject({ GroupName: 'Seller' });
  });

  it('repairs a PARTIAL invited identity: correct tenant present, role MISSING → writes both + ensures group', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantIdAssigned'] = 'invited-tenant'; // present + correct
    // custom:role intentionally missing

    await handler(event);

    // BOTH authoritative attributes written (partial state repaired).
    const update = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand);
    expect(update).toHaveLength(1);
    const attrs = Object.fromEntries(
      (update[0].args[0].input.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    expect(attrs['custom:tenantIdAssigned']).toBe('invited-tenant');
    expect(attrs['custom:role']).toBe('editor');
    // Group membership ensured.
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(1);
  });

  it('repairs a PARTIAL invited identity: correct role present, tenant MISSING → writes both + ensures group', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:role'] = 'editor'; // present + correct
    // custom:tenantIdAssigned intentionally missing

    await handler(event);

    const update = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand);
    expect(update).toHaveLength(1);
    const attrs = Object.fromEntries(
      (update[0].args[0].input.UserAttributes ?? []).map((a) => [a.Name, a.Value]),
    );
    expect(attrs['custom:tenantIdAssigned']).toBe('invited-tenant');
    expect(attrs['custom:role']).toBe('editor');
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(1);
  });

  it('fails closed on PARTIAL state when the present attribute CONFLICTS (tenant present+wrong, role missing)', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantIdAssigned'] = 'WRONG-tenant'; // present + conflicting
    // role missing

    await expect(handler(event)).rejects.toThrow();
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('fails closed on PARTIAL state when the present attribute CONFLICTS (role present+wrong, tenant missing)', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:role'] = 'admin'; // present + conflicting
    // tenant missing

    await expect(handler(event)).rejects.toThrow();
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('fails closed when an existing assigned identity CONFLICTS with the invitation', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    const event = buildEvent('reg-1');
    // A conflicting previously-assigned tenant.
    event.request.userAttributes['custom:tenantIdAssigned'] = 'some-other-tenant';
    event.request.userAttributes['custom:role'] = 'editor';

    await expect(handler(event)).rejects.toThrow();
    // Never overwrites and never emits success.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('fast-path: admin-created invitee (immutable custom:tenantId) is preserved and not re-processed', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));
    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantId'] = 'admin-tenant';
    event.request.userAttributes['custom:role'] = 'editor';

    await handler(event);

    // No attribute write, no group add, no invitation lookup needed.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('assigns a new self-signup OWNER the server tenant, owner role AND the Seller group', async () => {
    // No invitation; self-signup path with a valid pending registration.
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await handler(buildEvent('reg-1'));

    const attrs = attrsFromCall();
    expect(attrs['custom:tenantIdAssigned']).toBe('server-tenant-1');
    expect(attrs['custom:role']).toBe('owner');

    // Owner must receive the Seller group so the RBAC resolver authorizes them.
    const groupCalls = cognitoMock.commandCalls(AdminAddUserToGroupCommand);
    expect(groupCalls).toHaveLength(1);
    expect(groupCalls[0].args[0].input).toMatchObject({
      Username: 'confirmed-user-id',
      GroupName: 'Seller',
    });
  });

  it('owner group assignment is retryable: a prior group-add failure is repaired on re-run', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    // First run: identity write succeeds, group-add FAILS → handler throws.
    cognitoMock.on(AdminAddUserToGroupCommand).rejects(new Error('group failure'));
    await expect(handler(buildEvent('reg-1'))).rejects.toThrow();
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();

    // Second run: simulate the attributes already written (idempotent), group
    // now succeeds. Membership is repaired without changing tenant/role.
    cognitoMock.reset();
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantIdAssigned'] = 'server-tenant-1';
    event.request.userAttributes['custom:role'] = 'owner';

    await handler(event);

    // No attribute rewrite (already correct), but group membership (re)applied.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(cognitoMock.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(1);
  });

  it('fails (throws) if the invited group assignment cannot complete — no false success', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#invited-tenant',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'invited-tenant',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS + 3600,
        },
      ],
    });
    cognitoMock.on(AdminAddUserToGroupCommand).rejects(new Error('group failure'));
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    await expect(handler(buildEvent('reg-1'))).rejects.toThrow();
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('ignores an EXPIRED invitation and falls through to self-signup (never invited-as-owner confusion)', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        {
          PK: 'TENANT#expired-invite',
          SK: 'INVITE#seller@example.com',
          email: 'seller@example.com',
          tenantId: 'expired-invite',
          role: 'editor',
          status: 'pending',
          expiresAt: NOW_SECONDS - 10,
        },
      ],
    });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await handler(buildEvent('reg-1'));

    const attrs = attrsFromCall();
    // Expired invitation ignored → self-signup pending tenant used, owner role.
    expect(attrs['custom:tenantIdAssigned']).toBe('server-tenant-1');
    expect(attrs['custom:role']).toBe('owner');
  });

  it('fails closed (throws) when the invitation lookup errors — never mints an owner', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('AccessDenied: kms:Decrypt'));
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await expect(handler(buildEvent('reg-1'))).rejects.toThrow();
    // No identity assignment happened.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
  });

  it('does NOT select by email when registrationId is absent (uses recovery fallback)', async () => {
    const repo = fakeRepo({ 'reg-1': makePending() });
    __setPendingRegistrationRepositoryForTesting(repo);

    await handler(buildEvent(undefined));

    // Never looked anything up by id, and did not touch the stored record.
    expect(repo.getById).not.toHaveBeenCalled();
    const attrs = attrsFromCall();
    // Fallback tenant (a fresh UUID), written to the mutable attribute.
    expect(attrs['custom:tenantIdAssigned']).not.toBe('server-tenant-1');
    expect(attrs['custom:tenantIdAssigned']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(attrs['custom:role']).toBe('owner');
  });

  it('falls back when the pending email does not match the verified identity', async () => {
    const mismatched = makePending({ email: 'someone-else@example.com', tenantId: 'wrong-tenant' });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': mismatched }));

    await handler(buildEvent('reg-1'));

    expect(attrsFromCall()['custom:tenantIdAssigned']).not.toBe('wrong-tenant');
  });

  it('falls back (not the stale tenantId) when the pending registration is expired', async () => {
    const expired = makePending({ expiresAt: NOW_SECONDS - 10, tenantId: 'stale-tenant' });
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': expired }));

    await handler(buildEvent('reg-1'));

    expect(attrsFromCall()['custom:tenantIdAssigned']).not.toBe('stale-tenant');
  });

  it('uses a server-generated fallback tenantId when the id resolves to nothing', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo({}));

    await handler(buildEvent('missing-id'));

    const attrs = attrsFromCall();
    expect(attrs['custom:tenantIdAssigned']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(attrs['custom:role']).toBe('owner');
  });

  it('treats a prior self-signup assignment (custom:tenantIdAssigned) as already-identified (idempotent)', async () => {
    const repo = fakeRepo({ 'reg-1': makePending() });
    __setPendingRegistrationRepositoryForTesting(repo);

    const event = buildEvent('reg-1');
    // Simulate a re-run after a previous successful assignment.
    event.request.userAttributes['custom:tenantIdAssigned'] = 'already-assigned';
    event.request.userAttributes['custom:role'] = 'owner';

    await handler(event);

    // No re-assignment, no pending lookup — the user is already identified.
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
    expect(repo.getById).not.toHaveBeenCalled();
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
  });

  it('throws (does not report success) when AdminUpdateUserAttributes fails', async () => {
    cognitoMock.on(AdminUpdateUserAttributesCommand).rejects(new Error('AccessDenied'));
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await expect(handler(buildEvent('reg-1'))).rejects.toThrow();
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('does NOT emit auth.user.registered at the identity-assignment stage (self-signup)', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    await handler(buildEvent('reg-1'));

    // Identity attributes were assigned...
    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(1);
    // ...but registration-completed event must be deferred to the downstream
    // completion path once durable records are committed.
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('does NOT emit auth.user.registered for the invited-user path', async () => {
    __setPendingRegistrationRepositoryForTesting(fakeRepo({ 'reg-1': makePending() }));

    const event = buildEvent('reg-1');
    event.request.userAttributes['custom:tenantId'] = 'invited-tenant';
    event.request.userAttributes['custom:role'] = 'editor';

    await handler(event);

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
