import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const createMock = vi.fn();
vi.mock('../../registration/pending-registration-repository', () => ({
  PendingRegistrationRepository: class {
    create = createMock;
  },
}));

import { handler } from '../../handlers/register-pending';
import { registerPendingSchema } from '../../schemas';

const VALID_BODY = {
  fullName: 'Ada Lovelace',
  email: 'seller@example.com',
  phoneNumber: '+27831234567',
  organisationName: 'Analytical Engines',
  marketingConsent: true,
};

function buildEvent(body: unknown): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /auth/register-pending',
    rawPath: '/auth/register-pending',
    rawQueryString: '',
    headers: { 'content-type': 'application/json' },
    requestContext: {} as never,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

describe('registerPendingSchema', () => {
  it('rejects a phone number without a leading +/country code', () => {
    const result = registerPendingSchema.safeParse({ ...VALID_BODY, phoneNumber: '0831234567' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid international phone number', () => {
    const result = registerPendingSchema.safeParse(VALID_BODY);
    expect(result.success).toBe(true);
  });

  it('does not define password or verification code fields', () => {
    const parsed = registerPendingSchema.parse(VALID_BODY) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('password');
    expect(parsed).not.toHaveProperty('confirmPassword');
    expect(parsed).not.toHaveProperty('code');
  });

  it('defaults marketingConsent to false when omitted', () => {
    const { marketingConsent, ...withoutConsent } = VALID_BODY;
    void marketingConsent;
    const parsed = registerPendingSchema.parse(withoutConsent);
    expect(parsed.marketingConsent).toBe(false);
  });
});

describe('register-pending handler', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-test';
  });

  it('returns 201 with only the registrationId (no tenantId leaked)', async () => {
    createMock.mockResolvedValue({ registrationId: 'reg-123', tenantId: 'secret-tenant' });

    const result = (await handler(buildEvent(VALID_BODY), {} as never, () => {})) as {
      statusCode: number;
      body: string;
    };

    expect(result.statusCode).toBe(201);
    const parsed = JSON.parse(result.body);
    expect(parsed).toEqual({ registrationId: 'reg-123' });
    expect(parsed).not.toHaveProperty('tenantId');
  });

  it('passes only approved fields to the repository (no password/code)', async () => {
    createMock.mockResolvedValue({ registrationId: 'reg-1', tenantId: 't-1' });

    await handler(
      buildEvent({ ...VALID_BODY, password: 'ShouldBeIgnored1!', code: '123456' }),
      {} as never,
      () => {},
    );

    expect(createMock).toHaveBeenCalledTimes(1);
    const arg = createMock.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(
      ['email', 'fullName', 'marketingConsent', 'organisationName', 'phoneNumber'].sort(),
    );
    expect(arg).not.toHaveProperty('password');
    expect(arg).not.toHaveProperty('code');
  });

  it('returns 400 for an invalid phone number', async () => {
    const result = (await handler(
      buildEvent({ ...VALID_BODY, phoneNumber: '0831234567' }),
      {} as never,
      () => {},
    )) as { statusCode: number };

    expect(result.statusCode).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns 500 when the table is misconfigured', async () => {
    delete process.env['INVITATIONS_TABLE'];

    const result = (await handler(buildEvent(VALID_BODY), {} as never, () => {})) as {
      statusCode: number;
    };

    expect(result.statusCode).toBe(500);
  });
});
