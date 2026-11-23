import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../components/AdminRouteGuard', () => ({
  AdminRouteGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../lib/customers', () => ({ ADMIN_API_URL: 'https://admin-api.example' }));

const TENANT = '7e22ed36-cf82-43ba-b194-8bd4cfab5166';
const row = {
  tenantId: TENANT, sellerId: 'MOS-7E22ED', businessName: 'Thandi Home Goods', planId: 'growth', planName: 'Growth',
  priceCents: 89900, monthlyProducts: 1000, subscriptionStatus: 'active', paidUntil: '2026-12-22T10:00:00Z',
  lastPayment: { amountCents: 80910, at: '2026-11-22T10:00:00Z', voucherCode: 'LAUNCH10' }, status: 'paid', problems: 0,
};
const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), invoicePdf: vi.fn() }));
vi.mock('../../lib/billing', () => ({ billingApi: api }));

import BillingPage from '../../app/(dashboard)/billing/page';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BillingPage />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    summary: { paying: 1, byPlan: { Growth: 1 }, monthlyListCents: 89900, monthlyAfterVouchersCents: 80910, paidThisMonthCents: 80910, paymentsThisMonth: 1, attention: { problems: 0, lapsed: 0 } },
    customers: [row],
    counts: { paying: 1, renewing: 0, lapsed: 0, problems: 0, all: 1 },
  });
  api.get.mockResolvedValue({
    ...row,
    monthUsage: 312,
    freeMonthsOwed: 1,
    invoices: [
      { invoiceId: 'pay-2', invoiceNumber: 'INV-16752', amountCents: 80910, createdAt: '2026-11-22T10:00:00Z', hasPdf: true },
      { invoiceId: 'pay-3', amountCents: 100, createdAt: '2026-11-23T10:00:00Z', hasPdf: false },
    ],
    payments: [{ mPaymentId: 'pay-2', amountCents: 80910, applied: true, createdAt: '2026-11-22T10:00:00Z' }],
  });
  api.invoicePdf.mockResolvedValue('https://s3.example/inv.pdf');
});

describe('Billing page', () => {
  it('shows totals in rand and the paying customers', async () => {
    renderPage();
    expect(await screen.findByText('Thandi Home Goods')).toBeTruthy();
    expect(screen.getAllByText('R899').length).toBeGreaterThan(0);
    expect(screen.getByText('after vouchers: R809.10')).toBeTruthy();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it('detail: usage, free months owed, invoices with PDF, payments; no plan override', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Thandi Home Goods' }));
    expect(await screen.findByText(/312 of 1,000 new products/)).toBeTruthy();
    expect(screen.getByText('PDF pending')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /PDF for INV-16752/ }));
    await waitFor(() => expect(api.invoicePdf).toHaveBeenCalledWith(TENANT, 'pay-2'));
    expect(open).toHaveBeenCalledWith('https://s3.example/inv.pdf', '_blank', 'noopener');
    expect(screen.queryByRole('button', { name: /override/i })).toBeNull();
  });

  it('explains an empty list before checkout is on', async () => {
    api.list.mockResolvedValue({
      summary: { paying: 0, byPlan: {}, monthlyListCents: 0, monthlyAfterVouchersCents: 0, paidThisMonthCents: 0, paymentsThisMonth: 0, attention: { problems: 0, lapsed: 0 } },
      customers: [],
      counts: { paying: 0, renewing: 0, lapsed: 0, problems: 0, all: 0 },
    });
    renderPage();
    expect(await screen.findByText(/No paying customers yet/)).toBeTruthy();
  });
});
