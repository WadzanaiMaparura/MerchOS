import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
  UserNotFoundException,
  LimitExceededException,
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

vi.mock('../../../shared/middleware/rate-limit', () => ({
  rateLimitMiddleware: () => ({ before: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function buildEvent(options: { email?: string } = {}) {
  const { email = 'test@example.com' } = options;

  return {
    version: '2.0',
    routeKey: 'POST /auth/forgot-password',
    rawPath: '/auth/forgot-password',
    headers: { 'content-type': 'application/json' },
    body: { email },
    requestContext: {
      http: {
        method: 'POST',
        path: '/auth/forgot-password',
        sourceIp: '192.168.1.1',
      },
      requestId: 'test-request-id',
    },
    isBase64Encoded: false,
  };
}

describe('forgot-password handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    process.env['COGNITO_SELLER_CLIENT_ID'] = 'test-client-id';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_SELLER_CLIENT_ID'];
    delete process.env['AWS_REGION'];
  });

  it('returns 200 with generic message on success', async () => {
    cognitoMock.on(ForgotPasswordCommand).resolves({});

    const { handler } = await import('../../handlers/forgot-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('If an account exists, a reset code has been sent.');
  });

  it('calls ForgotPasswordCommand with correct ClientId and Username', async () => {
    cognitoMock.on(ForgotPasswordCommand).resolves({});

    const { handler } = await import('../../handlers/forgot-password');
    const event = buildEvent({ email: 'user@shop.com' });
    await handler(event as any, {} as any);

    const calls = cognitoMock.commandCalls(ForgotPasswordCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      ClientId: 'test-client-id',
      Username: 'user@shop.com',
    });
  });

  it('returns 200 with same message when UserNotFoundException is thrown', async () => {
    cognitoMock.on(ForgotPasswordCommand).rejects(
      new UserNotFoundException({ message: 'User not found', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/forgot-password');
    const event = buildEvent({ email: 'nonexistent@example.com' });
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('If an account exists, a reset code has been sent.');
  });

  it('returns 200 with same message when LimitExceededException is thrown', async () => {
    cognitoMock.on(ForgotPasswordCommand).rejects(
      new LimitExceededException({ message: 'Attempt limit exceeded', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/forgot-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('If an account exists, a reset code has been sent.');
  });

  it('returns 200 with same message when COGNITO_SELLER_CLIENT_ID is missing', async () => {
    delete process.env['COGNITO_SELLER_CLIENT_ID'];

    const { handler } = await import('../../handlers/forgot-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('If an account exists, a reset code has been sent.');
  });
});
