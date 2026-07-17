// packages/rbac/src/config.ts — Default MerchOS permission configuration

import type { PermissionRegistryConfig } from './types';

export const defaultPermissionConfig: PermissionRegistryConfig = {
  roles: [
    {
      roleId: 'Seller',
      permissions: [
        { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'suppliers', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'ai-listings', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'analytics', actions: ['read'] },
        { resource: 'exports', actions: ['create', 'read'] },
        { resource: 'subscription', actions: ['read', 'update'] },
      ],
    },
    {
      roleId: 'Support',
      permissions: [
        { resource: 'users.search', actions: ['read'] },
        { resource: 'users.profile', actions: ['read'] },
        { resource: 'processing-jobs', actions: ['read'] },
        { resource: 'logs', actions: ['read'] },
        { resource: 'users.verification', actions: ['create'] }, // resend verification email
      ],
    },
    {
      roleId: 'Admin',
      permissions: [
        { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'suppliers', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'ai-listings', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'analytics', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'exports', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'subscription', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'users', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'users.search', actions: ['read'] },
        { resource: 'users.profile', actions: ['read', 'update'] },
        { resource: 'users.verification', actions: ['create'] },
        { resource: 'processing-jobs', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'logs', actions: ['read'] },
        { resource: 'platform-settings', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'billing', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'infrastructure', actions: ['read', 'update'] },
        { resource: 'tenants', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'compliance', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'taxonomy', actions: ['create', 'read', 'update', 'delete'] },
        { resource: 'alerts', actions: ['read', 'update'] },
        { resource: 'audit-log', actions: ['read'] },
      ],
    },
  ],
};
