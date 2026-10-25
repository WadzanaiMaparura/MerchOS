import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
  AssociateSoftwareTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { resetCognitoClient } from '../../utils/cognito-client';

/**
 * Pool-id environment-variable contract regression tests for the AuthApi
 * handlers that previously had no dedicated test and read the user-pool id
 * from the environment: disable-user, delete-user and mfa-setup.
 *
 * The AuthApi stack provides COGNITO_USER_POOL_ID (never COGNITO_TENANT_POOL_ID).
 * These tests prove each handler reads the stack-provided key, passes it to the
 * relevant Cognito command where applicable, and is NOT satisfied by the legacy
 * COGNITO_TENANT_POOL_ID name (which must still produce the missing-config 500).
 */

// Shared middleware is mocked to no-ops so these tests exercise handler logic.
vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));
vi.mock('../../../shared/middleware/rbac', () => ({ rbacMiddleware: () => ({ before: vi.fn() }) }));
vi.mock('../../../shared/middleware/tenant-context', () => ({ tenantContextMiddleware: () => ({ before: vi.fn() }) }));
vi.mock('../../../shared/middleware/access-token', () => ({ accessTokenMiddleware: () => ({ before: vi.fn() }) }));
vi.mock('../../utils/event-emitter', () => ({ emitAuthEvent: vi.fn().mockResolvedValue({}) }));
// mfa-setup uses the powertools middleware primitives directly; mock them to
// no-ops (as the session handler test does) so the handler logic runs.
vi.mock('@aws-lambda-powertools/logger/middleware', () => ({ injectLambdaContext: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({ captureLambdaHandler: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/metrics/middleware', () => ({ logMetrics: () => ({ before: vi.fn(), after: vi.fn() }) }));

const cognitoMock = mockClient(CognitoIdentityProviderClient);

const CORRECT_POOL = 'eu-west-1_correctPool';

function userEvent(id: string) {
  return {
    version: '2.0',
    rawPath: `/auth/users/${id}`,
    headers: {},
    pathParameters: { id },
    requestContext: {
      http: { method: 'POST', path: `/auth/users/${id}`, sourceIp: '127.0.0.1' },
      authorizer: { rbac: { userId: 'admin-1' }, jwt: { claims: { sub: 'admin-1' } } },
    },
    isBase64Encoded: false,
  } as Record<string, unknown>;
}

beforeEach(() => {
  cognitoMock.reset();
  resetCognitoClient();
  process.env['AWS_REGION'] = 'eu-west-1';
});

afterEach(() => {
  delete process.env['COGNITO_USER_POOL_ID'];
  delete process.env['COGNITO_TENANT_POOL_ID'];
  delete process.env['AWS_REGION'];
});

describe('disable-user pool-id env contract', () => {
  it('reads COGNITO_USER_POOL_ID and passes it as UserPoolId to Cognito', async () => {
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_wrongLegacyKey';
    process.env['COGNITO_USER_POOL_ID'] = CORRECT_POOL;
    cognitoMock.on(AdminDisableUserCommand).resolves({});

    const { handler } = await import('../../handlers/disable-user');
    const result = (await handler(userEvent('target-1') as never, {} as never)) as any;

    expect(result.statusCode).toBe(200);
    const calls = cognitoMock.commandCalls(AdminDisableUserCommand);
    expect(calls.length).toBe(1);
    expect(calls[0]?.args[0].input.UserPoolId).toBe(CORRECT_POOL);
  });

  it('returns 500 when only the legacy COGNITO_TENANT_POOL_ID is set', async () => {
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_legacyOnly';

    const { handler } = await import('../../handlers/disable-user');
    const result = (await handler(userEvent('target-1') as never, {} as never)) as any;

    expect(result.statusCode).toBe(500);
    expect(cognitoMock.commandCalls(AdminDisableUserCommand).length).toBe(0);
  });
});

describe('delete-user pool-id env contract', () => {
  it('reads COGNITO_USER_POOL_ID and passes it as UserPoolId to Cognito', async () => {
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_wrongLegacyKey';
    process.env['COGNITO_USER_POOL_ID'] = CORRECT_POOL;
    cognitoMock.on(AdminGetUserCommand).resolves({ Username: 'target-1', UserAttributes: [] });
    cognitoMock.on(AdminDeleteUserCommand).resolves({});

    const { handler } = await import('../../handlers/delete-user');
    const result = (await handler(userEvent('target-1') as never, {} as never)) as any;

    expect(result.statusCode).toBeLessThan(500);
    const calls = cognitoMock.commandCalls(AdminGetUserCommand);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]?.args[0].input.UserPoolId).toBe(CORRECT_POOL);
  });

  it('returns 500 when only the legacy COGNITO_TENANT_POOL_ID is set', async () => {
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_legacyOnly';

    const { handler } = await import('../../handlers/delete-user');
    const result = (await handler(userEvent('target-1') as never, {} as never)) as any;

    expect(result.statusCode).toBe(500);
    expect(cognitoMock.commandCalls(AdminGetUserCommand).length).toBe(0);
    expect(cognitoMock.commandCalls(AdminDeleteUserCommand).length).toBe(0);
  });
});

describe('mfa-setup pool-id env contract', () => {
  function mfaEvent() {
    return {
      version: '2.0',
      rawPath: '/auth/mfa/setup',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
      requestContext: {
        http: { method: 'POST', path: '/auth/mfa/setup', sourceIp: '127.0.0.1' },
        authorizer: { jwt: { claims: { sub: 'user-1' } } },
      },
      isBase64Encoded: false,
    } as Record<string, unknown>;
  }

  it('reads COGNITO_USER_POOL_ID (does not 500 on config) and reaches Cognito', async () => {
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_wrongLegacyKey';
    process.env['COGNITO_USER_POOL_ID'] = CORRECT_POOL;
    cognitoMock.on(AssociateSoftwareTokenCommand).resolves({ SecretCode: 'SECRET123' });

    const { handler } = await import('../../handlers/mfa-setup');
    const result = (await handler(mfaEvent() as never, {} as never)) as any;

    // With the correct key present the handler proceeds past the env check and
    // reaches the Cognito associate-token call (step 1).
    expect(result.statusCode).toBe(200);
    expect(cognitoMock.commandCalls(AssociateSoftwareTokenCommand).length).toBe(1);
  });

  it('returns 500 when only the legacy COGNITO_TENANT_POOL_ID is set', async () => {
    process.env['COGNITO_TENANT_POOL_ID'] = 'us-east-1_legacyOnly';

    const { handler } = await import('../../handlers/mfa-setup');
    const result = (await handler(mfaEvent() as never, {} as never)) as any;

    expect(result.statusCode).toBe(500);
    expect(cognitoMock.commandCalls(AssociateSoftwareTokenCommand).length).toBe(0);
  });
});
