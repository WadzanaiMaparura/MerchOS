import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));
vi.mock('@aws-lambda-powertools/logger/middleware', () => ({ injectLambdaContext: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({ captureLambdaHandler: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/metrics/middleware', () => ({ logMetrics: () => ({ before: vi.fn(), after: vi.fn() }) }));
// input-validation mocked to no-op; tests pass an already-parsed body object.
vi.mock('../../../shared/middleware/input-validation', () => ({ inputValidationMiddleware: () => ({ before: vi.fn() }) }));

const mockEmit = vi.fn().mockResolvedValue({});
vi.mock('../../utils/event-emitter', () => ({ emitAuthEvent: (...a: unknown[]) => mockEmit(...a) }));

const mockFindInvitation = vi.fn();
vi.mock('../../repository/profile-status-repository', () => ({
  findInvitation: (...a: unknown[]) => mockFindInvitation(...a),
}));

const mockComplete = vi.fn();
vi.mock('../../repository/profile-completion-repository', async () => {
  const actual = await vi.importActual<typeof import('../../repository/profile-completion-repository')>(
    '../../repository/profile-completion-repository',
  );
  return {
    ...actual,
    completeOwnerProfile: (...a: unknown[]) => mockComplete(...a),
  };
});

function buildEvent(claims: Record<string, unknown> | null, body: Record<string, unknown>) {
  return {
    version: '2.0',
    routeKey: 'POST /auth/complete-profile',
    rawPath: '/auth/complete-profile',
    requestContext: {
      http: { method: 'POST', path: '/auth/complete-profile', sourceIp: '127.0.0.1' },
      authorizer: claims !== null ? { jwt: { claims } } : undefined,
    },
    body, // already-parsed (input-validation middleware is mocked out)
    isBase64Encoded: false,
  } as Record<string, unknown>;
}

const validBody = { fullName: 'Owner One', phone: '+27123456789', organisationName: 'Acme', consentGranted: false, consentChannels: [] };
const ownerClaims = { sub: 's1', email: 'a@b.com', email_verified: 'true', token_use: 'access', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' };

function res(r: unknown) {
  return { statusCode: (r as { statusCode: number }).statusCode, body: JSON.parse((r as { body: string }).body) };
}

describe('complete-profile handler (canonical schema)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TENANTS_TABLE'] = 'merch-os-tenants-dev';
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    mockFindInvitation.mockResolvedValue(null);
    mockComplete.mockResolvedValue({ result: 'created' });
  });

  it('401 when no claims', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(null, validBody) as never, {} as never));
    expect(r.statusCode).toBe(401);
  });

  it('401 when the token is an ID token (token_use "id"); never persists', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent({ ...ownerClaims, token_use: 'id' }, validBody) as never, {} as never));
    expect(r.statusCode).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('401 when token_use is absent; never persists', async () => {
    const noTokenUse = { ...ownerClaims } as Record<string, unknown>;
    delete noTokenUse['token_use'];
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(noTokenUse, validBody) as never, {} as never));
    expect(r.statusCode).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('403 when email not verified', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent({ ...ownerClaims, email_verified: 'false' }, validBody) as never, {} as never));
    expect(r.statusCode).toBe(403);
    expect(r.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('403 when role is not owner (never creates/owns a tenant)', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent({ ...ownerClaims, 'custom:role': 'viewer' }, validBody) as never, {} as never));
    expect(r.statusCode).toBe(403);
    expect(r.body.error.code).toBe('NOT_OWNER');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('409 when the account is invitation-linked (never creates a tenant)', async () => {
    mockFindInvitation.mockResolvedValue({ role: 'owner', status: 'pending' });
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(ownerClaims, validBody) as never, {} as never));
    expect(r.statusCode).toBe(409);
    expect(r.body.error.code).toBe('INVITED_ACCOUNT');
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('200 and emits event on created; uses claims identity, never trusts body tenantId/role', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(ownerClaims, { ...validBody, tenantId: 'ATTACKER-TENANT', role: 'admin' }) as never, {} as never));
    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe('complete');
    // tenantId/role/userId/email passed to repo come from claims, not body.
    expect(mockComplete).toHaveBeenCalledWith(
      'merch-os-tenants-dev',
      expect.objectContaining({ tenantId: 'tenant-1', userId: 's1', email: 'a@b.com', role: 'owner' }),
    );
    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  it('200 and does NOT emit when already_completed (idempotent replay, no overwrite)', async () => {
    mockComplete.mockResolvedValue({ result: 'already_completed' });
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(ownerClaims, validBody) as never, {} as never));
    expect(r.statusCode).toBe(200);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('409 on durable-state conflict (different subject owns tenant/owner)', async () => {
    mockComplete.mockResolvedValue({ result: 'conflict', reason: 'different subject' });
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(ownerClaims, validBody) as never, {} as never));
    expect(r.statusCode).toBe(409);
    expect(r.body.error.code).toBe('PROFILE_CONFLICT');
  });

  it('completes recovery without any pending record (mints a fresh registrationId)', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    const r = res(await handler(buildEvent(ownerClaims, validBody) as never, {} as never));
    expect(r.statusCode).toBe(200);
    expect(r.body.status).toBe('complete');
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const passed = mockComplete.mock.calls[0][1] as { registrationId: string };
    expect(typeof passed.registrationId).toBe('string');
    expect(passed.registrationId.length).toBeGreaterThan(0);
  });

  it('forwards the exact user-supplied organisation/name/phone to persistence (no fabrication)', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    await handler(
      buildEvent(ownerClaims, {
        fullName: 'Jane Owner',
        phone: '+27115550100',
        organisationName: 'Acme Trading Co',
        consentGranted: false,
        consentChannels: [],
      }) as never,
      {} as never,
    );
    expect(mockComplete).toHaveBeenCalledWith(
      'merch-os-tenants-dev',
      expect.objectContaining({
        fullName: 'Jane Owner',
        phone: '+27115550100',
        organisationName: 'Acme Trading Co',
        email: 'a@b.com',
        tenantId: 'tenant-1',
        userId: 's1',
      }),
    );
  });

  it('passes consent channels + version only when granted (audit preserved)', async () => {
    const { handler } = await import('../../handlers/complete-profile');
    await handler(buildEvent(ownerClaims, { ...validBody, consentGranted: true, consentChannels: ['email'] }) as never, {} as never);
    expect(mockComplete).toHaveBeenCalledWith(
      'merch-os-tenants-dev',
      expect.objectContaining({
        consentGranted: true,
        consentChannels: ['email'],
        consentTextVersion: expect.any(String),
      }),
    );
  });
});
