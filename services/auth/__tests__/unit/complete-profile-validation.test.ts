import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Integration-level guard for POST /auth/complete-profile:
 * the REAL input-validation middleware + REAL completeProfileSchema must reject
 * an invalid payload with HTTP 400 BEFORE any persistence is attempted.
 *
 * This complements complete-profile.test.ts (which mocks validation out to test
 * the handler body) and complete-profile-schema.test.ts (which tests the schema
 * in isolation). Here we prove the wired middy stack short-circuits so that a
 * malformed request can never reach completeOwnerProfile.
 *
 * Stage A assertion: "Invalid payloads are rejected before persistence."
 */

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));
vi.mock('@aws-lambda-powertools/logger/middleware', () => ({ injectLambdaContext: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({ captureLambdaHandler: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/metrics/middleware', () => ({ logMetrics: () => ({ before: vi.fn(), after: vi.fn() }) }));

// NOTE: input-validation is intentionally NOT mocked here — we exercise the real
// middleware wired into the handler.

const mockEmit = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({ emitAuthEvent: (...a: unknown[]) => mockEmit(...a) }));

const mockFindInvitation = vi.fn();
const mockReadProfileState = vi.fn();
vi.mock('../../repository/profile-status-repository', () => ({
  findInvitation: (...a: unknown[]) => mockFindInvitation(...a),
  readProfileState: (...a: unknown[]) => mockReadProfileState(...a),
}));

// Spy on the persistence boundary — it must NEVER be called for invalid input.
const mockComplete = vi.fn();
vi.mock('../../repository/registration-persistence', async () => {
  const actual = await vi.importActual<typeof import('../../repository/registration-persistence')>(
    '../../repository/registration-persistence',
  );
  return {
    ...actual,
    completeOwnerProfile: (...a: unknown[]) => mockComplete(...a),
  };
});

const ownerClaims = {
  sub: 's1',
  email: 'a@b.com',
  email_verified: 'true',
  token_use: 'access',
  'custom:tenantId': 'tenant-1',
  'custom:role': 'owner',
};

function buildEvent(body: unknown) {
  return {
    version: '2.0',
    routeKey: 'POST /auth/complete-profile',
    rawPath: '/auth/complete-profile',
    requestContext: {
      http: { method: 'POST', path: '/auth/complete-profile', sourceIp: '127.0.0.1' },
      authorizer: { jwt: { claims: ownerClaims } },
    },
    // String body — mirrors how API Gateway delivers it; the real middleware
    // parses and validates it against completeProfileSchema.
    body: typeof body === 'string' ? body : JSON.stringify(body),
    isBase64Encoded: false,
  } as Record<string, unknown>;
}

function res(r: unknown) {
  return { statusCode: (r as { statusCode: number }).statusCode, body: JSON.parse((r as { body: string }).body) };
}

describe('complete-profile — real input validation rejects before persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TENANTS_TABLE'] = 'merch-os-tenants-dev';
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    mockFindInvitation.mockResolvedValue(null);
    mockReadProfileState.mockResolvedValue({ metadata: undefined, owner: undefined });
    mockComplete.mockResolvedValue({ result: 'created' });
  });

  it('rejects a missing organisation name with 400 and never persists', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(
      buildEvent({ fullName: 'Owner One', phone: '+27123456789' }) as never,
      {} as never,
    ));
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('rejects an injected tenantId (strict schema) with 400 and never persists', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(
      buildEvent({
        fullName: 'Owner One',
        phone: '+27123456789',
        organisationName: 'Acme',
        tenantId: 'ATTACKER-TENANT',
      }) as never,
      {} as never,
    ));
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('rejects consent channels selected without consent granted with 400 and never persists', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(
      buildEvent({
        fullName: 'Owner One',
        phone: '+27123456789',
        organisationName: 'Acme',
        consentGranted: false,
        consentChannels: ['email'],
      }) as never,
      {} as never,
    ));
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400 and never persists', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent('{not-json') as never, {} as never));
    expect(r.statusCode).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('accepts a valid payload through the real middleware and persists exactly once', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(
      buildEvent({ fullName: 'Owner One', phone: '+27123456789', organisationName: 'Acme Trading' }) as never,
      {} as never,
    ));
    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe('complete');
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });
});
