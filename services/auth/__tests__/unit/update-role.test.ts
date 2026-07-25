import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
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

function buildEvent(options: {
  targetUserId: string;
  role: string;
  requestingUserId?: string;
}) {
  const { targetUserId, role, requestingUserId = 'owner-user-456' } = options;

  return {
    version: '2.0',
    routeKey: 'PUT /auth/users/{id}/role',
    rawPath: `/auth/users/${targetUserId}/role`,
    headers: { 'content-type': 'application/json' },
    body: { role },
    pathParameters: { id: targetUserId },
    requestContext: {
      http: {
        method: 'PUT',
        path: `/auth/users/${targetUserId}/role`,
        sourceIp: '192.168.1.1',
      },
      requestId: 'test-request-id',
      authorizer: {
        rbac: {
          userId: requestingUserId,
        },
      },
    },
    isBase64Encoded: false,
  };
}

describe('update-role handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    mockEmitAuthEvent.mockClear();
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_testPoolId';
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  it('returns 200 with userId, role, updatedAt on success', async () => {
    cognitoMock.on(AdminListGroupsForUserCommand).resolves({
      Groups: [{ GroupName: 'Editor' }],
    });
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});

    const { handler } = await import('../../handlers/update-role');
    const event = buildEvent({ targetUserId: 'target-user-789', role: 'admin' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.userId).toBe('target-user-789');
    expect(body.role).toBe('admin');
    expect(body.updatedAt).toBeDefined();
  });

  it('removes user from old group and adds to new group', async () => {
    cognitoMock.on(AdminListGroupsForUserCommand).resolves({
      Groups: [{ GroupName: 'Editor' }],
    });
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});

    const { handler } = await import('../../handlers/update-role');
    const event = buildEvent({ targetUserId: 'target-user-789', role: 'admin' });
    await handler(event as any, {} as any);

    const removeCalls = cognitoMock.commandCalls(AdminRemoveUserFromGroupCommand);
    expect(removeCalls).toHaveLength(1);
    expect(removeCalls[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_testPoolId',
      Username: 'target-user-789',
      GroupName: 'Editor',
    });

    const addCalls = cognitoMock.commandCalls(AdminAddUserToGroupCommand);
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_testPoolId',
      Username: 'target-user-789',
      GroupName: 'admin',
    });
  });

  it('updates custom:role attribute', async () => {
    cognitoMock.on(AdminListGroupsForUserCommand).resolves({
      Groups: [{ GroupName: 'Viewer' }],
    });
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});

    const { handler } = await import('../../handlers/update-role');
    const event = buildEvent({ targetUserId: 'target-user-789', role: 'editor' });
    await handler(event as any, {} as any);

    const updateCalls = cognitoMock.commandCalls(AdminUpdateUserAttributesCommand);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].args[0].input).toMatchObject({
      UserPoolId: 'us-east-1_testPoolId',
      Username: 'target-user-789',
      UserAttributes: [{ Name: 'custom:role', Value: 'editor' }],
    });
  });

  it('emits auth.user.role-changed event', async () => {
    cognitoMock.on(AdminListGroupsForUserCommand).resolves({
      Groups: [{ GroupName: 'Editor' }],
    });
    cognitoMock.on(AdminRemoveUserFromGroupCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});

    const { handler } = await import('../../handlers/update-role');
    const event = buildEvent({ targetUserId: 'target-user-789', role: 'admin', requestingUserId: 'owner-user-456' });
    await handler(event as any, {} as any);

    // Wait a tick for fire-and-forget promise
    await new Promise((r) => setTimeout(r, 10));

    expect(mockEmitAuthEvent).toHaveBeenCalledWith({
      detailType: 'auth.user.role-changed',
      detail: expect.objectContaining({
        userId: 'target-user-789',
        newRole: 'admin',
        changedBy: 'owner-user-456',
      }),
    });
  });

  it('returns 400 CANNOT_CHANGE_OWN_ROLE when userId matches target', async () => {
    const { handler } = await import('../../handlers/update-role');
    const event = buildEvent({
      targetUserId: 'same-user-123',
      role: 'admin',
      requestingUserId: 'same-user-123',
    });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('CANNOT_CHANGE_OWN_ROLE');
  });

  it('returns 404 USER_NOT_FOUND on UserNotFoundException', async () => {
    cognitoMock.on(AdminListGroupsForUserCommand).rejects(
      new UserNotFoundException({ message: 'User does not exist.', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/update-role');
    const event = buildEvent({ targetUserId: 'nonexistent-user', role: 'admin' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('USER_NOT_FOUND');
  });
});
