import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for the Stage B registration reconciliation worker.
 *
 * The repositories and the Cognito client are mocked at the module boundary so
 * each test drives a specific scenario deterministically. Powertools is mocked
 * to no-ops. We assert both the SQS batch response (retry vs acknowledge) and
 * that persistence is only ever invoked through the approved repository with
 * identity derived from Cognito (never from the queue message).
 */

vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
  MetricUnit: { Count: 'Count' },
}));

const mockGetPending = vi.fn();
const mockDeletePending = vi.fn();
vi.mock('../../repository/pending-registration-repository', async () => {
  const actual = await vi.importActual<
    typeof import('../../repository/pending-registration-repository')
  >('../../repository/pending-registration-repository');
  return {
    ...actual, // keep the real isPendingRegistrationExpired + key helpers
    getPendingRegistration: (...a: unknown[]) => mockGetPending(...a),
    deletePendingRegistration: (...a: unknown[]) => mockDeletePending(...a),
  };
});

const mockComplete = vi.fn();
vi.mock('../../repository/registration-persistence', async () => {
  const actual = await vi.importActual<
    typeof import('../../repository/registration-persistence')
  >('../../repository/registration-persistence');
  return {
    ...actual, // keep the real TransientPersistenceError class
    completeOwnerProfile: (...a: unknown[]) => mockComplete(...a),
  };
});

const mockSend = vi.fn();
vi.mock('../../utils/cognito-client', () => ({
  getCognitoClient: () => ({ send: (...a: unknown[]) => mockSend(...a) }),
}));

// Import the real class so transient classification matches.
import { TransientPersistenceError } from '../../repository/registration-persistence';
import { pendingRegistrationPK } from '../../repository/pending-registration-repository';

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 10;

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return {
    PK: pendingRegistrationPK('reg-1'),
    SK: 'META',
    registrationId: 'reg-1',
    email: 'owner@example.com',
    fullName: 'Owner One',
    phone: '+27123456789',
    organisationName: 'Acme Trading',
    consentStatus: 'declined',
    consentChannels: [],
    consentTextVersion: 'draft-2026-10-11',
    createdAt: new Date().toISOString(),
    expiresAt: FUTURE,
    ...overrides,
  };
}

function cognitoUser(attrs: Record<string, string> = {}) {
  const merged = {
    sub: 'sub-1',
    email: 'owner@example.com',
    email_verified: 'true',
    'custom:tenantId': 'tenant-1',
    'custom:role': 'owner',
    ...attrs,
  };
  return {
    UserAttributes: Object.entries(merged).map(([Name, Value]) => ({ Name, Value })),
  };
}

function sqsEvent(body: unknown, messageId = 'm1') {
  return {
    Records: [
      {
        messageId,
        body: typeof body === 'string' ? body : JSON.stringify(body),
        receiptHandle: 'rh',
        attributes: {},
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:eu-west-1:123:merch-os-registration-reconciliation-dev',
        awsRegion: 'eu-west-1',
      },
    ],
  };
}

const validMessage = { schemaVersion: 1, registrationId: 'reg-1', cognitoUsername: 'user-1' };

describe('registration reconciliation worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['TENANTS_TABLE'] = 'merch-os-tenants-dev';
    process.env['COGNITO_USER_POOL_ID'] = 'eu-west-1_pool';
    mockGetPending.mockResolvedValue(pendingRecord());
    mockDeletePending.mockResolvedValue(undefined);
    mockSend.mockResolvedValue(cognitoUser());
    mockComplete.mockResolvedValue({ result: 'created' });
  });

  it('reconciles a valid message: persists via approved repo with Cognito identity, acknowledges, cleans up', async () => {
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);

    expect(res.batchItemFailures).toEqual([]); // acknowledged
    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [table, params] = mockComplete.mock.calls[0];
    expect(table).toBe('merch-os-tenants-dev');
    // identity/tenant/role from Cognito; business data from pending record
    expect(params).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'sub-1',
      email: 'owner@example.com',
      role: 'owner',
      fullName: 'Owner One',
      phone: '+27123456789',
      organisationName: 'Acme Trading',
      registrationId: 'reg-1',
      consentStatus: 'declined',
      consentChannels: [],
    });
    expect(mockDeletePending).toHaveBeenCalledWith('merch-os-tenants-dev', 'reg-1');
  });

  it('is idempotent on duplicate delivery (already_completed → success, no duplicate persist)', async () => {
    mockComplete.mockResolvedValue({ result: 'already_completed' });
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('retries (reports batch failure) on transient persistence error', async () => {
    mockComplete.mockRejectedValue(new TransientPersistenceError('throttled'));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });

  it('retries on transient Cognito throttling', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('slow down'), { name: 'TooManyRequestsException' }));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('acknowledges (terminal) when the pending record is missing — never persists', async () => {
    mockGetPending.mockResolvedValue(undefined);
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('acknowledges (terminal) when the pending record is expired — never persists', async () => {
    mockGetPending.mockResolvedValue(pendingRecord({ expiresAt: PAST }));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockDeletePending).toHaveBeenCalledWith('merch-os-tenants-dev', 'reg-1');
  });

  it('acknowledges (terminal) on identity mismatch (Cognito email ≠ pending email) — never persists', async () => {
    mockSend.mockResolvedValue(cognitoUser({ email: 'someone-else@example.com' }));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('acknowledges (terminal) for a non-owner account — never persists', async () => {
    mockSend.mockResolvedValue(cognitoUser({ 'custom:role': 'viewer' }));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('acknowledges (terminal) when Cognito email is not verified — never persists', async () => {
    mockSend.mockResolvedValue(cognitoUser({ email_verified: 'false' }));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('acknowledges (terminal) on durable-state conflict — never overwrites, cleans up pending', async () => {
    mockComplete.mockResolvedValue({ result: 'conflict', reason: 'different subject' });
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent(validMessage) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockDeletePending).toHaveBeenCalledWith('merch-os-tenants-dev', 'reg-1');
  });

  it('acknowledges (terminal) an invalid message (bad schema) without reading pending or persisting', async () => {
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent({ schemaVersion: 2, registrationId: 'reg-1' }) as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockGetPending).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('acknowledges (terminal) a non-JSON message body', async () => {
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const res = await handler(sqsEvent('{not-json') as never);
    expect(res.batchItemFailures).toEqual([]);
    expect(mockGetPending).not.toHaveBeenCalled();
  });

  it('passes consent channels only when the pending record granted consent', async () => {
    mockGetPending.mockResolvedValue(
      pendingRecord({ consentStatus: 'granted', consentChannels: ['email', 'sms'] }),
    );
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    await handler(sqsEvent(validMessage) as never);
    expect(mockComplete).toHaveBeenCalledWith(
      'merch-os-tenants-dev',
      expect.objectContaining({ consentStatus: 'granted', consentChannels: ['email', 'sms'] }),
    );
  });

  it('processes a batch independently: one transient failure is reported, the other acknowledged', async () => {
    // First message succeeds; second hits a transient persistence failure.
    mockComplete
      .mockResolvedValueOnce({ result: 'created' })
      .mockRejectedValueOnce(new TransientPersistenceError('throttled'));
    const { handler } = await import('../../workers/registration-reconciliation-worker');
    const event = {
      Records: [
        sqsEvent(validMessage, 'ok-1').Records[0],
        sqsEvent({ ...validMessage, cognitoUsername: 'user-2' }, 'retry-2').Records[0],
      ],
    };
    const res = await handler(event as never);
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'retry-2' }]);
  });
});
