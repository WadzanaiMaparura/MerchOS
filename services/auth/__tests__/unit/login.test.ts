import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  NotAuthorizedException,
  UserNotFoundException,
  UserNotConfirmedException,
  PasswordResetRequiredException,
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

vi.mock('../../../shared/middleware/rate-limit', () => ({
  rateLimitMiddleware: () => ({ before: vi.fn() }),
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

function buildEvent(body: { email: string; password: string }, sourceIp = '192.168.1.1') {
  return {
    version: '2.0',
    routeKey: 'POST /auth/login',
    rawPath: '/auth/login',
    headers: { 'content-type': 'application/json' },
    body: body,
    requestContext: {
      http: {
        method: 'POST',
        path: '/auth/login',
        sourceIp,
      },
      requestId: 'test-request-id',
    },
    isBase64Encoded: false,
  };
}

describe('login handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    mockEmitAuthEvent.mockClear();
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_testPoolId';
    process.env['COGNITO_SELLER_CLIENT_ID'] = 'test-client-id';
    process.env['RATE_LIMITS_TABLE'] = 'merch-os-rate-limits-dev';
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['COGNITO_SELLER_CLIENT_ID'];
    delete process.env['RATE_LIMITS_TABLE'];
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  it('returns tokens on successful authentication', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'access-token-123',
        IdToken: 'id-token-456',
        RefreshToken: 'refresh-token-789',
        ExpiresIn: 3600,
      },
    });

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'user@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.accessToken).toBe('access-token-123');
    expect(body.idToken).toBe('id-token-456');
    expect(body.refreshToken).toBe('refresh-token-789');
    expect(body.expiresIn).toBe(3600);
  });

  it('returns TOTP challenge when MFA is required', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      ChallengeName: 'SOFTWARE_TOKEN_MFA',
      Session: 'mfa-session-abc',
    });

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'user@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.challengeName).toBe('TOTP');
    expect(body.session).toBe('mfa-session-abc');
  });

  it('returns SMS challenge when SMS MFA is required', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      ChallengeName: 'SMS_MFA',
      Session: 'sms-session-xyz',
    });

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'user@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.challengeName).toBe('SMS');
    expect(body.session).toBe('sms-session-xyz');
  });

  it('returns 401 for NotAuthorizedException', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).rejects(
      new NotAuthorizedException({ message: 'Incorrect username or password.', $metadata: {} })
    );

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'user@example.com', password: 'WrongPassword1!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('returns 401 for UserNotFoundException (same error, no enumeration)', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).rejects(
      new UserNotFoundException({ message: 'User does not exist.', $metadata: {} })
    );

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'nonexistent@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
    expect(body.error.message).toBe('Invalid email or password');
  });

  it('returns 403 for UserNotConfirmedException (EMAIL_NOT_VERIFIED)', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).rejects(
      new UserNotConfirmedException({ message: 'User is not confirmed.', $metadata: {} })
    );

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'unverified@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(body.error.message).toBe('Please verify your email address before logging in');
  });

  it('returns 403 for PasswordResetRequiredException', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).rejects(
      new PasswordResetRequiredException({ message: 'Password reset required.', $metadata: {} })
    );

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'resetuser@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('PASSWORD_RESET_REQUIRED');
    expect(body.error.message).toBe('You must reset your password before logging in');
  });

  it('returns 500 when env vars are missing', async () => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['COGNITO_SELLER_CLIENT_ID'];

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'user@example.com', password: 'SecurePass123!' });
    const result = await handler(event as any, {} as any) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Service misconfigured');
  });

  it('emits auth.session.created event on success', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'access-token-123',
        IdToken: 'id-token-456',
        RefreshToken: 'refresh-token-789',
        ExpiresIn: 3600,
      },
    });

    const { handler } = await import('../../handlers/login');
    const event = buildEvent({ email: 'user@example.com', password: 'SecurePass123!' }, '10.0.0.1');
    await handler(event as any, {} as any);

    // Wait a tick for the fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(mockEmitAuthEvent).toHaveBeenCalledWith({
      detailType: 'auth.session.created',
      detail: expect.objectContaining({
        email: 'user@example.com',
        sourceIp: '10.0.0.1',
      }),
    });
  });
});
