import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// Mock powertools logger to avoid dependency resolution issues in test environment
vi.mock('../powertools', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { inputValidationMiddleware } from '../input-validation';

// Simple test schema used across all tests
const testSchema = z.object({ email: z.string().email(), name: z.string().min(1) });

/**
 * Helper to build a fake middy request object.
 */
const createRequest = (event: any) => ({
  event,
  response: null,
  error: null,
  context: {} as any,
  internal: {},
});

describe('inputValidationMiddleware', () => {
  describe('body source (default)', () => {
    let middleware: ReturnType<typeof inputValidationMiddleware>;

    beforeEach(() => {
      middleware = inputValidationMiddleware({ schema: testSchema });
    });

    it('validates and parses JSON string body successfully (replaces event.body)', async () => {
      const request = createRequest({
        body: JSON.stringify({ email: 'user@example.com', name: 'Alice' }),
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      expect(request.event.body).toEqual({ email: 'user@example.com', name: 'Alice' });
    });

    it('returns 400 when body is invalid JSON string', async () => {
      const request = createRequest({
        body: 'not valid json {{{',
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(400);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Request body is not valid JSON');
      expect(body.error.details).toEqual([]);
    });

    it('returns 400 when body fails zod validation (includes details array)', async () => {
      const request = createRequest({
        body: JSON.stringify({ email: 'not-an-email', name: '' }),
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(400);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Input validation failed');
      expect(body.error.details).toBeInstanceOf(Array);
      expect(body.error.details.length).toBeGreaterThan(0);
      // Both email and name should fail
      const paths = body.error.details.map((d: any) => d.path[0]);
      expect(paths).toContain('email');
      expect(paths).toContain('name');
    });

    it('validates pre-parsed object body (already parsed, not string)', async () => {
      const request = createRequest({
        body: { email: 'bob@test.io', name: 'Bob' },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      expect(request.event.body).toEqual({ email: 'bob@test.io', name: 'Bob' });
    });

    it('returns 400 when body is null and schema requires fields', async () => {
      const request = createRequest({
        body: null,
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(400);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Input validation failed');
      expect(body.error.details.length).toBeGreaterThan(0);
    });

    it('returns 400 when body is undefined and schema requires fields', async () => {
      const request = createRequest({});

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(400);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details.length).toBeGreaterThan(0);
    });

    it('handles optional fields correctly (passes with partial data)', async () => {
      const optionalSchema = z.object({
        email: z.string().email(),
        name: z.string().min(1),
        nickname: z.string().optional(),
      });
      const mw = inputValidationMiddleware({ schema: optionalSchema });

      const request = createRequest({
        body: JSON.stringify({ email: 'a@b.com', name: 'Test' }),
      });

      const result = await mw.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      expect(request.event.body).toEqual({ email: 'a@b.com', name: 'Test' });
    });
  });

  describe('queryStringParameters source', () => {
    let middleware: ReturnType<typeof inputValidationMiddleware>;

    const querySchema = z.object({
      limit: z.string().regex(/^\d+$/),
      page: z.string().regex(/^\d+$/).optional(),
    });

    beforeEach(() => {
      middleware = inputValidationMiddleware({ schema: querySchema, source: 'queryStringParameters' });
    });

    it('validates queryStringParameters when source is queryStringParameters', async () => {
      const request = createRequest({
        queryStringParameters: { limit: '10', page: '2' },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      expect(request.event.queryStringParameters).toEqual({ limit: '10', page: '2' });
    });

    it('returns 400 when queryStringParameters fail validation', async () => {
      const request = createRequest({
        queryStringParameters: { limit: 'abc' },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(400);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toBe('Input validation failed');
      expect(body.error.details.length).toBeGreaterThan(0);
    });
  });
});
