/**
 * TenantContext extraction tests for the Product API.
 *
 * The Product API's extractTenantContext reads ONLY the resolved context
 * from event.requestContext.authorizer.tenantContext — the output of the
 * shared tenantContextMiddleware.
 *
 * It does NOT independently resolve from JWT/Lambda claims.
 * It does NOT accept client-supplied tenantId from body/query/path.
 * It does NOT invent a "platform" or default tenant.
 */

import { describe, it, expect } from 'vitest';
import { extractTenantContext } from '../tenant-context';

describe('extractTenantContext (Product API)', () => {
  // =========================================================================
  // Valid resolved context
  // =========================================================================

  describe('valid tenant context from shared middleware', () => {
    it('extracts tenantId and userId from authorizer.tenantContext', () => {
      const event = {
        requestContext: {
          authorizer: {
            tenantContext: { tenantId: 'tenant-A', userId: 'user-123' },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toEqual({ tenantId: 'tenant-A', userId: 'user-123' });
    });

    it('extracts tenantId when userId is not present', () => {
      const event = {
        requestContext: {
          authorizer: {
            tenantContext: { tenantId: 'tenant-B' },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toEqual({ tenantId: 'tenant-B', userId: undefined });
    });
  });

  // =========================================================================
  // Missing tenant claim → rejected
  // =========================================================================

  describe('missing tenant claim → null (handler returns 401)', () => {
    it('returns null when requestContext is missing', () => {
      expect(extractTenantContext({})).toBeNull();
    });

    it('returns null when authorizer is missing', () => {
      expect(extractTenantContext({ requestContext: {} })).toBeNull();
    });

    it('returns null when authorizer is empty', () => {
      expect(extractTenantContext({ requestContext: { authorizer: {} } })).toBeNull();
    });

    it('returns null when tenantContext exists but tenantId is missing', () => {
      const event = {
        requestContext: {
          authorizer: { tenantContext: { userId: 'user-only' } },
        },
      };
      expect(extractTenantContext(event)).toBeNull();
    });

    it('returns null when tenantContext.tenantId is empty string', () => {
      const event = {
        requestContext: {
          authorizer: { tenantContext: { tenantId: '' } },
        },
      };
      // Empty string is falsy — treated as missing
      expect(extractTenantContext(event)).toBeNull();
    });
  });

  // =========================================================================
  // Client-supplied tenantId NEVER used
  // =========================================================================

  describe('client-supplied tenantId is never used', () => {
    it('does not read tenantId from request body', () => {
      const event = {
        requestContext: { authorizer: {} },
        body: JSON.stringify({ tenantId: 'attacker-tenant' }),
      };
      expect(extractTenantContext(event)).toBeNull();
    });

    it('does not read tenantId from query parameters', () => {
      const event = {
        requestContext: { authorizer: {} },
        queryStringParameters: { tenantId: 'attacker-tenant' },
      };
      expect(extractTenantContext(event)).toBeNull();
    });

    it('does not read tenantId from path parameters', () => {
      const event = {
        requestContext: { authorizer: {} },
        pathParameters: { tenantId: 'attacker-tenant' },
      };
      expect(extractTenantContext(event)).toBeNull();
    });

    it('trusted context prevails when body contains different tenantId', () => {
      const event = {
        requestContext: {
          authorizer: {
            tenantContext: { tenantId: 'trusted-tenant', userId: 'user-1' },
          },
        },
        body: JSON.stringify({ tenantId: 'attacker-tenant' }),
      };

      const result = extractTenantContext(event);
      expect(result!.tenantId).toBe('trusted-tenant');
    });
  });

  // =========================================================================
  // No "platform" fake tenant
  // =========================================================================

  describe('no platform/fake tenant fallback', () => {
    it('does NOT produce tenantId="platform" when claim is missing', () => {
      const event = {
        requestContext: {
          authorizer: {
            rbac: { role: 'Admin' },
            // No tenantContext attached — admin without specific tenant
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
      // Must NOT be { tenantId: 'platform' }
    });

    it('does NOT invent a default tenant', () => {
      const event = {
        requestContext: {
          authorizer: { tenantContext: {} },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Does not resolve from JWT/Lambda directly (that's the shared middleware's job)
  // =========================================================================

  describe('does not independently resolve from JWT/Lambda claims', () => {
    it('returns null when only JWT claims exist (no tenantContext attached)', () => {
      const event = {
        requestContext: {
          authorizer: {
            jwt: { claims: { 'custom:tenantId': 'jwt-tenant', sub: 'user-1' } },
          },
        },
      };

      // The Product API reads ONLY from tenantContext — NOT from jwt.claims
      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });

    it('returns null when only Lambda authorizer claims exist (no tenantContext attached)', () => {
      const event = {
        requestContext: {
          authorizer: {
            lambda: { 'custom:tenantId': 'lambda-tenant', sub: 'user-2' },
          },
        },
      };

      const result = extractTenantContext(event);
      expect(result).toBeNull();
    });
  });
});
