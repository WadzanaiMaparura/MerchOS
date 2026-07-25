import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
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

vi.mock('../../../shared/middleware/rate-limit', () => ({
  rateLimitMiddleware: () => ({ before: vi.fn() }),
}));

vi.mock('../../../shared/middleware/input-validation', () => ({
  inputValidationMiddleware: () => ({ before: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function buildEvent(body: { refreshToken: string }, sourceIp = '192.168.1.1') {
  return {
    version: '2.0',
    routeKey: 'POST /auth/refresh',
    rawPath: '/auth/refresh',
    headers: { 'content-type': 'application/json' },
    body: body,
    requestContext: {
      http: {
        method: 'POST',
        path: '/auth/refresh',
        sourceIp,
      },
      requestId: 'test-request-id',
    },
    isBase64Encoded: false,
  };
}

describe('refresh handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_testPoolId';
    process.env['COGNITO_SELLER_CLIENT_ID'] = 'test-client-id';
    process.env['RATE_LIMITS_TABLE'] = 'merch-os-rate-limits-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['COGNITO_SELLER_CLIENT_ID'];
    delete process.env['RATE_LIMITS_TABLE'];
    delete process.env['AWS_REGION'];
  });

  it('returns new tokens on successful refresh', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: {
        AccessToken: 'new-access-token-123',
        IdToken: 'new-id-token-456',
        ExpiresIn: 3600,
      },
    });

    const { handler } = await import('../../handlers/refresh');
    const event = buildEvent({ refreshToken: 'valid-refresh-token' });
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.accessToken).toBe('new-access-token-123');
    expect(body.idToken).toBe('new-id-token-456');
    expect(body.expiresIn).toBe(3600);
  });

  it('returns 401 with REFRESH_TOKEN_EXPIRED when NotAuthorizedException', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).rejects(
      new NotAuthorizedException({ message: 'Refresh token has expired.', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/refresh');
    const event = buildEvent({ refreshToken: 'expired-refresh-token' });
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
    expect(body.error.message).toBe(
      'Refresh token has expired or been revoked. Please log in again.',
    );
  });

  it('returns 500 when env vars are missing', async () => {
    delete process.env['COGNITO_TENANT_POOL_ID'];
    delete process.env['COGNITO_SELLER_CLIENT_ID'];

    const { handler } = await import('../../handlers/refresh');
    const event = buildEvent({ refreshToken: 'some-token' });
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Service misconfigured');
  });

  it('returns 500 when Cognito returns no AuthenticationResult', async () => {
    cognitoMock.on(AdminInitiateAuthCommand).resolves({
      AuthenticationResult: undefined,
    });

    const { handler } = await import('../../handlers/refresh');
    const event = buildEvent({ refreshToken: 'valid-refresh-token' });
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Token refresh failed unexpectedly');
  });
});
