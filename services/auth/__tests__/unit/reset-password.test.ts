import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  CodeMismatchException,
  ExpiredCodeException,
  InvalidPasswordException,
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

const mockEmitAuthEvent = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({
  emitAuthEvent: (...args: unknown[]) => mockEmitAuthEvent(...args),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const cognitoMock = mockClient(CognitoIdentityProviderClient);

function buildEvent(options: {
  email?: string;
  code?: string;
  newPassword?: string;
} = {}) {
  const {
    email = 'test@example.com',
    code = '123456',
    newPassword = 'NewP@ssw0rd123!',
  } = options;

  return {
    version: '2.0',
    routeKey: 'POST /auth/reset-password',
    rawPath: '/auth/reset-password',
    headers: { 'content-type': 'application/json' },
    body: { email, code, newPassword },
    requestContext: {
      http: {
        method: 'POST',
        path: '/auth/reset-password',
        sourceIp: '192.168.1.1',
      },
      requestId: 'test-request-id',
    },
    isBase64Encoded: false,
  };
}

describe('reset-password handler', () => {
  beforeEach(() => {
    cognitoMock.reset();
    resetCognitoClient();
    mockEmitAuthEvent.mockClear();
    process.env['COGNITO_SELLER_CLIENT_ID'] = 'test-client-id';
    process.env['EVENT_BUS_NAME'] = 'merch-os-events-dev';
    process.env['AWS_REGION'] = 'af-south-1';
  });

  afterEach(() => {
    delete process.env['COGNITO_SELLER_CLIENT_ID'];
    delete process.env['EVENT_BUS_NAME'];
    delete process.env['AWS_REGION'];
  });

  it('returns 200 { success: true } on successful password reset', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).resolves({});

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
  });

  it('calls ConfirmForgotPassword with correct parameters', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).resolves({});

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent({
      email: 'user@shop.com',
      code: '654321',
      newPassword: 'Str0ng!Pass#2024',
    });
    await handler(event as any, {} as any);

    const calls = cognitoMock.commandCalls(ConfirmForgotPasswordCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toEqual({
      ClientId: 'test-client-id',
      Username: 'user@shop.com',
      ConfirmationCode: '654321',
      Password: 'Str0ng!Pass#2024',
    });
  });

  it('emits auth.password.reset event on success', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).resolves({});

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent({ email: 'user@shop.com' });
    await handler(event as any, {} as any);

    // Allow fire-and-forget promise to resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockEmitAuthEvent).toHaveBeenCalledWith({
      detailType: 'auth.password.reset',
      detail: expect.objectContaining({
        email: 'user@shop.com',
      }),
    });
  });

  it('returns 400 INVALID_CODE on CodeMismatchException', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).rejects(
      new CodeMismatchException({ message: 'Invalid code', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_CODE');
  });

  it('returns 400 CODE_EXPIRED on ExpiredCodeException', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).rejects(
      new ExpiredCodeException({ message: 'Code has expired', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('CODE_EXPIRED');
  });

  it('returns 400 WEAK_PASSWORD on InvalidPasswordException', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).rejects(
      new InvalidPasswordException({ message: 'Password too weak', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('WEAK_PASSWORD');
  });

  it('returns 400 INVALID_CODE on UserNotFoundException (no user enumeration)', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).rejects(
      new UserNotFoundException({ message: 'User not found', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INVALID_CODE');
  });

  it('returns 429 RATE_LIMIT on LimitExceededException', async () => {
    cognitoMock.on(ConfirmForgotPasswordCommand).rejects(
      new LimitExceededException({ message: 'Rate limit', $metadata: {} }),
    );

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(429);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('RATE_LIMIT');
  });

  it('returns 500 INTERNAL_ERROR when COGNITO_SELLER_CLIENT_ID is missing', async () => {
    delete process.env['COGNITO_SELLER_CLIENT_ID'];

    const { handler } = await import('../../handlers/reset-password');
    const event = buildEvent();
    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
