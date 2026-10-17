import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { resetCognitoClient } from '../../utils/cognito-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  tracer: {
    captureAWSv3Client: vi.fn((c: unknown) => c),
  },
  metrics: {
    addMetric: vi.fn(),
    publishStoredMetrics: vi.fn(),
  },
}));

vi.mock('../../../shared/middleware/input-validation', () => ({
  inputValidationMiddleware: () => ({ before: vi.fn() }),
}));

vi.mock('../../../shared/middleware/rbac', () => ({
  rbacMiddleware: () => ({ before: vi.fn() }),
}));

vi.mock('../../../shared/middleware/tenant-context', () => ({
  tenantContextMiddleware: () => ({ before: vi.fn() }),
}));

const mockEmitAuthEvent = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cognitoMock = mockClient(CognitoIdentityProviderClient);
const ddbMock = mockClient(DynamoDBDocumentClient);

function buildEvent(body: { email: string; role: string; tenantId: string }) {
  return {
    version: '2.0',
    routeKey: 'POST /auth/invite',
    rawPath: '/auth/invite',
    headers: { 'content-type': 'application/json' },
    body,
    requestContext: {
      http: {
        method: 'POST',
        path: '/auth/invite',
        sourceIp: '192.168.1.1',
      },
      requestId: 'test-request-id',
      authorizer: {
        rbac: {
          userId: 'admin-user-123',
        },
      },
    },
    isBase64Encoded: false,
  };
}

