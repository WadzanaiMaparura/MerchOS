import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  GlobalSignOutCommand,
  NotAuthorizedException,
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

const mockEmitAuthEvent = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function buildEvent(options: {
  accessToken?: string;
  userId?: string;
  body?: Record<string, unknown>;
} = {}) {
  const { accessToken = 'valid-access-token-123', userId = 'user-sub-abc', body = {} } = options;

  return {
    version: '2.0',
    routeKey: 'POST /auth/logout',
    rawPath: '/auth/logout',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body,
    requestContext: {
      http: {
        method: 'POST',
        path: '/auth/logout',
        sourceIp: '192.168.1.1',
      },
      requestId: 'test-request-id',
      authorizer: {
        jwt: {
          claims: {
            ...(userId ? { sub: userId } : {}),
          },
        },
      },
    },
    isBase64Encoded: false,
  };
}

describe('logout handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    mockEmitAuthEvent.mockClear();
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  it('returns 200 { success: true } on successful logout', async () => {
    cognitoMock.on(GlobalSignOutCommand).resolves({});

    const { handler } = await import('../../handlers/logout');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });

  it('calls GlobalSignOut with the access token', async () => {
    cognitoMock.on(GlobalSignOutCommand).resolves({});

    const { handler } = await import('../../handlers/logout');
    const event = buildEvent({ accessToken: 'my-access-token-xyz' });
    await handler(event as any, {} as any);

    const calls = cognitoMock.commandCalls(GlobalSignOutCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      AccessToken: 'my-access-token-xyz',
    });
  });

  it('emits auth.session.revoked event with userId', async () => {
    cognitoMock.on(GlobalSignOutCommand).resolves({});

    const { handler } = await import('../../handlers/logout');
    const event = buildEvent({ userId: 'user-123-abc' });
    await handler(event as any, {} as any);

    expect(mockEmitAuthEvent).toHaveBeenCalledWith({
      detailType: 'auth.session.revoked',
      detail: expect.objectContaining({
        userId: 'user-123-abc',
        reason: 'user_logout',
      }),
    });
  });

  it('returns 401 when Authorization header is missing', async () => {
    const { handler } = await import('../../handlers/logout');
    const event = buildEvent({ accessToken: undefined });
    // Remove authorization header entirely
    delete (event.headers as any)['authorization'];
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Missing access token');
  });

  it('returns 401 when no userId in JWT claims', async () => {
    cognitoMock.on(GlobalSignOutCommand).resolves({});

    const { handler } = await import('../../handlers/logout');
    const event = buildEvent({ userId: undefined });
    // Remove sub from claims
    (event.requestContext.authorizer.jwt.claims as any) = {};
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid session');
  });

  it('returns 401 when GlobalSignOut throws NotAuthorizedException (token already invalid)', async () => {
    cognitoMock.on(GlobalSignOutCommand).rejects(
      new NotAuthorizedException({ message: 'Access Token has been revoked', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/logout');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('TOKEN_INVALID');
    expect(body.error.message).toBe('Token has already been invalidated');
  });
});
