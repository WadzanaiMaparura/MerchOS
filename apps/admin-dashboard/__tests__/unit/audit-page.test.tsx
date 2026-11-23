import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../components/AdminRouteGuard', () => ({
  AdminRouteGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../lib/customers', () => ({ ADMIN_API_URL: 'https://admin-api.example' }));
const fetchAudit = vi.hoisted(() => vi.fn());
vi.mock('../../lib/audit', () => ({ fetchAudit }));

import AuditLogPage from '../../app/(dashboard)/audit-log/page';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuditLogPage />
    </QueryClientProvider>,
  );

beforeEach(() => {
  fetchAudit.mockReset();
  fetchAudit.mockResolvedValue({
    events: [
      { id: 'a1', at: '2026-11-23T09:00:00.000Z', action: 'disable', label: 'Disabled account', byId: 'staff-admin', byEmail: 'admin@merchos.co.za', byRole: 'Admin', tenantId: 't1', subject: 'Thandi Home Goods', reason: 'Chargeback', detail: '2 people' },
    ],
    total: 1,
    page: 1,
    pageSize: 50,
    staff: [{ id: 'staff-admin', email: 'admin@merchos.co.za', role: 'Admin' }],
    actions: [{ id: 'disable', label: 'Disabled account' }],
  });
});

describe('Audit log page', () => {
  it('shows who did what to which customer, and why', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Disabled account' })).toBeTruthy();
    expect(screen.getByText('Thandi Home Goods')).toBeTruthy();
    expect(screen.getByText('Chargeback')).toBeTruthy();
    expect(screen.getAllByText('admin@merchos.co.za').length).toBeGreaterThan(0);
  });

  it('filters by action and staff member', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: 'Disabled account' });
    await user.selectOptions(screen.getByLabelText('Action'), 'disable');
    await waitFor(() => expect(fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'disable', page: 1 })));
    await user.selectOptions(screen.getByLabelText('Staff member'), 'staff-admin');
    await waitFor(() => expect(fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ staff: 'staff-admin' })));
  });

  it('opens the exact details', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Disabled account' }));
    expect(screen.getByText('2026-11-23T09:00:00.000Z')).toBeTruthy();
  });
});
