import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let role: string | null = 'Support';
vi.mock('../../hooks/usePlatformRole', () => ({ usePlatformRole: () => ({ platformRole: role, isResolved: true }) }));
vi.mock('../../components/AdminRouteGuard', () => ({ AdminRouteGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../lib/customers', () => ({ ADMIN_API_URL: 'https://admin-api.example' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const api = vi.hoisted(() => ({ health: vi.fn(), alerts: vi.fn(), resolve: vi.fn(), addNote: vi.fn() }));
vi.mock('../../lib/health', () => ({ healthApi: api }));

import HealthPage from '../../app/(dashboard)/health/page';
import AlertsPage from '../../app/(dashboard)/alerts/page';

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const area = (id: string, label: string, status: string, requests: number, errors: number, extra = {}) => ({ id, label, covers: 'x', status, requests, errors, openAlerts: 0, ...extra });

const openAlert = {
  alertId: '4b1e2a52-0f0c-4f4a-9a9b-1c7a1b2c3d4e', key: 'area:listings', source: 'area', area: 'listings',
  title: 'Listing writing is failing for some sellers', description: '3 errors in the last 30 minutes (7% of requests).',
  whatToDo: 'Tell the team if it lasts more than an hour.', status: 'OPEN', startedAt: new Date(Date.now() - 35 * 60000).toISOString(),
  lastSeenAt: new Date().toISOString(), notes: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  role = 'Support';
  api.health.mockResolvedValue({
    range: '24h',
    checkedAt: '2026-11-23T10:00:00Z',
    areas: [
      area('accounts', 'Sign-in and accounts', 'working', 412, 0),
      area('listings', 'Listing writing', 'some_errors', 96, 3, { openAlerts: 1 }),
      area('payments', 'Payments', 'not_live', 0, 0),
      area('emails', 'Emails', 'working', 2, 0, { sent: 27, bounced: 0 }),
    ],
    errorSeries: [{ at: '2026-11-23T08:00:00Z', errors: 0 }, { at: '2026-11-23T09:00:00Z', errors: 3 }],
    writing: { requests: 93, inputTokens: 1, outputTokens: 1, approxCostCents: 4120 },
    openAlerts: 1,
    sellers: { businesses: 14, newInRange: 2 },
  });
  api.alerts.mockResolvedValue({
    alerts: [openAlert],
    openCount: 1,
    checks: [
      { key: 'area:listings', label: 'Listing writing: errors every 15 minutes', area: 'listings', kind: 'health', state: 'alert' },
      { key: 'alarm:merch-os-billing-ItnErrors-dev', label: 'Payment notifications are failing', area: 'payments', kind: 'alarm', state: 'ok' },
    ],
  });
  api.resolve.mockResolvedValue({});
});

describe('Health page', () => {
  it('plain status per area, totals and the open alert', async () => {
    wrap(<HealthPage />);
    expect(await screen.findByText(/MerchOS is working. 1 area had errors, 1 open alert/)).toBeTruthy();
    expect(screen.getByText('Not live yet')).toBeTruthy();
    expect(screen.getByText('3 (3%)')).toBeTruthy();
    expect(screen.getByText('27 sent')).toBeTruthy();
    expect(screen.getByText('R41.20')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Alerts' }).getAttribute('href')).toBe('/alerts');
  });

  it('switches to 7 days', async () => {
    const user = userEvent.setup();
    wrap(<HealthPage />);
    await user.click(await screen.findByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(api.health).toHaveBeenLastCalledWith('7d'));
  });
});

describe('Alerts page', () => {
  it('Support sees the alert and what to do, but cannot resolve it', async () => {
    wrap(<AlertsPage />);
    expect(await screen.findByText('Listing writing is failing for some sellers')).toBeTruthy();
    expect(screen.getByText(/Tell the team if it lasts more than an hour/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark as resolved' })).toBeNull();
    expect(screen.getByText(/for Admin staff/)).toBeTruthy();
  });

  it('Admin resolves with an optional note', async () => {
    role = 'Admin';
    const user = userEvent.setup();
    wrap(<AlertsPage />);
    await user.click(await screen.findByRole('button', { name: 'Mark as resolved' }));
    await user.type(screen.getByLabelText(/What fixed it/), 'Restarted');
    await user.click(screen.getByRole('button', { name: 'Mark as resolved' }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith(openAlert.alertId, 'Restarted'));
  });

  it('lists every check', async () => {
    const user = userEvent.setup();
    wrap(<AlertsPage />);
    await user.click(await screen.findByRole('button', { name: /All checks/ }));
    expect(screen.getByText('Payment notifications are failing')).toBeTruthy();
    expect(screen.getByText('Alarm')).toBeTruthy();
  });
});
