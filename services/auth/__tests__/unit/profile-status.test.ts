import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));
vi.mock('@aws-lambda-powertools/logger/middleware', () => ({ injectLambdaContext: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/tracer/middleware', () => ({ captureLambdaHandler: () => ({ before: vi.fn(), after: vi.fn() }) }));
vi.mock('@aws-lambda-powertools/metrics/middleware', () => ({ logMetrics: () => ({ before: vi.fn(), after: vi.fn() }) }));

const ddbMock = mockClient(DynamoDBDocumentClient);

function buildEvent(claims?: Record<string, unknown> | null) {
  return {
    version: '2.0',
    routeKey: 'GET /auth/profile-status',
    rawPath: '/auth/profile-status',
    requestContext: {
      http: { method: 'GET', path: '/auth/profile-status', sourceIp: '127.0.0.1' },
      authorizer: claims !== null ? { jwt: { claims } } : undefined,
    },
    isBase64Encoded: false,
  } as Record<string, unknown>;
}

function body(res: unknown) {
  return JSON.parse((res as { body: string }).body);
}

const PK = 'TENANT#tenant-1';
// CANONICAL keys (PR #28): owner profile at PROFILE#USER#<sub>, metadata ownerId.
const OWNER_SK = 'PROFILE#USER#s1';

describe('profile-status handler (canonical schema)', () => {
  beforeEach(async () => {
    ddbMock.reset();
    process.env['TENANTS_TABLE'] = 'merch-os-tenants-dev';
    process.env['INVITATIONS_TABLE'] = 'merch-os-invitations-dev';
    const { resetProfileStatusRepositoryClient } = await import('../../repository/profile-status-repository');
    resetProfileStatusRepositoryClient();
  });

  it('401 when no claims', async () => {
    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(buildEvent(null) as never, {} as never);
    expect((res as { statusCode: number }).statusCode).toBe(401);
  });

  it('401 when the token is an ID token (token_use "id")', async () => {
    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'true', token_use: 'id', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' }) as never,
      {} as never,
    );
    expect((res as { statusCode: number }).statusCode).toBe(401);
    expect(body(res).error.code).toBe('UNAUTHORIZED');
  });

  it('401 when token_use is absent', async () => {
    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'true', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' }) as never,
      {} as never,
    );
    expect((res as { statusCode: number }).statusCode).toBe(401);
    expect(body(res).error.code).toBe('UNAUTHORIZED');
  });

  it('not_verified when email_verified is false', async () => {
    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'false', token_use: 'access', 'custom:tenantId': 'tenant-1' }) as never,
      {} as never,
    );
    expect(body(res).status).toBe('not_verified');
  });

  it('complete for an owner created through the PR #28 PostConfirmation schema (ownerId + PROFILE#USER#)', async () => {
    // Records exactly as PostConfirmation writes them.
    ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: { ownerId: 's1', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({ Item: { userId: 's1', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: 'INVITE#a@b.com' } }).resolves({});

    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'true', token_use: 'access', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' }) as never,
      {} as never,
      () => {},
    );
    expect(body(res).status).toBe('complete');
  });

  it('needs_profile_completion when no records and no invitation', async () => {
    ddbMock.on(GetCommand).resolves({});
    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'true', token_use: 'access', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' }) as never,
      {} as never,
      () => {},
    );
    expect(body(res).status).toBe('needs_profile_completion');
  });

  it('invited when an invitation record exists and no owner profile yet', async () => {
    ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({});
    ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({});
    ddbMock.on(GetCommand, { Key: { PK, SK: 'INVITE#a@b.com' } }).resolves({ Item: { role: 'owner', status: 'pending' } });

    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'true', token_use: 'access', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' }) as never,
      {} as never,
      () => {},
    );
    expect(body(res).status).toBe('invited');
  });

  it('conflict when owner profile belongs to a different subject (canonical ownerId mismatch)', async () => {
    ddbMock.on(GetCommand, { Key: { PK, SK: 'METADATA' } }).resolves({ Item: { ownerId: 'other', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: OWNER_SK } }).resolves({ Item: { userId: 'other', tenantId: 'tenant-1' } });
    ddbMock.on(GetCommand, { Key: { PK, SK: 'INVITE#a@b.com' } }).resolves({});

    const { handler } = await import('../../handlers/profile-status');
    const res = await handler(
      buildEvent({ sub: 's1', email: 'a@b.com', email_verified: 'true', token_use: 'access', 'custom:tenantId': 'tenant-1', 'custom:role': 'owner' }) as never,
      {} as never,
      () => {},
    );
    expect(body(res).status).toBe('conflict');
  });
});
