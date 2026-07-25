import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock powertools logger to avoid dependency resolution issues in test environment
vi.mock('../powertools', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { tenantContextMiddleware } from '../tenant-context';

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

describe('tenantContextMiddleware', () => {
  let middleware: ReturnType<typeof tenantContextMiddleware>;

  beforeEach(() => {
    middleware = tenantContextMiddleware();
  });

  describe('tenant extraction from JWT claims', () => {
    it('extracts tenantId from JWT authorizer claims and attaches to tenantContext', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-123',
              },
            },
          },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const tenantContext = (request.event as any).requestContext.authorizer.tenantContext;
      expect(tenantContext).toBeDefined();
      expect(tenantContext.tenantId).toBe('tenant-123');
    });

    it('extracts tenantId from Lambda authorizer and attaches to tenantContext', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            lambda: {
              'custom:tenantId': 'tenant-456',
            },
          },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const tenantContext = (request.event as any).requestContext.authorizer.tenantContext;
      expect(tenantContext).toBeDefined();
      expect(tenantContext.tenantId).toBe('tenant-456');
    });
  });

  describe('missing tenantId (401)', () => {
    it('returns 401 when tenantId is missing from claims (non-platform role)', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                // no custom:tenantId
              },
            },
          },
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(401);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('MISSING_TENANT');
      expect(body.error.message).toBe('Tenant context required');
    });
  });

  describe('cross-tenant validation (403)', () => {
    it('returns 403 when request body tenantId does not match JWT tenantId', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-123',
              },
            },
          },
        },
        body: JSON.stringify({ tenantId: 'tenant-other' }),
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(403);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('TENANT_MISMATCH');
      expect(body.error.message).toBe('Cross-tenant access denied');
    });

    it('returns 403 when path param tenantId does not match JWT tenantId', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-123',
              },
            },
          },
        },
        pathParameters: {
          tenantId: 'tenant-different',
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(403);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('TENANT_MISMATCH');
    });
  });

  describe('platform role bypass', () => {
    it('allows Admin role to bypass tenant validation', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-123',
              },
            },
            rbac: {
              role: 'Admin',
            },
          },
        },
        pathParameters: {
          tenantId: 'tenant-other',
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      // No short-circuit means access was granted
      expect(result).toBeUndefined();
      const tenantContext = (request.event as any).requestContext.authorizer.tenantContext;
      expect(tenantContext).toBeDefined();
      expect(tenantContext.tenantId).toBe('tenant-123');
    });

    it('allows Support role to bypass tenant validation', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            lambda: {
              'custom:tenantId': 'tenant-789',
            },
            rbac: {
              role: 'Support',
            },
          },
        },
        pathParameters: {
          tenantId: 'tenant-other',
        },
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const tenantContext = (request.event as any).requestContext.authorizer.tenantContext;
      expect(tenantContext).toBeDefined();
      expect(tenantContext.tenantId).toBe('tenant-789');
    });
  });

  describe('successful tenant validation', () => {
    it('passes when request tenantId matches JWT tenantId', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-123',
              },
            },
          },
        },
        body: JSON.stringify({ tenantId: 'tenant-123' }),
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const tenantContext = (request.event as any).requestContext.authorizer.tenantContext;
      expect(tenantContext).toBeDefined();
      expect(tenantContext.tenantId).toBe('tenant-123');
    });

    it('passes when no tenantId in request body/params (just uses JWT tenantId)', async () => {
      const request = createRequest({
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-555',
              },
            },
          },
        },
        body: JSON.stringify({ name: 'some product' }),
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const tenantContext = (request.event as any).requestContext.authorizer.tenantContext;
      expect(tenantContext).toBeDefined();
      expect(tenantContext.tenantId).toBe('tenant-555');
    });
  });
});
