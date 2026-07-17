import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import {
  RequireAdmin,
  RequireSupport,
  RequireSeller,
  RequirePermission,
} from '../components/PermissionGuard';
import { PermissionRegistry } from '../registry';
import { defaultPermissionConfig } from '../config';
import type { PlatformRole } from '../types';

const registry = new PermissionRegistry(defaultPermissionConfig);

function renderGuard(
  Component: typeof RequireAdmin,
  role: PlatformRole | null,
  isResolved: boolean,
): string {
  return renderToString(
    <Component registry={registry} userRole={role} isResolved={isResolved}>
      <span data-testid="child">Protected Content</span>
    </Component>,
  );
}

describe('PermissionGuard — isResolved behavior', () => {
  it('renders nothing while isResolved is false (RequireAdmin)', () => {
    const html = renderGuard(RequireAdmin, 'Admin', false);
    expect(html).toBe('');
  });

  it('renders nothing while isResolved is false (RequireSupport)', () => {
    const html = renderGuard(RequireSupport, 'Support', false);
    expect(html).toBe('');
  });

  it('renders nothing while isResolved is false (RequireSeller)', () => {
    const html = renderGuard(RequireSeller, 'Seller', false);
    expect(html).toBe('');
  });

  it('renders nothing when userRole is null even if isResolved is true', () => {
    const html = renderGuard(RequireAdmin, null, true);
    expect(html).toBe('');
  });
});

describe('RequireAdmin', () => {
  it('renders children for Admin role', () => {
    const html = renderGuard(RequireAdmin, 'Admin', true);
    expect(html).toContain('Protected Content');
    expect(html).toContain('data-testid="child"');
  });

  it('renders nothing for Support role', () => {
    const html = renderGuard(RequireAdmin, 'Support', true);
    expect(html).toBe('');
  });

  it('renders nothing for Seller role', () => {
    const html = renderGuard(RequireAdmin, 'Seller', true);
    expect(html).toBe('');
  });
});

describe('RequireSupport', () => {
  it('renders children for Admin role', () => {
    const html = renderGuard(RequireSupport, 'Admin', true);
    expect(html).toContain('Protected Content');
    expect(html).toContain('data-testid="child"');
  });

  it('renders children for Support role', () => {
    const html = renderGuard(RequireSupport, 'Support', true);
    expect(html).toContain('Protected Content');
    expect(html).toContain('data-testid="child"');
  });

  it('renders nothing for Seller role', () => {
    const html = renderGuard(RequireSupport, 'Seller', true);
    expect(html).toBe('');
  });
});

describe('RequireSeller', () => {
  it('renders children for Seller role', () => {
    const html = renderGuard(RequireSeller, 'Seller', true);
    expect(html).toContain('Protected Content');
    expect(html).toContain('data-testid="child"');
  });

  it('renders nothing for Admin role', () => {
    const html = renderGuard(RequireSeller, 'Admin', true);
    expect(html).toBe('');
  });

  it('renders nothing for Support role', () => {
    const html = renderGuard(RequireSeller, 'Support', true);
    expect(html).toBe('');
  });
});

describe('RequirePermission', () => {
  it('renders children when role has the specified permission', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole="Seller"
        isResolved={true}
        resource="products"
        action="read"
      >
        <span data-testid="permitted">Allowed</span>
      </RequirePermission>,
    );
    expect(html).toContain('Allowed');
    expect(html).toContain('data-testid="permitted"');
  });

  it('renders nothing when role lacks the specified permission', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole="Seller"
        isResolved={true}
        resource="platform-settings"
        action="read"
      >
        <span>Should Not Appear</span>
      </RequirePermission>,
    );
    expect(html).toBe('');
  });

  it('defaults action to read when not specified', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole="Support"
        isResolved={true}
        resource="logs"
      >
        <span data-testid="default-action">Logs Visible</span>
      </RequirePermission>,
    );
    expect(html).toContain('Logs Visible');
    expect(html).toContain('data-testid="default-action"');
  });

  it('renders nothing while isResolved is false', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole="Admin"
        isResolved={false}
        resource="products"
        action="read"
      >
        <span>Should Not Appear</span>
      </RequirePermission>,
    );
    expect(html).toBe('');
  });
});

describe('RequirePermission — invalid identifiers', () => {
  it('renders nothing for an empty resource string without throwing', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole="Admin"
        isResolved={true}
        resource=""
        action="read"
      >
        <span>Should Not Appear</span>
      </RequirePermission>,
    );
    expect(html).toBe('');
  });

  it('renders nothing for a non-existent resource without throwing', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole="Admin"
        isResolved={true}
        resource="nonexistent.resource.xyz"
        action="read"
      >
        <span>Should Not Appear</span>
      </RequirePermission>,
    );
    expect(html).toBe('');
  });

  it('does not throw for an unrecognized role with RequirePermission', () => {
    const html = renderToString(
      <RequirePermission
        registry={registry}
        userRole={'UnknownRole' as PlatformRole}
        isResolved={true}
        resource="products"
        action="read"
      >
        <span>Should Not Appear</span>
      </RequirePermission>,
    );
    expect(html).toBe('');
  });
});
