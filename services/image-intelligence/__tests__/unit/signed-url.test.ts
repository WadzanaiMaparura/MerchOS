/**
 * Unit tests for the signed-url handler.
 *
 * We validate the request-guard logic (tenant required, channel validation,
 * config required) without invoking real CloudFront signing. The signing path
 * itself is covered by an integration/dev checkpoint since it needs a real key.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the shared powertools logger to avoid importing the native commons pkg.
vi.mock('../../../shared/middleware/powertools', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), appendKeys: vi.fn() },
}));

import { baseHandler } from '../../handlers/signed-url';

type Resp = { statusCode: number; body: string };

/** Build a minimal event with the tenant context the middleware would attach. */
function makeEvent(
  tenantId: string | undefined,
  pathParameters: { imageId?: string; channel?: string },
): Record<string, unknown> {
  return {
    requestContext: {
      authorizer: tenantId ? { tenantContext: { tenantId } } : {},
      http: { method: 'GET' },
    },
    pathParameters,
  };
}

// Unit-test the inner base handler directly (middleware is shared + tested
// separately; here we verify this handler's own request-guard logic).
async function invoke(event: Record<string, unknown>): Promise<Resp> {
  return (await (baseHandler as unknown as (e: unknown) => Promise<Resp>)(event)) as Resp;
}

describe('signed-url handler', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env['CLOUDFRONT_DOMAIN'] = 'd123.cloudfront.net';
    process.env['CLOUDFRONT_KEY_PAIR_ID'] = 'K123';
    process.env['CLOUDFRONT_PRIVATE_KEY_SECRET_ID'] = 'arn:secret';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('returns 401 when tenant context is missing', async () => {
    const res = await invoke(makeEvent(undefined, { imageId: 'img1', channel: 'amazon' }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe('MISSING_TENANT');
  });

  it('returns 400 for an unsupported channel', async () => {
    const res = await invoke(makeEvent('t1', { imageId: 'img1', channel: 'ebay' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when imageId or channel is missing', async () => {
    const res = await invoke(makeEvent('t1', { channel: 'amazon' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when signing configuration is absent', async () => {
    delete process.env['CLOUDFRONT_DOMAIN'];
    const res = await invoke(makeEvent('t1', { imageId: 'img1', channel: 'amazon' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe('INTERNAL_ERROR');
  });
});
