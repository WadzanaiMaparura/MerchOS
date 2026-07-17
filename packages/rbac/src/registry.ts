import type { Action, Permission, PermissionRegistryConfig, RoleEntry, PermissionCheckResult } from './types';

/**
 * Centralized Permission Registry.
 * Data-driven: no if/else or switch/case on role names.
 * All lookups are map-based — works for ANY role in the config.
 */
export class PermissionRegistry {
  private readonly roleMap: Map<string, RoleEntry>;

  constructor(config: PermissionRegistryConfig) {
    this.validate(config);
    this.roleMap = new Map(config.roles.map(r => [r.roleId, r]));
  }

  /** Check if a role has a specific permission (resource + action) */
  hasPermission(role: string, resource: string, action: Action): PermissionCheckResult {
    const entry = this.roleMap.get(role);
    if (!entry) {
      return { granted: false, reason: `Unrecognized role: ${role}` };
    }
    const perm = entry.permissions.find(p => p.resource === resource);
    if (!perm || !perm.actions.includes(action)) {
      return { granted: false, reason: `Role '${role}' lacks '${action}' on '${resource}'` };
    }
    return { granted: true };
  }

  /** Get all permissions for a role */
  getPermissionsForRole(role: string): Permission[] | null {
    return this.roleMap.get(role)?.permissions ?? null;
  }

  /** Check if a role has access to a given resource (any action) */
  hasResourceAccess(role: string, resource: string): boolean {
    const entry = this.roleMap.get(role);
    if (!entry) return false;
    return entry.permissions.some(p => p.resource === resource);
  }

  /** Validate a registry configuration */
  private validate(config: PermissionRegistryConfig): void {
    const validActions: Action[] = ['create', 'read', 'update', 'delete'];
    for (const role of config.roles) {
      if (!role.roleId || typeof role.roleId !== 'string') {
        throw new Error('Missing or invalid role identifier');
      }
      if (!role.permissions || role.permissions.length === 0) {
        throw new Error(`Role '${role.roleId}' has an empty permission set`);
      }
      for (const perm of role.permissions) {
        if (!perm.resource || perm.resource.length > 128) {
          throw new Error(`Invalid resource identifier in role '${role.roleId}'`);
        }
        for (const action of perm.actions) {
          if (!validActions.includes(action)) {
            throw new Error(`Invalid action '${action}' in role '${role.roleId}'`);
          }
        }
      }
    }
  }
}
