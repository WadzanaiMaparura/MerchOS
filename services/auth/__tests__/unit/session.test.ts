import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the handler
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

vi.mock('@aws-lambda-powertools/logger/middleware', () => ({
  injectLambdaContext: () => ({ before: vi.fn(), after: vi.fn() }),
}));

vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({
  captureLambdaHandler: () => ({ before: vi.fn(), after: vi.fn() }),
}));

vi.mock('@aws-lambda-powertools/metrics/middleware', () => ({
  logMetrics: () => ({ before: vi.fn(), after: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSessionEvent(claims?: Record<string, unknown> | null) {
  // Default to an access token so the central accessTokenMiddleware (which runs
  // for real in this suite) lets requests through; individual tests can
  // override token_use to exercise rejection.
  const effectiveClaims =
    claims && typeof claims === 'object'
      ? { token_use: 'access', ...claims }
      : claims;
  const base: Record<string, unknown> = {
    version: '2.0',
    routeKey: 'GET /auth/session',
    rawPath: '/auth/session',
    headers: { 'content-type': 'application/json' },
    requestContext: {
      http: { method: 'GET', path: '/auth/session', sourceIp: '127.0.0.1' },
      requestId: 'test-request-id',
      authorizer:
        claims !== null
          ? { jwt: { claims: effectiveClaims } }
          : undefined,
    },
    isBase64Encoded: false,
  };
  return base;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('session handler', () => {
  it('returns 200 with user session data when valid JWT claims are present', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent({
      sub: 'user-id-123',
      email: 'user@example.com',
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
      exp: '1700000000',
    });

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual({
      userId: 'user-id-123',
      email: 'user@example.com',
      tenantId: 'tenant-abc',
      role: 'admin',
      expiresAt: 1700000000,
    });
  });

  it('returns 401 for an ID token (token_use "id") — central access-token enforcement', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent({
      token_use: 'id',
      sub: 'user-id-123',
      email: 'user@example.com',
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
      exp: '1700000000',
    });

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('No valid session found');
  });

  it('returns 401 when token_use is absent — central access-token enforcement', async () => {
    const { handler } = await import('../../handlers/session');

    // Explicitly strip the default token_use the builder would add.
    const claims: Record<string, unknown> = {
      sub: 'user-id-123',
      email: 'user@example.com',
      exp: '1700000000',
    };
    const event = buildSessionEvent(claims);
    (event as any).requestContext.authorizer.jwt.claims = claims;

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('No valid session found');
  });

  it('returns 401 when no authorizer context exists', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent(null);

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('No valid session found');
  });

  it('returns 401 when claims are missing sub', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent({
      email: 'user@example.com',
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
      exp: '1700000000',
    });

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid session claims');
  });

  it('returns 401 when claims are missing email', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent({
      sub: 'user-id-123',
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'admin',
      exp: '1700000000',
    });

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Invalid session claims');
  });

  it('handles missing tenantId gracefully (returns empty string)', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent({
      sub: 'user-id-123',
      email: 'user@example.com',
      exp: '1700000000',
    });

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.tenantId).toBe('');
    expect(body.role).toBe('');
  });

  it('parses exp as number correctly', async () => {
    const { handler } = await import('../../handlers/session');

    const event = buildSessionEvent({
      sub: 'user-id-123',
      email: 'user@example.com',
      'custom:tenantId': 'tenant-abc',
      'custom:role': 'seller',
      exp: '1699999999',
    });

    const result = (await handler(event as any, {} as any)) as any;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.expiresAt).toBe(1699999999);
    expect(typeof body.expiresAt).toBe('number');
  });
});
