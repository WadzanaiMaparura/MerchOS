/**
 * TenantContext extraction tests.
 *
 * Verifies:
 * - custom:tenantId from JWT authorizer → TenantContext.tenantId
 * - sub from JWT authorizer → TenantContext.userId
 * - Missing tenant claim → null (handler returns 401)
 * - Client-supplied tenantId in body/query never overrides trusted context
 * - ProductService remains Cognito-agnostic (receives only tenantId string)
 */

import { describe, it, expect } from 'vitest';
import { extractTenantContext, TenantContext } from '../tenant-context';

describe('extractTenantContext', () => {
  // =========================================================================
  // Pattern 1: tenantContextMiddleware output
  // =========================================================================

  describe('Pattern 1 — tenantContextMiddleware output', () => {
    it('extracts tenantId and userId from authorizer.tenantContext', () => {
      const event = {
        requestContext: {
          authorizer: {
            tenantContext: { tenantId: 'tenant-abc', userId: 'user-123' },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toEqual({ tenantId: 'tenant-abc', userId: 'user-123' });
    });

    it('extracts tenantId when userId is not present', () => {
      const event = {
        requestContext: {
          authorizer: {
            tenantContext: { tenantId: 'tenant-abc' },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toEqual({ tenantId: 'tenant-abc', userId: undefined });
    });
  });

  // =========================================================================
  // Pattern 2: API Gateway JWT authorizer (Cognito user pool)
  // =========================================================================

  describe('Pattern 2 — API Gateway JWT authorizer (Cognito)', () => {
    it('extracts tenantId from jwt.claims[custom:tenantId] and userId from sub', () => {
      const event = {
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'custom:tenantId': 'tenant-jwt-001',
                'sub': 'cognito-user-uuid',
                'cognito:groups': '["Seller"]',
              },
            },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toEqual({ tenantId: 'tenant-jwt-001', userId: 'cognito-user-uuid' });
    });

    it('returns null when jwt.claims has no custom:tenantId', () => {
      const event = {
        requestContext: {
          authorizer: {
            jwt: {
              claims: {
                'sub': 'user-without-tenant',
                'email': 'user@example.com',
              },
            },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Pattern 3: Lambda authorizer
  // =========================================================================

  describe('Pattern 3 — Lambda authorizer', () => {
    it('extracts tenantId from lambda[custom:tenantId] and userId from sub', () => {
      const event = {
        requestContext: {
          authorizer: {
            lambda: {
              'custom:tenantId': 'tenant-lambda-002',
              'sub': 'lambda-user-uuid',
            },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toEqual({ tenantId: 'tenant-lambda-002', userId: 'lambda-user-uuid' });
    });

    it('returns null when lambda context has no custom:tenantId', () => {
      const event = {
        requestContext: {
          authorizer: {
            lambda: { someOtherField: 'value' },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Missing / invalid context
  // =========================================================================

  describe('missing or invalid context', () => {
    it('returns null when requestContext is missing', () => {
      const result = extractTenantContext({});
      expect(result).toBeNull();
    });

    it('returns null when authorizer is missing', () => {
      const event = { requestContext: {} };
      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });

    it('returns null when authorizer is empty object', () => {
      const event = { requestContext: { authorizer: {} } };
      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });

    it('returns null when tenantContext exists but tenantId is missing', () => {
      const event = {
        requestContext: {
          authorizer: { tenantContext: { userId: 'user-only' } },
        },
      };
      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Client-supplied tenantId is NEVER used
  // =========================================================================

  describe('client-supplied tenantId is never used', () => {
    it('does not read tenantId from request body', () => {
      const event = {
        requestContext: { authorizer: {} }, // No tenant claim
        body: JSON.stringify({ tenantId: 'attacker-tenant' }),
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull(); // Must NOT return 'attacker-tenant'
    });

    it('does not read tenantId from query parameters', () => {
      const event = {
        requestContext: { authorizer: {} },
        queryStringParameters: { tenantId: 'attacker-tenant' },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });

    it('does not read tenantId from path parameters', () => {
      const event = {
        requestContext: { authorizer: {} },
        pathParameters: { tenantId: 'attacker-tenant' },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });

    it('trusted JWT claim prevails even when body contains different tenantId', () => {
      const event = {
        requestContext: {
          authorizer: {
            jwt: { claims: { 'custom:tenantId': 'trusted-tenant', 'sub': 'user-1' } },
          },
        },
        body: JSON.stringify({ tenantId: 'attacker-tenant' }),
      };

      const result = extractTenantContext(event);
      expect(result!.tenantId).toBe('trusted-tenant');
    });
  });

  // =========================================================================
  // Priority: tenantContextMiddleware > JWT > Lambda
  // =========================================================================

  describe('pattern priority', () => {
    it('prefers tenantContext pattern over JWT pattern', () => {
      const event = {
        requestContext: {
          authorizer: {
            tenantContext: { tenantId: 'middleware-tenant', userId: 'mw-user' },
            jwt: { claims: { 'custom:tenantId': 'jwt-tenant', 'sub': 'jwt-user' } },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result!.tenantId).toBe('middleware-tenant');
    });
  });
});
