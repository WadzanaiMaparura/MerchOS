import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function buildEvent(query: { tenantId: string; limit: number; nextToken?: string }) {
  return {
    version: '2.0',
    routeKey: 'GET /auth/users',
    rawPath: '/auth/users',
    headers: { 'content-type': 'application/json' },
    queryStringParameters: query,
    requestContext: {
      http: {
        method: 'GET',
        path: '/auth/users',
        sourceIp: '192.168.1.1',
      },
      requestId: 'test-request-id',
    },
    isBase64Encoded: false,
  };
}

describe('list-users handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_testPoolId';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['AWS_REGION'];
  });

  it('returns filtered users matching tenantId', async () => {
    cognitoMock.on(ListUsersInGroupCommand).resolves({
      Users: [
        {
          Username: 'user-1',
          UserStatus: 'CONFIRMED',
          UserCreateDate: new Date('2024-01-01T00:00:00Z'),
          Attributes: [
            { Name: 'email', Value: 'user1@example.com' },
            { Name: 'custom:tenantId', Value: 'tenant-1' },
            { Name: 'custom:role', Value: 'editor' },
          ],
        },
        {
          Username: 'user-2',
          UserStatus: 'CONFIRMED',
          UserCreateDate: new Date('2024-01-02T00:00:00Z'),
          Attributes: [
            { Name: 'email', Value: 'user2@example.com' },
            { Name: 'custom:tenantId', Value: 'tenant-2' },
            { Name: 'custom:role', Value: 'admin' },
          ],
        },
      ],
    });

    const { handler } = await import('../../handlers/list-users');
    const event = buildEvent({ tenantId: 'tenant-1', limit: 20 });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({
      userId: 'user-1',
      email: 'user1@example.com',
      role: 'editor',
      tenantId: 'tenant-1',
      status: 'CONFIRMED',
    });
  });

  it('returns nextToken when Cognito returns NextToken', async () => {
    cognitoMock.on(ListUsersInGroupCommand).resolves({
      Users: [
        {
          Username: 'user-1',
          UserStatus: 'CONFIRMED',
          UserCreateDate: new Date('2024-01-01T00:00:00Z'),
          Attributes: [
            { Name: 'email', Value: 'user1@example.com' },
            { Name: 'custom:tenantId', Value: 'tenant-1' },
            { Name: 'custom:role', Value: 'editor' },
          ],
        },
      ],
      NextToken: 'next-page-token-abc',
    });

    const { handler } = await import('../../handlers/list-users');
    const event = buildEvent({ tenantId: 'tenant-1', limit: 10 });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.nextToken).toBe('next-page-token-abc');
  });

  it('returns empty array when no users match tenantId', async () => {
    cognitoMock.on(ListUsersInGroupCommand).resolves({
      Users: [
        {
          Username: 'user-other',
          UserStatus: 'CONFIRMED',
          UserCreateDate: new Date('2024-01-01T00:00:00Z'),
          Attributes: [
            { Name: 'email', Value: 'other@example.com' },
            { Name: 'custom:tenantId', Value: 'tenant-other' },
            { Name: 'custom:role', Value: 'viewer' },
          ],
        },
      ],
    });

    const { handler } = await import('../../handlers/list-users');
    const event = buildEvent({ tenantId: 'tenant-1', limit: 20 });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.users).toHaveLength(0);
  });

  it('returns 500 when env var missing', async () => {
    delete process.env['COGNITO_TENANT_POOL_ID'];

    const { handler } = await import('../../handlers/list-users');
    const event = buildEvent({ tenantId: 'tenant-1', limit: 20 });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
