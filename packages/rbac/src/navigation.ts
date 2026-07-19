import type { PlatformRole, Action } from './types';
import { PermissionRegistry } from './registry';
import type React from 'react';

/** Navigation item with permission requirement */
export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon?: React.ReactNode;
  requiredResource: string;
  requiredAction?: Action; // defaults to 'read'
  children?: NavigationItem[];
}

/**
 * Filter navigation items to only those permitted for the given role.
 * Data-driven: reads permissions from the registry at render time.
 */
export function filterNavigationItems(
  items: NavigationItem[],
  role: PlatformRole,
  registry: PermissionRegistry,
): NavigationItem[] {
  return items.reduce<NavigationItem[]>((acc, item) => {
    const action = item.requiredAction ?? 'read';
    const { granted } = registry.hasPermission(role, item.requiredResource, action);
    if (granted) {
      const filteredChildren = item.children
        ? filterNavigationItems(item.children, role, registry)
        : undefined;
      acc.push({ ...item, children: filteredChildren });
    }
    return acc;
  }, []);
}
