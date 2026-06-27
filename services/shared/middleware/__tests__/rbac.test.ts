import { describe, it, expect } from 'vitest';
import { isActionPermitted, Role, Action } from '../rbac';

describe('RBAC isActionPermitted', () => {
  const allActions: Action[] = [
    'view-products',
    'upload-products',
    'approve-attributes',
    'export-listings',
    'connect-integrations',
    'manage-users',
    'manage-billing',
    'manage-webhooks',
    'manage-inventory',
  ];

  describe('viewer role', () => {
    const role: Role = 'viewer';

    it('permits view-products', () => {
      expect(isActionPermitted(role, 'view-products')).toBe(true);
    });

    it('denies all other actions', () => {
      const denied = allActions.filter((a) => a !== 'view-products');
      for (const action of denied) {
        expect(isActionPermitted(role, action)).toBe(false);
      }
    });
  });

  describe('editor role', () => {
    const role: Role = 'editor';
    const permitted: Action[] = [
      'view-products',
      'upload-products',
      'approve-attributes',
      'export-listings',
      'manage-inventory',
    ];

    it('permits expected actions', () => {
      for (const action of permitted) {
        expect(isActionPermitted(role, action)).toBe(true);
      }
    });

    it('denies owner/admin-only actions', () => {
      expect(isActionPermitted(role, 'connect-integrations')).toBe(false);
      expect(isActionPermitted(role, 'manage-users')).toBe(false);
      expect(isActionPermitted(role, 'manage-billing')).toBe(false);
      expect(isActionPermitted(role, 'manage-webhooks')).toBe(false);
    });
  });

  describe('admin role', () => {
    const role: Role = 'admin';

    it('permits connect-integrations and manage-webhooks', () => {
      expect(isActionPermitted(role, 'connect-integrations')).toBe(true);
      expect(isActionPermitted(role, 'manage-webhooks')).toBe(true);
    });

    it('denies manage-users and manage-billing (owner-only)', () => {
      expect(isActionPermitted(role, 'manage-users')).toBe(false);
      expect(isActionPermitted(role, 'manage-billing')).toBe(false);
    });
  });

  describe('owner role', () => {
    const role: Role = 'owner';

    it('permits all actions', () => {
      for (const action of allActions) {
        expect(isActionPermitted(role, action)).toBe(true);
      }
    });
  });
});
