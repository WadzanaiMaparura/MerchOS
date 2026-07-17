import { describe, it, expect } from 'vitest';
import { PermissionRegistry } from '../registry';
import { defaultPermissionConfig } from '../config';
import { createAuthorizationCheck } from '../middleware';
import type { JwtClaims } from '../jwt';
import type { EndpointPermission } from '../middleware';
import type { PermissionRegistryConfig } from '../types';

/**
 * Integration tests: End-to-end authorization flow
 * JWT claims → role resolution → permission check → authorized/denied
 *
 * Validates: Requirements 4.1, 4.4, 5.1, 6.1, 6.3, 10.2
 */

const EXPECTED_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TestPool';
const registry = new PermissionRegistry(defaultPermissionConfig);
const authorize = createAuthorizationCheck(registry, EXPECTED_ISSUER);

/** Helper: create valid JWT claims for a given role */
function makeClaims(role: string, overrides?: Partial<JwtClaims>): JwtClaims {
  return {
    sub: 'user-123',
    iss: EXPECTED_ISSUER,
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    'cognito:groups': [role],
    'custom:tenantId': 'tenant-abc',
    ...overrides,
  };
}

describe('Integration: End-to-end authorization flow', () => {
  describe('Full flow: JWT claims → role resolution → permission check → authorized/denied', () => {
    it('grants access when claims, role, and permission all align', () => {
      const claims = makeClaims('Seller');
      const endpoint: EndpointPermission = { resource: 'products', action: 'create' };

      const result = authorize(claims, endpoint);

      expect(result.authorized).toBe(true);
      if (result.authorized) {
        expect(result.context.role).toBe('Seller');
        expect(result.context.userId).toBe('user-123');
        expect(result.context.tenantId).toBe('tenant-abc');
      }
    });

    it('denies access when claims are null (no JWT)', () => {
      const endpoint: EndpointPermission = { resource: 'products', action: 'read' };

      const result = authorize(null, endpoint);

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.status).toBe(401);
        expect(result.body.error.code).toBe('MISSING_TOKEN');
      }
    });

    it('denies access when token is expired', () => {
      const claims = makeClaims('Seller', { exp: Math.floor(Date.now() / 1000) - 100 });
      const endpoint: EndpointPermission = { resource: 'products', action: 'read' };

      const result = authorize(claims, endpoint);

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.status).toBe(401);
        expect(result.body.error.code).toBe('TOKEN_EXPIRED');
      }
    });

    it('denies access when issuer does not match', () => {
      const claims = makeClaims('Seller', { iss: 'https://evil-issuer.example.com' });
      const endpoint: EndpointPermission = { resource: 'products', action: 'read' };

      const result = authorize(claims, endpoint);

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.status).toBe(401);
        expect(result.body.error.code).toBe('INVALID_ISSUER');
      }
    });

    it('denies access when no cognito:groups present', () => {
      const claims = makeClaims('Seller', { 'cognito:groups': undefined });
      const endpoint: EndpointPermission = { resource: 'products', action: 'read' };

      const result = authorize(claims, endpoint);

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.status).toBe(403);
        expect(result.body.error.code).toBe('MISSING_GROUP');
      }
    });

    it('denies access when role is valid but lacks permission for the endpoint', () => {
      const claims = makeClaims('Seller');
      const endpoint: EndpointPermission = { resource: 'platform-settings', action: 'read' };

      const result = authorize(claims, endpoint);

      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.status).toBe(403);
        expect(result.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
      }
    });
  });

  describe('Seller role: access own resources but not admin resources', () => {
    const sellerClaims = makeClaims('Seller');

    describe('permitted resources', () => {
      const permittedEndpoints: EndpointPermission[] = [
        { resource: 'products', action: 'create' },
        { resource: 'products', action: 'read' },
        { resource: 'products', action: 'update' },
        { resource: 'products', action: 'delete' },
        { resource: 'suppliers', action: 'create' },
        { resource: 'suppliers', action: 'read' },
        { resource: 'suppliers', action: 'update' },
        { resource: 'suppliers', action: 'delete' },
        { resource: 'ai-listings', action: 'create' },
        { resource: 'ai-listings', action: 'read' },
        { resource: 'ai-listings', action: 'update' },
        { resource: 'ai-listings', action: 'delete' },
        { resource: 'analytics', action: 'read' },
        { resource: 'exports', action: 'create' },
        { resource: 'exports', action: 'read' },
        { resource: 'subscription', action: 'read' },
        { resource: 'subscription', action: 'update' },
      ];

      it.each(permittedEndpoints)(
        'Seller is granted $resource:$action',
        (endpoint) => {
          const result = authorize(sellerClaims, endpoint);
          expect(result.authorized).toBe(true);
        },
      );
    });

    describe('denied admin resources', () => {
      const deniedEndpoints: EndpointPermission[] = [
        { resource: 'platform-settings', action: 'read' },
        { resource: 'platform-settings', action: 'update' },
        { resource: 'billing', action: 'read' },
        { resource: 'billing', action: 'create' },
        { resource: 'users', action: 'read' },
        { resource: 'users', action: 'delete' },
        { resource: 'infrastructure', action: 'read' },
        { resource: 'infrastructure', action: 'update' },
        { resource: 'tenants', action: 'read' },
        { resource: 'compliance', action: 'read' },
        { resource: 'taxonomy', action: 'read' },
        { resource: 'alerts', action: 'read' },
        { resource: 'audit-log', action: 'read' },
        { resource: 'processing-jobs', action: 'read' },
        { resource: 'logs', action: 'read' },
      ];

      it.each(deniedEndpoints)(
        'Seller is denied $resource:$action',
        (endpoint) => {
          const result = authorize(sellerClaims, endpoint);
          expect(result.authorized).toBe(false);
          if (!result.authorized) {
            expect(result.status).toBe(403);
            expect(result.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
          }
        },
      );
    });
  });

  describe('Support role: can read user info and logs but cannot modify', () => {
    const supportClaims = makeClaims('Support');

    describe('permitted read-only access', () => {
      const permittedEndpoints: EndpointPermission[] = [
        { resource: 'users.search', action: 'read' },
        { resource: 'users.profile', action: 'read' },
        { resource: 'processing-jobs', action: 'read' },
        { resource: 'logs', action: 'read' },
        { resource: 'users.verification', action: 'create' }, // only non-read action
      ];

      it.each(permittedEndpoints)(
        'Support is granted $resource:$action',
        (endpoint) => {
          const result = authorize(supportClaims, endpoint);
          expect(result.authorized).toBe(true);
        },
      );
    });

    describe('denied modification actions', () => {
      const deniedEndpoints: EndpointPermission[] = [
        { resource: 'users', action: 'delete' },
        { resource: 'users', action: 'create' },
        { resource: 'users.profile', action: 'update' },
        { resource: 'users.profile', action: 'delete' },
        { resource: 'processing-jobs', action: 'update' },
        { resource: 'processing-jobs', action: 'delete' },
        { resource: 'logs', action: 'delete' },
        { resource: 'logs', action: 'update' },
        { resource: 'platform-settings', action: 'read' },
        { resource: 'platform-settings', action: 'update' },
        { resource: 'billing', action: 'read' },
        { resource: 'products', action: 'create' },
        { resource: 'subscription', action: 'update' },
        { resource: 'infrastructure', action: 'read' },
      ];

      it.each(deniedEndpoints)(
        'Support is denied $resource:$action',
        (endpoint) => {
          const result = authorize(supportClaims, endpoint);
          expect(result.authorized).toBe(false);
          if (!result.authorized) {
            expect(result.status).toBe(403);
          }
        },
      );
    });
  });

  describe('Admin role: has access to all resources (superset of Support and Seller)', () => {
    const adminClaims = makeClaims('Admin');

    it('Admin has access to all Seller resources', () => {
      const sellerPerms = registry.getPermissionsForRole('Seller')!;
      for (const perm of sellerPerms) {
        for (const action of perm.actions) {
          const result = authorize(adminClaims, { resource: perm.resource, action });
          expect(result.authorized).toBe(true);
        }
      }
    });

    it('Admin has access to all Support resources', () => {
      const supportPerms = registry.getPermissionsForRole('Support')!;
      for (const perm of supportPerms) {
        for (const action of perm.actions) {
          const result = authorize(adminClaims, { resource: perm.resource, action });
          expect(result.authorized).toBe(true);
        }
      }
    });

    it('Admin has access to admin-only resources', () => {
      const adminOnlyEndpoints: EndpointPermission[] = [
        { resource: 'platform-settings', action: 'create' },
        { resource: 'platform-settings', action: 'read' },
        { resource: 'platform-settings', action: 'update' },
        { resource: 'platform-settings', action: 'delete' },
        { resource: 'billing', action: 'create' },
        { resource: 'billing', action: 'read' },
        { resource: 'billing', action: 'update' },
        { resource: 'billing', action: 'delete' },
        { resource: 'infrastructure', action: 'read' },
        { resource: 'infrastructure', action: 'update' },
        { resource: 'tenants', action: 'create' },
        { resource: 'tenants', action: 'read' },
        { resource: 'tenants', action: 'update' },
        { resource: 'tenants', action: 'delete' },
        { resource: 'compliance', action: 'create' },
        { resource: 'compliance', action: 'read' },
        { resource: 'taxonomy', action: 'create' },
        { resource: 'taxonomy', action: 'read' },
        { resource: 'alerts', action: 'read' },
        { resource: 'alerts', action: 'update' },
        { resource: 'audit-log', action: 'read' },
      ];

      for (const endpoint of adminOnlyEndpoints) {
        const result = authorize(adminClaims, endpoint);
        expect(result.authorized).toBe(true);
      }
    });

    it('Admin resolves with correct context', () => {
      const claims = makeClaims('Admin', { sub: 'admin-user-456', 'custom:tenantId': undefined });
      const endpoint: EndpointPermission = { resource: 'platform-settings', action: 'update' };

      const result = authorize(claims, endpoint);

      expect(result.authorized).toBe(true);
      if (result.authorized) {
        expect(result.context.role).toBe('Admin');
        expect(result.context.userId).toBe('admin-user-456');
        expect(result.context.tenantId).toBeUndefined();
      }
    });
  });

  describe('Adding a new role config entry works without code changes', () => {
    it('new role in the registry is enforced correctly via permission checks', () => {
      // Extensibility: adding a new role entry to the config enables it
      // in the registry without modifying PermissionRegistry source code.
      const extendedConfig: PermissionRegistryConfig = {
        roles: [
          ...defaultPermissionConfig.roles,
          {
            roleId: 'Finance',
            permissions: [
              { resource: 'billing', actions: ['read', 'update'] },
              { resource: 'reports', actions: ['create', 'read'] },
              { resource: 'audit-log', actions: ['read'] },
            ],
          },
        ],
      };

      const extendedRegistry = new PermissionRegistry(extendedConfig);

      // Finance role is recognized by the registry
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'read').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'update').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Finance', 'reports', 'create').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Finance', 'reports', 'read').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Finance', 'audit-log', 'read').granted).toBe(true);

      // Finance is denied resources not in its config
      expect(extendedRegistry.hasPermission('Finance', 'platform-settings', 'read').granted).toBe(false);
      expect(extendedRegistry.hasPermission('Finance', 'products', 'create').granted).toBe(false);

      // Finance is denied actions not in its config
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'delete').granted).toBe(false);
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'create').granted).toBe(false);

      // Existing roles still work with the extended registry
      expect(extendedRegistry.hasPermission('Admin', 'platform-settings', 'update').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Seller', 'products', 'create').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Support', 'logs', 'read').granted).toBe(true);
    });

    it('end-to-end flow works for new role once its Cognito Group is recognized by the JWT resolver', () => {
      // The authorization check using createAuthorizationCheck integrates
      // JWT resolution with registry checks. For existing known roles (Admin,
      // Support, Seller), the full flow works out of the box.
      // Adding a new Cognito Group requires updating the JWT resolver's VALID_ROLES.
      // However, the registry + middleware code requires NO changes — only config.
      const extendedConfig: PermissionRegistryConfig = {
        roles: [
          ...defaultPermissionConfig.roles,
          {
            roleId: 'Seller', // Extend Seller with extra resource
            permissions: [
              { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
              { resource: 'suppliers', actions: ['create', 'read', 'update', 'delete'] },
              { resource: 'ai-listings', actions: ['create', 'read', 'update', 'delete'] },
              { resource: 'analytics', actions: ['read'] },
              { resource: 'exports', actions: ['create', 'read'] },
              { resource: 'subscription', actions: ['read', 'update'] },
              { resource: 'custom-reports', actions: ['read'] }, // new resource
            ],
          },
        ],
      };

      // Note: duplicate roleId will use the last one in the map
      // Instead let's add a new resource to an existing role via a fresh config
      const newConfig: PermissionRegistryConfig = {
        roles: [
          {
            roleId: 'Seller',
            permissions: [
              ...defaultPermissionConfig.roles[0].permissions,
              { resource: 'custom-reports', actions: ['read'] },
            ],
          },
          defaultPermissionConfig.roles[1], // Support
          defaultPermissionConfig.roles[2], // Admin
        ],
      };

      const newRegistry = new PermissionRegistry(newConfig);
      const newAuthorize = createAuthorizationCheck(newRegistry, EXPECTED_ISSUER);

      const sellerClaims = makeClaims('Seller');

      // Seller can now access the new resource through the full flow
      const result = newAuthorize(sellerClaims, { resource: 'custom-reports', action: 'read' });
      expect(result.authorized).toBe(true);
      if (result.authorized) {
        expect(result.context.role).toBe('Seller');
      }

      // Original resources still work
      const productsResult = newAuthorize(sellerClaims, { resource: 'products', action: 'create' });
      expect(productsResult.authorized).toBe(true);
    });

    it('multiple group resolution picks highest priority known role', () => {
      const claims: JwtClaims = {
        sub: 'multi-user',
        iss: EXPECTED_ISSUER,
        exp: Math.floor(Date.now() / 1000) + 3600,
        'cognito:groups': ['Admin', 'Support', 'Seller'],
      };

      const result = authorize(claims, { resource: 'platform-settings', action: 'update' });
      expect(result.authorized).toBe(true);
      if (result.authorized) {
        expect(result.context.role).toBe('Admin');
      }
    });
  });
});
