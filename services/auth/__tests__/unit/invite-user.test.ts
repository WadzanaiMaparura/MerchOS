import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  AdminUpdateUserAttributesCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
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
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_testPoolId';
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['INVITATIONS_TABLE'];
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  it('returns 201 with invitationId and expiresAt on success', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
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
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
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

  it('adds user to Seller group', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
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
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    await handler(event as any, {} as any);

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      TableName: 'merch-os-invitations-dev',
      Item: expect.objectContaining({
        PK: 'TENANT#tenant-1',
        SK: 'INVITE#newuser@example.com',
        email: 'newuser@example.com',
        role: 'editor',
        tenantId: 'tenant-1',
        status: 'pending',
      }),
    });
  });

  it('emits auth.user.invited event', async () => {
    cognitoMock.on(AdminCreateUserCommand).resolves({});
    cognitoMock.on(AdminAddUserToGroupCommand).resolves({});
    cognitoMock.on(AdminUpdateUserAttributesCommand).resolves({});
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

  it('returns 409 USER_EXISTS on UsernameExistsException', async () => {
    cognitoMock.on(AdminCreateUserCommand).rejects(
      new UsernameExistsException({ message: 'User already exists', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'existing@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('USER_EXISTS');
  });

  it('returns 500 when env vars missing', async () => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['INVITATIONS_TABLE'];

    const { handler } = await import('../../handlers/invite-user');
    const event = buildEvent({ email: 'newuser@example.com', role: 'editor', tenantId: 'tenant-1' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
