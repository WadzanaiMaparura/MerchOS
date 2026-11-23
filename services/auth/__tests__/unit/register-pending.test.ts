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

import { handler, setClaimsClient } from '../../handlers/register-pending';
import { registerPendingSchema } from '../../schemas';

/** Identity-claim lookups: by default nothing is claimed yet. */
const claimsSend = vi.fn();
setClaimsClient({ send: claimsSend } as never);

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
    claimsSend.mockReset();
    claimsSend.mockResolvedValue({});
    process.env['TENANTS_TABLE'] = 'merch-os-tenants-test';
    process.env['SIGNUPS_OPEN'] = 'true';
  });

  it('while sign-ups are closed: 403 SIGNUPS_CLOSED and nothing is looked up or stored', async () => {
    process.env['SIGNUPS_OPEN'] = 'false';
    const result = (await handler(buildEvent(VALID_BODY), {} as never, () => {})) as { statusCode: number; body: string };
    expect(result.statusCode).toBe(403);
    expect(JSON.parse(result.body).error.code).toBe('SIGNUPS_CLOSED');
    expect(claimsSend).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    delete process.env['SIGNUPS_OPEN'];
    const unset = (await handler(buildEvent(VALID_BODY), {} as never, () => {})) as { statusCode: number };
    expect(unset.statusCode).toBe(403); // closed unless explicitly opened
  });

  it('refuses (409) when the email, phone or business name already has an account, before creating anything', async () => {
    // Only the phone claim exists.
    claimsSend.mockImplementation(async (cmd: { input: { Key: { PK: string } } }) =>
      cmd.input.Key.PK.startsWith('CLAIM#PHONE#') ? { Item: { tenantId: 'other' } } : {},
    );
    const result = (await handler(buildEvent(VALID_BODY), {} as never, () => {})) as { statusCode: number; body: string };
    expect(result.statusCode).toBe(409);
    expect(JSON.parse(result.body).error.code).toBe('ACCOUNT_ALREADY_EXISTS');
    // Does not reveal which detail matched.
    expect(result.body).not.toContain('+27831234567');
    expect(createMock).not.toHaveBeenCalled();
    const looked = claimsSend.mock.calls.map((c) => (c[0] as { input: { Key: { PK: string } } }).input.Key.PK);
    expect(looked).toEqual([
      'CLAIM#EMAIL#seller@example.com',
      'CLAIM#PHONE#+27831234567',
      'CLAIM#ORG#analytical engines',
    ]);
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
    delete process.env['TENANTS_TABLE'];

    const result = (await handler(buildEvent(VALID_BODY), {} as never, () => {})) as {
      statusCode: number;
    };

    expect(result.statusCode).toBe(500);
  });
});
