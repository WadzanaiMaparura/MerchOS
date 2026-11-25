import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state = vi.hoisted(() => ({
  billing: undefined as unknown,
  role: 'owner',
  pathname: '/products',
  mutate: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@merch-os/api-client', () => ({
  useBilling: () => ({ data: state.billing }),
  useProducts: () => ({ data: { items: [], total: 412, page: 1, pageSize: 1 } }),
  usePlanChange: () => ({ mutate: state.mutate, isPending: false, isError: false, error: null }),
}));
vi.mock('@merch-os/auth', () => ({
  useRole: () => state.role,
  useAuth: () => ({ logout: state.logout }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const plans = [
  { planId: 'starter', name: 'Starter', priceZARCents: 49900, monthlyProducts: 500, monthlyCredits: 3000, limits: {} },
  { planId: 'growth', name: 'Growth', priceZARCents: 89900, monthlyProducts: 1000, monthlyCredits: 6000, limits: {} },
  { planId: 'enterprise', name: 'Enterprise', priceZARCents: null, monthlyProducts: null, monthlyCredits: null, limits: {} },
];
const billing = (account: Record<string, unknown>) => ({
  planName: 'Growth',
  planId: 'growth',
  subscriptionStatus: 'active',
  currentPeriodEnd: '2026-12-22T10:00:00.000Z',
  plans,
  account: {
    lifecycleEnabled: true,
    lastPlanId: 'growth',
    paidUntil: '2026-12-22T10:00:00.000Z',
    graceEndsAt: '2026-12-25T10:00:00.000Z',
    closesAt: '2027-01-28T10:00:00.000Z',
    dataKeptUntil: '2028-01-28T10:00:00.000Z',
    ...account,
  },
});

let mod: typeof import('../../app/components/BillingStageNotice');
beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED', 'true');
  state.role = 'owner';
  state.pathname = '/products';
  mod = await import('../../app/components/BillingStageNotice');
});

describe('BillingStageBanner', () => {
  it('shows nothing while the payment cycle is switched off, or when paid up', () => {
    state.billing = billing({ stage: 'paused', lifecycleEnabled: false });
    const { container, rerender } = render(<mod.BillingStageBanner />);
    expect(container).toBeEmptyDOMElement();
    state.billing = billing({ stage: 'paid' });
    rerender(<mod.BillingStageBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('due soon, overdue and paused each explain what happens next and link to pay', () => {
    state.billing = billing({ stage: 'due_soon' });
    const { rerender } = render(<mod.BillingStageBanner />);
    expect(screen.getByText('Your Growth plan is paid until 22 December 2026.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pay for next month' }).getAttribute('href')).toBe('/billing?renew=1');

    state.billing = billing({ stage: 'grace' });
    rerender(<mod.BillingStageBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Everything still works until 25 December 2026');

    state.billing = billing({ stage: 'paused' });
    rerender(<mod.BillingStageBanner />);
    expect(screen.getByText('Your plan is paused.')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Pay before 28 January 2027');
    expect(screen.getByRole('link', { name: 'Pay now' })).toBeTruthy();
  });

  it('team members are told only the owner can pay (no pay button)', () => {
    state.role = 'member';
    state.billing = billing({ stage: 'paused' });
    render(<mod.BillingStageBanner />);
    expect(screen.getByRole('alert').textContent).toContain('Only the account owner can pay.');
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('ClosedAccountGate and Welcome back', () => {
  it('lets the dashboard through unless the account is closed, and always lets Billing through', () => {
    state.billing = billing({ stage: 'paused' });
    const { rerender } = render(<mod.ClosedAccountGate><p>dashboard</p></mod.ClosedAccountGate>);
    expect(screen.getByText('dashboard')).toBeTruthy();
    state.billing = billing({ stage: 'closed' });
    state.pathname = '/billing';
    rerender(<mod.ClosedAccountGate><p>dashboard</p></mod.ClosedAccountGate>);
    expect(screen.getByText('dashboard')).toBeTruthy();
    state.pathname = '/products';
    rerender(<mod.ClosedAccountGate><p>dashboard</p></mod.ClosedAccountGate>);
    expect(screen.queryByText('dashboard')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('shows the products are safe, pre-selects the last plan and pays through PayFast', async () => {
    const user = userEvent.setup();
    state.billing = billing({ stage: 'closed' });
    render(<mod.WelcomeBack />);
    expect(screen.getByText(/Your 412 products are safe/)).toBeTruthy();
    expect(screen.getByText(/We keep your products until 28 January 2028/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Growth/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('radio', { name: /Enterprise/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reactivate and pay R899' }));
    expect(state.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'growth', returnUrl: expect.stringContaining('/billing?checkout=success') }),
      expect.anything(),
    );
  });

  it('shows the comeback discount on the button', () => {
    state.billing = billing({ stage: 'closed', comeback: { percentOff: 50, endsAt: '2027-04-05T10:00:00.000Z' } });
    render(<mod.WelcomeBack />);
    expect(screen.getByRole('status').textContent).toContain('50% off your first month back');
    expect(screen.getByRole('button', { name: 'Reactivate and pay R449.50' })).toBeTruthy();
  });

  it('team members are asked to contact the owner, and anyone can sign out', async () => {
    const user = userEvent.setup();
    state.role = 'member';
    state.billing = billing({ stage: 'closed' });
    render(<mod.WelcomeBack />);
    expect(screen.getByText(/Only the account owner can reactivate/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Reactivate and pay/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Not now, sign me out' }));
    expect(state.logout).toHaveBeenCalled();
  });
});

describe('card on file (automatic monthly charges)', () => {
  it('due soon: says the card will be charged, no "pay" button', () => {
    state.billing = billing({ stage: 'due_soon', cardBillingEnabled: true, autoRenew: true });
    render(<mod.BillingStageBanner />);
    expect(screen.getByText('Your Growth plan renews on 22 December 2026.')).toBeTruthy();
    expect(screen.getByText(/Your card will be charged automatically/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage billing' }).getAttribute('href')).toBe('/billing');
  });

  it('a declined card: update the card or pay by EFT', () => {
    state.billing = billing({ stage: 'paused', cardBillingEnabled: true, autoRenew: true, chargeFailed: true });
    render(<mod.BillingStageBanner />);
    expect(screen.getByText('Your plan is paused: we could not charge your card.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Update card or pay by EFT' })).toBeTruthy();
  });

  it('Welcome back offers a one-off EFT payment besides the card subscription', async () => {
    const user = userEvent.setup();
    state.billing = billing({ stage: 'closed', cardBillingEnabled: true });
    render(<mod.WelcomeBack />);
    expect(screen.getByText(/Your card is charged automatically each month/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Pay one month by EFT instead' }));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ planId: 'growth', payOnce: true }), expect.anything());
  });
});
