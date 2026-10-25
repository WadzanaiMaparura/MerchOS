import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  CodeMismatchException,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';
import { resetCognitoClient } from '../../utils/cognito-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));

// Neutralize the Powertools middy middleware so the handler runs plainly.
vi.mock('@aws-lambda-powertools/logger/middleware', () => ({
  injectLambdaContext: () => ({ before: vi.fn(), after: vi.fn() }),
}));
vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({
  captureLambdaHandler: () => ({ before: vi.fn(), after: vi.fn() }),
}));
vi.mock('@aws-lambda-powertools/metrics/middleware', () => ({
  logMetrics: () => ({ before: vi.fn(), after: vi.fn() }),
}));

const cognitoMock = mockClient(CognitoIdentityProviderClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEvent(opts: {
  accessToken?: string;
  body?: Record<string, unknown> | null;
}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.accessToken) headers['authorization'] = `Bearer ${opts.accessToken}`;
  return {
    version: '2.0',
    routeKey: 'POST /auth/mfa/setup',
    rawPath: '/auth/mfa/setup',
    headers,
    body: opts.body === undefined ? null : JSON.stringify(opts.body),
    requestContext: { http: { method: 'POST' } },
  } as never;
}

async function invoke(event: never) {
  const { handler } = await import('../../handlers/mfa-setup');
  return handler(event, {} as never, () => undefined) as Promise<{
    statusCode: number;
    body: string;
  }>;
}

beforeEach(() => {
  cognitoMock.reset();
  resetCognitoClient();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mfa-setup handler — auth', () => {
  it('returns 401 when no access token is present', async () => {
    const res = await invoke(buildEvent({ body: null }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
    // No Cognito call should be attempted without an access token.
    expect(cognitoMock.calls()).toHaveLength(0);
  });
});

describe('mfa-setup handler — step 1 associate', () => {
  it('associates the software token against the caller access token and returns the secret', async () => {
    cognitoMock.on(AssociateSoftwareTokenCommand).resolves({ SecretCode: 'JBSWY3DPEHPK3PXP' });

    const res = await invoke(buildEvent({ accessToken: 'tok-123', body: null }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ secretCode: 'JBSWY3DPEHPK3PXP' });

    const associateCalls = cognitoMock.commandCalls(AssociateSoftwareTokenCommand);
    expect(associateCalls).toHaveLength(1);
    // The fix: AccessToken must be passed (was previously empty → always failed).
    expect(associateCalls[0]!.args[0].input).toEqual({ AccessToken: 'tok-123' });
  });

  it('returns 500 when Cognito returns no secret code', async () => {
    cognitoMock.on(AssociateSoftwareTokenCommand).resolves({});
    const res = await invoke(buildEvent({ accessToken: 'tok-123', body: null }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });

  it('maps NotAuthorizedException to 401', async () => {
    cognitoMock
      .on(AssociateSoftwareTokenCommand)
      .rejects(new NotAuthorizedException({ message: 'bad token', $metadata: {} }));
    const res = await invoke(buildEvent({ accessToken: 'tok-123', body: null }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('UNAUTHORIZED');
  });
});

describe('mfa-setup handler — step 2 verify + enable', () => {
  it('verifies the code then sets TOTP as the preferred factor (self-service, no admin)', async () => {
    cognitoMock.on(VerifySoftwareTokenCommand).resolves({ Status: 'SUCCESS' });
    cognitoMock.on(SetUserMFAPreferenceCommand).resolves({});

    const res = await invoke(
      buildEvent({ accessToken: 'tok-123', body: { verificationCode: '654321' } })
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, mfaEnabled: true });

    const verifyCalls = cognitoMock.commandCalls(VerifySoftwareTokenCommand);
    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]!.args[0].input).toMatchObject({
      AccessToken: 'tok-123',
      UserCode: '654321',
    });

    const prefCalls = cognitoMock.commandCalls(SetUserMFAPreferenceCommand);
    expect(prefCalls).toHaveLength(1);
    expect(prefCalls[0]!.args[0].input).toEqual({
      AccessToken: 'tok-123',
      SoftwareTokenMfaSettings: { Enabled: true, PreferredMfa: true },
    });
  });

  it('returns 400 and does NOT set the preference when verification is not SUCCESS', async () => {
    cognitoMock.on(VerifySoftwareTokenCommand).resolves({ Status: 'ERROR' });

    const res = await invoke(
      buildEvent({ accessToken: 'tok-123', body: { verificationCode: '000000' } })
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VERIFICATION_FAILED');
    expect(cognitoMock.commandCalls(SetUserMFAPreferenceCommand)).toHaveLength(0);
  });

  it('maps CodeMismatchException to 400 INVALID_CODE', async () => {
    cognitoMock
      .on(VerifySoftwareTokenCommand)
      .rejects(new CodeMismatchException({ message: 'nope', $metadata: {} }));

    const res = await invoke(
      buildEvent({ accessToken: 'tok-123', body: { verificationCode: '111111' } })
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_CODE');
    expect(cognitoMock.commandCalls(SetUserMFAPreferenceCommand)).toHaveLength(0);
  });
});
