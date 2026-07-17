import { describe, it, expect } from 'vitest';
import { PermissionRegistry } from '../registry';
import { defaultPermissionConfig } from '../config';
import type { PermissionRegistryConfig } from '../types';

describe('PermissionRegistry', () => {
  const registry = new PermissionRegistry(defaultPermissionConfig);

  describe('recognized roles return correct permissions', () => {
    it('returns granted for Seller with products:create', () => {
      const result = registry.hasPermission('Seller', 'products', 'create');
      expect(result).toEqual({ granted: true });
    });

    it('returns granted for Support with users.search:read', () => {
      const result = registry.hasPermission('Support', 'users.search', 'read');
      expect(result).toEqual({ granted: true });
    });

    it('returns granted for Admin with platform-settings:update', () => {
      const result = registry.hasPermission('Admin', 'platform-settings', 'update');
      expect(result).toEqual({ granted: true });
    });

    it('getPermissionsForRole returns permissions array for Seller', () => {
      const perms = registry.getPermissionsForRole('Seller');
      expect(perms).not.toBeNull();
      expect(perms!.length).toBeGreaterThan(0);
      expect(perms!.some(p => p.resource === 'products')).toBe(true);
    });

    it('hasResourceAccess returns true when role has any action on resource', () => {
      expect(registry.hasResourceAccess('Seller', 'analytics')).toBe(true);
    });
  });

  describe('unrecognized roles return denied with reason', () => {
    it('returns denied with reason for unknown role', () => {
      const result = registry.hasPermission('UnknownRole', 'products', 'read');
      expect(result.granted).toBe(false);
      expect(result.reason).toContain('Unrecognized role');
      expect(result.reason).toContain('UnknownRole');
    });

    it('getPermissionsForRole returns null for unknown role', () => {
      expect(registry.getPermissionsForRole('Phantom')).toBeNull();
    });

    it('hasResourceAccess returns false for unknown role', () => {
      expect(registry.hasResourceAccess('Phantom', 'products')).toBe(false);
    });
  });

  describe('missing resource-action combos return implicit deny', () => {
    it('denies Seller access to platform-settings:read', () => {
      const result = registry.hasPermission('Seller', 'platform-settings', 'read');
      expect(result.granted).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('denies Support write access to logs', () => {
      const result = registry.hasPermission('Support', 'logs', 'delete');
      expect(result.granted).toBe(false);
      expect(result.reason).toContain("lacks 'delete' on 'logs'");
    });

    it('denies Seller access to a completely unknown resource', () => {
      const result = registry.hasPermission('Seller', 'nonexistent-resource', 'read');
      expect(result.granted).toBe(false);
    });
  });

  describe('validation rejects malformed configs', () => {
    it('rejects config with empty permissions array', () => {
      const config: PermissionRegistryConfig = {
        roles: [{ roleId: 'EmptyRole', permissions: [] }],
      };
      expect(() => new PermissionRegistry(config)).toThrow('empty permission set');
    });

    it('rejects config with invalid action value', () => {
      const config: PermissionRegistryConfig = {
        roles: [
          {
            roleId: 'BadActions',
            permissions: [{ resource: 'foo', actions: ['read', 'purge' as any] }],
          },
        ],
      };
      expect(() => new PermissionRegistry(config)).toThrow("Invalid action 'purge'");
    });

    it('rejects config with resource longer than 128 chars', () => {
      const longResource = 'a'.repeat(129);
      const config: PermissionRegistryConfig = {
        roles: [
          {
            roleId: 'LongResource',
            permissions: [{ resource: longResource, actions: ['read'] }],
          },
        ],
      };
      expect(() => new PermissionRegistry(config)).toThrow('Invalid resource identifier');
    });

    it('rejects config with missing role identifier', () => {
      const config: PermissionRegistryConfig = {
        roles: [{ roleId: '', permissions: [{ resource: 'x', actions: ['read'] }] }],
      };
      expect(() => new PermissionRegistry(config)).toThrow('Missing or invalid role identifier');
    });

    it('rejects config with empty resource string', () => {
      const config: PermissionRegistryConfig = {
        roles: [
          {
            roleId: 'EmptyRes',
            permissions: [{ resource: '', actions: ['read'] }],
          },
        ],
      };
      expect(() => new PermissionRegistry(config)).toThrow('Invalid resource identifier');
    });
  });

  describe('Admin has superset of Support and Seller permissions', () => {
    it('Admin has every permission that Seller has', () => {
      const sellerPerms = registry.getPermissionsForRole('Seller')!;
      for (const perm of sellerPerms) {
        for (const action of perm.actions) {
          const result = registry.hasPermission('Admin', perm.resource, action);
          expect(result.granted).toBe(true);
        }
      }
    });

    it('Admin has every permission that Support has', () => {
      const supportPerms = registry.getPermissionsForRole('Support')!;
      for (const perm of supportPerms) {
        for (const action of perm.actions) {
          const result = registry.hasPermission('Admin', perm.resource, action);
          expect(result.granted).toBe(true);
        }
      }
    });
  });

  describe('registry is data-driven (no role-name branching)', () => {
    it('a new fictional role added to the config works without code changes', () => {
      const configWithNewRole: PermissionRegistryConfig = {
        roles: [
          ...defaultPermissionConfig.roles,
          {
            roleId: 'Finance',
            permissions: [
              { resource: 'billing', actions: ['read', 'update'] },
              { resource: 'reports', actions: ['create', 'read'] },
            ],
          },
        ],
      };

      const extendedRegistry = new PermissionRegistry(configWithNewRole);

      // New role works
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'read').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'update').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Finance', 'reports', 'create').granted).toBe(true);

      // New role is correctly denied for non-configured resources
      expect(extendedRegistry.hasPermission('Finance', 'platform-settings', 'read').granted).toBe(false);

      // New role is correctly denied for non-configured actions
      expect(extendedRegistry.hasPermission('Finance', 'billing', 'delete').granted).toBe(false);

      // Existing roles still work
      expect(extendedRegistry.hasPermission('Admin', 'platform-settings', 'read').granted).toBe(true);
      expect(extendedRegistry.hasPermission('Seller', 'products', 'create').granted).toBe(true);

      // getPermissionsForRole works for the new role
      const financePerms = extendedRegistry.getPermissionsForRole('Finance');
      expect(financePerms).not.toBeNull();
      expect(financePerms).toHaveLength(2);

      // hasResourceAccess works for the new role
      expect(extendedRegistry.hasResourceAccess('Finance', 'billing')).toBe(true);
      expect(extendedRegistry.hasResourceAccess('Finance', 'products')).toBe(false);
    });
  });
});
