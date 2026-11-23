import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let role: string | null = 'Support';
vi.mock('../../hooks/usePlatformRole', () => ({
  usePlatformRole: () => ({ platformRole: role, isResolved: true }),
}));
vi.mock('../../components/AdminRouteGuard', () => ({
  AdminRouteGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const tenantRow = {
  key: TENANT, kind: 'tenant', tenantId: TENANT, sellerId: 'MOS-7E22ED', businessName: 'Thandi Home Goods',
  ownerUserId: 'owner-1', ownerName: 'Thandi Khumalo', ownerEmail: 'thandi@example.co.za', signedUpAt: '2026-11-21T10:00:00Z',
  plan: { kind: 'trial', label: 'Trial 6/15' }, products: 6, account: 'active', teamSize: 1,
};
const signupRow = {
  key: 'signup:pending-1', kind: 'signup', ownerUserId: 'pending-1', ownerEmail: 'new@example.co.za', signedUpAt: '2026-11-23T08:00:00Z',
  plan: { kind: 'not_started', label: 'Not started' }, products: 0, account: 'not_verified', teamSize: 1,
};

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  resendVerification: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  setExempt: vi.fn(),
}));
vi.mock('../../lib/customers', () => ({ ADMIN_API_URL: 'https://admin-api.example', customersApi: api }));

import CustomersPage from '../../app/(dashboard)/customers/page';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CustomersPage />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    customers: [signupRow, tenantRow],
    counts: { all: 2, trial: 2, paid: 0, exempt: 0, not_verified: 1, disabled: 0 },
  });
  api.get.mockResolvedValue({
    ...tenantRow,
    team: [{ userId: 'owner-1', email: 'thandi@example.co.za', role: 'owner', status: 'CONFIRMED', enabled: true, emailVerified: true }],
    marketingConsent: { granted: true },
    invoices: [],
    engagement: { emailsSent: [{ email: 'trial-welcome', sentAt: '2026-11-21T10:01:00Z' }], marketingOptOut: false, referralsMade: 0, freeMonthsEarned: 0 },
    audit: [],
  });
  api.resendVerification.mockResolvedValue({ sent: true });
  api.disable.mockResolvedValue({ disabled: true });
});

describe('Customers page', () => {
  it('lists customers with plan and account status', async () => {
    renderPage();
    expect(await screen.findByText('Thandi Home Goods')).toBeTruthy();
    expect(screen.getByText('Trial 6/15')).toBeTruthy();
    expect(screen.getAllByText('Not verified').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Not verified 1/ })).toBeTruthy();
  });

  it('Support sees the details but not the Admin-only actions', async () => {
    role = 'Support';
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Thandi Home Goods' }));
    expect(await screen.findByText(/Trial welcome/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Disable account/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Make free unlimited/ })).toBeNull();
    expect(screen.getByText(/for Admin staff/)).toBeTruthy();
  });

  it('resend verification for someone who never entered the code', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Sign-up not finished' }));
    await user.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() => expect(api.resendVerification).toHaveBeenCalledWith('pending-1'));
    expect(await screen.findByText('Verification email sent.')).toBeTruthy();
  });

  it('Admin disables only after giving a reason', async () => {
    role = 'Admin';
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Thandi Home Goods' }));
    await user.click(await screen.findByRole('button', { name: 'Disable account' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/Reason/), 'Chargeback');
    await user.click(confirm);
    await waitFor(() => expect(api.disable).toHaveBeenCalledWith(TENANT, 'Chargeback'));
    expect(await screen.findByText(/Account disabled/)).toBeTruthy();
  });
});
