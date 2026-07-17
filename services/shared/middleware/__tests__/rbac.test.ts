import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock powertools logger to avoid dependency resolution issues in test environment
vi.mock('../powertools', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// Set env before module loads (lazy init will pick this up on first call)
process.env['COGNITO_ISSUER'] = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test';

import { rbacMiddleware, _resetForTesting } from '../rbac';
import type { EndpointPermission } from '../rbac';

// Ensure the authorize function is freshly initialized with test env vars
beforeAll(() => {
  _resetForTesting();
});

/**
 * Helper to build a fake middy request object simulating API Gateway event structure.
 */
function buildRequest(lambdaClaims: Record<string, unknown> | null) {
  const event: Record<string, unknown> = {
    requestContext: {
      authorizer: lambdaClaims !== null ? { lambda: lambdaClaims } : {},
    },
  };
  return { event, response: undefined as unknown };
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
}

function pastExp(): number {
  return Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
}

const ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_test';

describe('rbacMiddleware', () => {
  const endpoint: EndpointPermission = { resource: 'products', action: 'read' };

  describe('authentication failures (401)', () => {
    it('returns 401 when no authorizer lambda context exists', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = { event: { requestContext: { authorizer: {} } }, response: undefined as unknown };

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(401);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('MISSING_TOKEN');
    });

    it('returns 401 when JWT is expired', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = buildRequest({
        sub: 'user-123',
        iss: ISSUER,
        exp: pastExp(),
        'cognito:groups': ['Seller'],
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(401);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('TOKEN_EXPIRED');
    });

    it('returns 401 when issuer does not match', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = buildRequest({
        sub: 'user-123',
        iss: 'https://wrong-issuer.example.com',
        exp: futureExp(),
        'cognito:groups': ['Seller'],
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(401);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('INVALID_ISSUER');
    });
  });

  describe('authorization failures (403)', () => {
    it('returns 403 when cognito:groups is missing', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = buildRequest({
        sub: 'user-123',
        iss: ISSUER,
        exp: futureExp(),
        // no cognito:groups
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(403);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('MISSING_GROUP');
    });

    it('returns 403 when role lacks required permission', async () => {
      const middleware = rbacMiddleware({ resource: 'platform-settings', action: 'update' });
      const request = buildRequest({
        sub: 'user-123',
        iss: ISSUER,
        exp: futureExp(),
        'cognito:groups': ['Seller'],
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(403);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('returns 403 when cognito:groups contains only unrecognized roles', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = buildRequest({
        sub: 'user-123',
        iss: ISSUER,
        exp: futureExp(),
        'cognito:groups': ['UnknownRole'],
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeDefined();
      expect((result as any).statusCode).toBe(403);
      const body = JSON.parse((result as any).body);
      expect(body.error.code).toBe('UNRECOGNIZED_ROLE');
    });
  });

  describe('successful authorization', () => {
    it('grants access for Seller reading products', async () => {
      const middleware = rbacMiddleware({ resource: 'products', action: 'read' });
      const request = buildRequest({
        sub: 'user-seller-1',
        iss: ISSUER,
        exp: futureExp(),
        'cognito:groups': ['Seller'],
        'custom:tenantId': 'tenant-abc',
      });

      const result = await middleware.before!(request as any, {} as any);

      // No short-circuit return means access was granted
      expect(result).toBeUndefined();

      // Check AuthorizationContext was attached
      const rbacCtx = (request.event as any).requestContext.authorizer.rbac;
      expect(rbacCtx).toBeDefined();
      expect(rbacCtx.role).toBe('Seller');
      expect(rbacCtx.userId).toBe('user-seller-1');
      expect(rbacCtx.tenantId).toBe('tenant-abc');
    });

    it('grants access for Admin to platform-settings', async () => {
      const middleware = rbacMiddleware({ resource: 'platform-settings', action: 'update' });
      const request = buildRequest({
        sub: 'admin-user-1',
        iss: ISSUER,
        exp: futureExp(),
        'cognito:groups': ['Admin'],
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const rbacCtx = (request.event as any).requestContext.authorizer.rbac;
      expect(rbacCtx.role).toBe('Admin');
      expect(rbacCtx.userId).toBe('admin-user-1');
    });

    it('resolves highest priority role when multiple groups present', async () => {
      const middleware = rbacMiddleware({ resource: 'users.search', action: 'read' });
      const request = buildRequest({
        sub: 'user-multi',
        iss: ISSUER,
        exp: futureExp(),
        'cognito:groups': ['Seller', 'Support', 'Admin'],
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const rbacCtx = (request.event as any).requestContext.authorizer.rbac;
      expect(rbacCtx.role).toBe('Admin');
    });

    it('handles cognito:groups as JSON-encoded string', async () => {
      const middleware = rbacMiddleware({ resource: 'products', action: 'create' });
      const request = buildRequest({
        sub: 'user-seller-2',
        iss: ISSUER,
        exp: futureExp(),
        'cognito:groups': JSON.stringify(['Seller']),
        'custom:tenantId': 'tenant-xyz',
      });

      const result = await middleware.before!(request as any, {} as any);

      expect(result).toBeUndefined();
      const rbacCtx = (request.event as any).requestContext.authorizer.rbac;
      expect(rbacCtx.role).toBe('Seller');
    });
  });

  describe('error response format (AuthErrorResponse)', () => {
    it('returns structured JSON body with error.code and error.message', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = buildRequest(null);

      const result = await middleware.before!(request as any, {} as any);

      const body = JSON.parse((result as any).body);
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(typeof body.error.code).toBe('string');
      expect(typeof body.error.message).toBe('string');
    });

    it('includes Content-Type header', async () => {
      const middleware = rbacMiddleware(endpoint);
      const request = buildRequest(null);

      const result = await middleware.before!(request as any, {} as any);

      expect((result as any).headers['Content-Type']).toBe('application/json');
    });
  });
});