describe('invite-user handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    ddbMock.reset();
    resetCognitoClient();
    mockEmitAuthEvent.mockClear();
    process.env['COGNITO_USER_POOL_ID'] = 'us-east-1_testPoolId';
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'eu-west-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_USER_POOL_ID'];
    delete process.env['INVITATIONS_TABLE'];
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  it('returns 201 with invitationId and expiresAt on success', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.invitationId).toBeDefined();
    expect(body.expiresAt).toBeDefined();
  });

  it('creates Cognito user with AdminCreateUser (suppressed message)', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    const calls = cognitoMock.commandCalls(AdminCreateUserCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_testPoolId',
      Username: 'newuser@example.com',
      MessageAction: 'SUPPRESS',
    });
  });

  it('supplies the immutable custom:tenantId and custom:role AT user creation', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    const input = cognitoMock.commandCalls(AdminCreateUserCommand)[0].args[0].input;
    const attrs = Object.fromEntries(
      (input.UserAttributes ?? []).map((a: { Name?: string; Value?: string }) => [a.Name, a.Value]),
    );
    expect(attrs['custom:tenantId']).toBe('tenant-1');
    expect(attrs['custom:role']).toBe('editor');
    expect(attrs['email']).toBe('newuser@example.com');
    expect(attrs['email_verified']).toBe('true');
  });

  it('never calls AdminUpdateUserAttributes (immutable attr cannot be set post-creation)', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    expect(cognitoMock.commandCalls(AdminUpdateUserAttributesCommand)).toHaveLength(0);
  });

  it('creates the Cognito user BEFORE writing the invitation record (fail-safe ordering)', async () => {
    // Record call order across both clients using a shared counter.
    let order = 0;
    let putOrder = -1;
    let createOrder = -1;
    cognitoMock.on(AdminCreateUserCommand).callsFake(() => {
      createOrder = order++;
      return {};
    });
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).callsFake(() => {
      putOrder = order++;
      return {};
    });

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    expect(createOrder).toBeGreaterThanOrEqual(0);
    expect(putOrder).toBeGreaterThanOrEqual(0);
    // User is created (and group-added) first; the invitation record is written
    // last. If any Cognito step fails, we compensate by deleting the user, so no
    // orphaned invitation record is left behind.
    expect(createOrder).toBeLessThan(putOrder);
  });

  it('adds user to Seller group', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    const calls = cognitoMock.commandCalls(AdminAddUserToGroupCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_testPoolId',
      Username: 'newuser@example.com',
      GroupName: 'Seller',
    });
  });

  it('stores invitation record in DynamoDB', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const item = calls[0].args[0].input.Item as Record<string, unknown>;
    expect(item).toMatchObject({
      PK: 'TENANT#tenant-1',
      SK: 'INVITE#newuser@example.com',
      email: 'newuser@example.com',
      role: 'editor',
      tenantId: 'tenant-1',
      status: 'pending',
    });
    // TTL field must be a NUMBER (Unix epoch seconds), not an ISO string.
    expect(typeof item['expiresAt']).toBe('number');
    expect(item['expiresAt'] as number).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns an ISO-formatted expiresAt in the API response (not the epoch number)', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    const body = JSON.parse(result.body);
    expect(typeof body.expiresAt).toBe('string');
    // Parses as a valid ISO date.
    expect(Number.isNaN(Date.parse(body.expiresAt))).toBe(false);
  });

  it('emits auth.user.invited event', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    // Wait a tick for the fire-and-forget promise
    await new Promise((r) => setTimeout(r, 10));

    expect(mockEmitAuthEvent).toHaveBeenCalledWith({
      detailType: 'auth.user.invited',
      detail: expect.objectContaining({
        email: 'newuser@example.com',
        role: 'editor',
        tenantId: 'tenant-1',
        invitedBy: 'admin-user-123',
      }),
    });
  });

  it('returns 409 USER_EXISTS on UsernameExistsException and does NOT delete the pre-existing user', async () => {
    cognitoMock.on(AdminCreateUserCommand).rejects(
      new UsernameExistsException({ message: 'User already exists', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'existing@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('USER_EXISTS');
    // The user was not created by us; we must not delete an existing user,
    // and no invitation record should be written.
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('does NOT delete the user when AdminCreateUser returns an ambiguous (timeout) error', async () => {
    const timeout = new Error('socket timed out');
    (timeout as any).name = 'TimeoutError';
    cognitoMock.on(AdminCreateUserCommand).rejects(timeout);
    cognitoMock.on(AdminDeleteUserCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('PROVISIONING_AMBIGUOUS');
    // Must NEVER delete on an ambiguous create — the user may actually exist.
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
    // No invitation record written (we never reached that step).
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rolls back the created user when AddToGroup fails (no orphaned user, no invite record)', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).rejects(new Error('group failure'));
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    // Compensation: the partially provisioned user is deleted.
    const del = cognitoMock.commandCalls(AdminDeleteUserCommand);
    expect(del).toHaveLength(1);
    expect(del[0].args[0].input).toMatchObject({ Username: 'newuser@example.com' });
    // No invitation record was written (we never reached that step).
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('rolls back user + group membership when the invitation-record write fails', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    ddbMock.on(PutCommand).rejects(new Error('ddb write failure'));

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    // Compensation removes group membership and deletes the user, so a retry
    // is not blocked by UsernameExistsException and no orphan remains.
    expect(cognitoMock.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(1);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
  });

  it('compensates an AMBIGUOUS invitation write by conditionally deleting the record and the user', async () => {
    // Simulate a write that may have persisted but reported an error
    // (timeout / connection reset). The handler must attempt a conditional
    // delete of the record (by invitationId) plus full user rollback.
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    ddbMock.on(PutCommand).rejects(new Error('ETIMEDOUT (ambiguous)'));
    ddbMock.on(DeleteCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);

    // Conditional record cleanup: delete scoped to this invocation's record,
    // guarded by invitationId so a different record is never removed.
    const del = ddbMock.commandCalls(DeleteCommand);
    expect(del).toHaveLength(1);
    expect(del[0].args[0].input).toMatchObject({
      Key: { PK: 'TENANT#tenant-1', SK: 'INVITE#newuser@example.com' },
      ConditionExpression: 'invitationId = :iid',
    });
    // And the partially provisioned user is removed from group + deleted.
    expect(cognitoMock.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(1);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
  });

  it('treats a ConditionalCheckFailed during record cleanup as nothing-to-clean (no false failure)', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminDeleteUserCommand).resolves({});
    ddbMock.on(PutCommand).rejects(new Error('ambiguous'));
    const condErr = new Error('conditional check failed');
    (condErr as any).name = 'ConditionalCheckFailedException';
    ddbMock.on(DeleteCommand).rejects(condErr);

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    // Still a 500 (the invite failed), and the user is still cleaned up.
    expect(result.statusCode).toBe(500);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand)).toHaveLength(1);
  });

  it('does not emit auth.user.invited when provisioning fails', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).rejects(new Error('group failure'));
    cognitoMock.on(AdminDeleteUserCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    await new Promise((r) => setTimeout(r, 10));
    expect(mockEmitAuthEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when env vars missing', async () => {
    delete process.env['COGNITO_USER_POOL_ID'];
    delete process.env['INVITATIONS_TABLE'];

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
