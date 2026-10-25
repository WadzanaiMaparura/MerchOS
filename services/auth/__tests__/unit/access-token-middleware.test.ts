import { describe, it, expect, vi, beforeEach } from 'vitest';

// The middleware logs via the shared powertools logger; mock it to a no-op so
// the unit test is isolated and asserts no PII (email) is ever logged.
vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  tracer: { captureAWSv3Client: vi.fn((c: unknown) => c) },
  metrics: { addMetric: vi.fn(), publishStoredMetrics: vi.fn() },
}));

import { accessTokenMiddleware } from '../../../shared/middleware/access-token';
import { logger } from '../../../shared/middleware/powertools';

type MiddyRequest = {
  event: Record<string, unknown>;
  response: unknown;
};

/** Build a minimal middy-style request with the given authorizer JWT claims. */
function buildRequest(claims: Record<string, unknown> | null | undefined): MiddyRequest {
  return {
    event: {
      requestContext: {
        authorizer: claims === undefined ? undefined : { jwt: { claims } },
      },
    },
    response: undefined,
  };
}

/** Invoke the middleware's `before` hook against a request. */
async function runBefore(request: MiddyRequest): Promise<unknown> {
  const mw = accessTokenMiddleware();
  // middy MiddlewareObj.before(request) — cast through unknown for the test shim.
  return (mw.before as unknown as (r: MiddyRequest) => Promise<unknown>)(request);
}

function parse(response: unknown) {
  const r = response as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
}

describe('accessTokenMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through when token_use is "access" (no response set)', async () => {
    const request = buildRequest({
      token_use: 'access',
      sub: 's1',
      email: 'user@example.com',
    });

    const result = await runBefore(request);

    // No short-circuit: before() returns undefined and leaves response unset.
    expect(result).toBeUndefined();
    expect(request.response).toBeUndefined();
  });

  it('rejects an ID token (token_use "id") with 401 and short-circuits', async () => {
    const request = buildRequest({ token_use: 'id', sub: 's1', email: 'user@example.com' });

    const result = await runBefore(request);

    const { statusCode, body } = parse(result);
    expect(statusCode).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('No valid session found');
    // The short-circuit response is also assigned to request.response.
    expect(request.response).toBe(result);
  });

  it('rejects when token_use is absent', async () => {
    const request = buildRequest({ sub: 's1', email: 'user@example.com' });

    const result = await runBefore(request);

    expect(parse(result).statusCode).toBe(401);
    expect(request.response).toBe(result);
  });

  it('rejects any other token_use value (e.g. "refresh")', async () => {
    const request = buildRequest({ token_use: 'refresh', sub: 's1' });

    const result = await runBefore(request);

    expect(parse(result).statusCode).toBe(401);
  });

  it('rejects when there is no authorizer/claims context at all', async () => {
    const request = buildRequest(undefined);

    const result = await runBefore(request);

    expect(parse(result).statusCode).toBe(401);
  });

  it('never logs the email address (no PII), only the token_use enum', async () => {
    const request = buildRequest({ token_use: 'id', sub: 's1', email: 'secret@example.com' });

    await runBefore(request);

    const warn = vi.mocked(logger.warn);
    expect(warn).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(warn.mock.calls);
    expect(serialized).not.toContain('secret@example.com');
    expect(serialized).toContain('id'); // tokenUse enum is recorded
  });
});
