/** Platform-level roles derived from Cognito Groups */
export type PlatformRole = 'Admin' | 'Support' | 'Seller';

/** Allowed CRUD actions */
export type Action = 'create' | 'read' | 'update' | 'delete';

/** A single permission entry: resource + allowed actions */
export interface Permission {
  resource: string; // dot-delimited, max 128 chars, e.g. "products", "users.profile"
  actions: Action[];
}

/** A role entry in the registry */
export interface RoleEntry {
  roleId: PlatformRole | string;
  permissions: Permission[];
}

/** The full permission registry configuration */
export interface PermissionRegistryConfig {
  roles: RoleEntry[];
}

/** Result of a permission check */
export interface PermissionCheckResult {
  granted: boolean;
  reason?: string;
}
