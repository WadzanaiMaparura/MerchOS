/**
 * Component tests for the Admin login page + useAdminAuth MFA gating.
 *
 * The shared Cognito pool is Mfa.OPTIONAL, so admin MFA is enforced at the
 * app layer. These tests lock in that routing:
 *  - TOTP challenge returned -> /mfa (operator has a device enrolled)
 *  - no challenge returned    -> /mfa/setup (operator must enroll; NOT admitted)
 *  - invalid credentials      -> generic error, no navigation
 * They also verify useAdminAuth no longer throws on the no-challenge case.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

const baseLoginMock = vi.fn();
const completeMfaMock = vi.fn();
vi.mock('@merch-os/auth', () => ({
  useAuth: () => ({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    accessToken: null,
    login: baseLoginMock,
    completeMfa: completeMfaMock,
    logout: vi.fn(),
    refreshSession: vi.fn(),
  }),
}));

import AdminLoginPage from '../../app/(auth)/login/page';
import { useAdminAuth } from '../../hooks/useAdminAuth';

beforeEach(() => {
  vi.clearAllMocks();
});

async function submitLogin(email = 'admin@merchos.io', password = 'Sup3rSecret!') {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('useAdminAuth.login', () => {
  it('returns the challenge when TOTP is enrolled', async () => {
    baseLoginMock.mockResolvedValue({ challengeType: 'TOTP', session: 'admin@merchos.io' });
    const { result } = renderHook(() => useAdminAuth());

    await expect(result.current.login('admin@merchos.io', 'pw')).resolves.toEqual({
      challengeType: 'TOTP',
      session: 'admin@merchos.io',
    });
  });

  it('returns null (does not throw) when no second factor was required', async () => {
    baseLoginMock.mockResolvedValue(undefined);
    const { result } = renderHook(() => useAdminAuth());

    await expect(result.current.login('admin@merchos.io', 'pw')).resolves.toBeNull();
  });
});

describe('Admin LoginPage routing', () => {
  it('routes to /mfa when a TOTP challenge is returned', async () => {
    baseLoginMock.mockResolvedValue({ challengeType: 'TOTP', session: 'admin@merchos.io' });
    render(<AdminLoginPage />);

    await submitLogin();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/mfa'));
    expect(pushMock).not.toHaveBeenCalledWith('/mfa/setup');
  });

  it('routes to /mfa/setup when no second factor is enrolled (not admitted)', async () => {
    baseLoginMock.mockResolvedValue(undefined);
    render(<AdminLoginPage />);

    await submitLogin();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/mfa/setup'));
    // Critically, a no-MFA operator is never sent straight to the dashboard.
    expect(pushMock).not.toHaveBeenCalledWith('/');
    expect(pushMock).not.toHaveBeenCalledWith('/health');
  });

  it('shows a generic error and does not navigate on invalid credentials', async () => {
    baseLoginMock.mockRejectedValue(new Error('NotAuthorizedException'));
    render(<AdminLoginPage />);

    await submitLogin('admin@merchos.io', 'wrong');

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/invalid email or password/i)
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
