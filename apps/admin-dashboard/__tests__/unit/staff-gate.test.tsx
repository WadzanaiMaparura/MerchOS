import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const replaceMock = vi.fn();
let pathname = '/health';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => pathname,
}));

let role: string | null = 'Admin';
vi.mock('../../hooks/usePlatformRole', () => ({
  usePlatformRole: () => ({ platformRole: role, isResolved: true }),
}));
vi.mock('../../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({
    user: { userId: 'u', email: 'seller@example.co.za', role: 'operator' },
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(async () => undefined),
  }),
}));
// AdminAppShell pulls in API hooks; the gate only needs the nav list.
vi.mock('../../components/AdminAppShell', () => ({
  ADMIN_NAV_ITEMS: [
    { id: 'health', label: 'Health', href: '/health', requiredResource: 'infrastructure' },
    { id: 'billing', label: 'Billing', href: '/billing', requiredResource: 'billing' },
    { id: 'support', label: 'Support inbox', href: '/support', requiredResource: 'support-inbox' },
  ],
}));

import { StaffGate } from '../../components/StaffGate';

beforeEach(() => {
  vi.clearAllMocks();
});

const page = () => render(<StaffGate><p>protected page</p></StaffGate>);

describe('StaffGate', () => {
  it('tells a seller account this is the staff dashboard instead of showing an empty one', () => {
    role = 'Seller';
    pathname = '/health';
    page();
    expect(screen.getByRole('heading', { name: /staff dashboard/i })).toBeTruthy();
    expect(screen.getByText('seller@example.co.za')).toBeTruthy();
    expect(screen.queryByText('protected page')).toBeNull();
  });

  it('keeps Support out of admin-only pages', () => {
    role = 'Support';
    pathname = '/billing';
    page();
    expect(screen.queryByText('protected page')).toBeNull();
    expect(replaceMock).toHaveBeenCalledWith('/access-denied?path=%2Fbilling');
  });

  it('lets Support view Health (view only)', () => {
    role = 'Support';
    pathname = '/health';
    page();
    expect(screen.getByText('protected page')).toBeTruthy();
  });

  it('lets Support use the Support inbox', () => {
    role = 'Support';
    pathname = '/support';
    page();
    expect(screen.getByText('protected page')).toBeTruthy();
  });

  it('lets Admin open admin pages', () => {
    role = 'Admin';
    pathname = '/health';
    page();
    expect(screen.getByText('protected page')).toBeTruthy();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
