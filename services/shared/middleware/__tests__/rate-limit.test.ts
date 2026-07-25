import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

// Mock powertools logger
vi.mock('../powertools', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { rateLimitMiddleware, _resetClientForTesting } from '../rate-limit';
import { logger } from '../powertools';

const ddbMock = mockClient(DynamoDBDocumentClient);

/**
 * Helper to build a fake middy request object.
 */
function createRequest(event: Record<string, unknown>) {
  return {
    event,
    response: null,
    error: null,
    context: {} as any,
    internal: {},
  };
}

describe('rateLimitMiddleware', () => {
  beforeEach(() => {
    ddbMock.reset();
    _resetClientForTesting();
    process.env['RATE_LIMITS_TABLE'] = 'test-rate-limits';
  });

  afterEach(() => {
    delete process.env['RATE_LIMITS_TABLE'];
  });

  describe('rate limiting disabled', () => {
    it('passes when RATE_LIMITS_TABLE env is not set and logs a warning', async () => {
      delete process.env['RATE_LIMITS_TABLE'];
      const middleware = rateLimitMiddleware();
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        'RATE_LIMITS_TABLE not set — rate limiting disabled',
      );
    });
  });

  describe('allows requests under the limit', () => {
    it('allows request when counter is below maxRequests', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 5 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 100 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      expect(request.response).toBeNull();
    });
  });

  describe('rate limit exceeded (429)', () => {
    it('returns 429 when counter exceeds maxRequests', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 101 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 100 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(429);
    });

    it('429 response includes Retry-After header', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 101 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 100, windowSeconds: 60 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).headers['Retry-After']).toBeDefined();
      // Retry-After should be a string representing seconds
      const retryAfter = parseInt((result as any).headers['Retry-After'], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });

    it('429 response body has RATE_LIMIT_EXCEEDED error code and retryAfter field', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 150 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 100, windowSeconds: 60 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(body.retryAfter).toBeDefined();
      expect(typeof body.retryAfter).toBe('number');
      expect(body.retryAfter).toBeGreaterThan(0);
    });
  });

  describe('identifier extraction', () => {
    it('uses userId from JWT authorizer claims by default', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 1 },
      });

      const middleware = rateLimitMiddleware();
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-abc-123' } },
          },
          http: { sourceIp: '10.0.0.1' },
        },
      });

      await middleware.before!(request as any, {} as any);

      // Verify the DynamoDB call used USER# prefix with the sub claim
      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls.length).toBe(1);
      const input = calls[0].args[0].input;
      expect(input.Key!.PK).toBe('USER#user-abc-123');
    });

    it('falls back to source IP when no userId available', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 1 },
      });

      const middleware = rateLimitMiddleware();
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: {} }, // no sub claim
          },
          http: { sourceIp: '192.168.1.100' },
        },
      });

      await middleware.before!(request as any, {} as any);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls.length).toBe(1);
      const input = calls[0].args[0].input;
      expect(input.Key!.PK).toBe('IP#192.168.1.100');
    });

    it('uses custom identifierFn when provided', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 1 },
      });

      const customFn = (event: Record<string, unknown>) => {
        return `CUSTOM#my-key`;
      };

      const middleware = rateLimitMiddleware({ identifierFn: customFn });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      await middleware.before!(request as any, {} as any);

      const calls = ddbMock.commandCalls(UpdateCommand);
      expect(calls.length).toBe(1);
      const input = calls[0].args[0].input;
      expect(input.Key!.PK).toBe('CUSTOM#my-key');
    });
  });

  describe('DynamoDB failure (fail open)', () => {
    it('fails open and allows request when DynamoDB is unavailable', async () => {
      ddbMock.on(UpdateCommand).rejects(new Error('Service Unavailable'));

      const middleware = rateLimitMiddleware();
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      // Should allow the request (fail open)
      expect(result).toBeUndefined();
      expect(request.response).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Rate limit counter increment failed — allowing request',
        expect.objectContaining({
          error: 'Service Unavailable',
          identifier: 'USER#user-1',
        }),
      );
    });
  });

  describe('custom options', () => {
    it('supports custom maxRequests option', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 11 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 10 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      // count=11 > maxRequests=10, should be rate limited
      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(429);
    });

    it('supports custom windowSeconds option', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 6 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 5, windowSeconds: 120 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(429);
      const body = JSON.parse((result as any).body);
      // retryAfter should be <= windowSeconds
      expect(body.retryAfter).toBeLessThanOrEqual(120);
    });

    it('allows request at exactly maxRequests (limit is exclusive)', async () => {
      ddbMock.on(UpdateCommand).resolves({
        Attributes: { count: 100 },
      });

      const middleware = rateLimitMiddleware({ maxRequests: 100 });
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: { claims: { sub: 'user-1' } },
          },
          http: { sourceIp: '1.2.3.4' },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      // count=100 is NOT > maxRequests=100, should be allowed
      expect(result).toBeUndefined();
    });
  });
});
