import { describe, it, expect } from 'vitest';
import { filterNavigationItems, NavigationItem } from '../navigation';
import { PermissionRegistry } from '../registry';
import type { PermissionRegistryConfig } from '../types';

const testConfig: PermissionRegistryConfig = {
  roles: [
    {
      roleId: 'Admin',
      permissions: [
        { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'users', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'settings', actions: ['read', 'update'] },
      ],
    },
    {
      roleId: 'Seller',
      permissions: [
        { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'analytics', actions: ['read'] },
      ],
    },
    {
      roleId: 'Support',
      permissions: [
        { resource: 'users', actions: ['read'] },
        { resource: 'logs', actions: ['read'] },
      ],
    },
  ],
};

function createRegistry() {
  return new PermissionRegistry(testConfig);
}

describe('filterNavigationItems', () => {
  it('excludes items when role lacks the required permission', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      { id: 'settings', label: 'Settings', href: '/settings', requiredResource: 'settings' },
    ];

    const result = filterNavigationItems(items, 'Seller', registry);

    expect(result).toHaveLength(0);
  });

  it('includes items when role has the required permission', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      { id: 'products', label: 'Products', href: '/products', requiredResource: 'products' },
    ];

    const result = filterNavigationItems(items, 'Seller', registry);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('products');
  });

  it('recursively filters children', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      {
        id: 'admin',
        label: 'Admin',
        href: '/admin',
        requiredResource: 'users',
        children: [
          { id: 'users-list', label: 'Users', href: '/admin/users', requiredResource: 'users' },
          { id: 'platform-settings', label: 'Settings', href: '/admin/settings', requiredResource: 'settings' },
        ],
      },
    ];

    // Support has 'users' read but not 'settings'
    const result = filterNavigationItems(items, 'Support', registry);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('admin');
    expect(result[0]!.children).toHaveLength(1);
    expect(result[0]!.children![0]!.id).toBe('users-list');
  });

  it('defaults requiredAction to read when not specified', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      { id: 'analytics', label: 'Analytics', href: '/analytics', requiredResource: 'analytics' },
    ];

    // Seller has analytics:read — no requiredAction specified so it should default to 'read'
    const result = filterNavigationItems(items, 'Seller', registry);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('analytics');
  });

  it('respects explicit requiredAction', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      { id: 'analytics-create', label: 'New Report', href: '/analytics/new', requiredResource: 'analytics', requiredAction: 'create' },
    ];

    // Seller only has analytics:read, not analytics:create
    const result = filterNavigationItems(items, 'Seller', registry);

    expect(result).toHaveLength(0);
  });

  it('returns empty array when role has no permissions for any nav item', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      { id: 'products', label: 'Products', href: '/products', requiredResource: 'products' },
      { id: 'analytics', label: 'Analytics', href: '/analytics', requiredResource: 'analytics' },
      { id: 'settings', label: 'Settings', href: '/settings', requiredResource: 'settings' },
    ];

    // Support has no permissions for products, analytics, or settings
    const result = filterNavigationItems(items, 'Support', registry);

    expect(result).toHaveLength(0);
  });

  it('returns all items when role has all required permissions', () => {
    const registry = createRegistry();
    const items: NavigationItem[] = [
      { id: 'products', label: 'Products', href: '/products', requiredResource: 'products' },
      { id: 'users', label: 'Users', href: '/users', requiredResource: 'users' },
      { id: 'settings', label: 'Settings', href: '/settings', requiredResource: 'settings' },
    ];

    const result = filterNavigationItems(items, 'Admin', registry);

    expect(result).toHaveLength(3);
  });
});
