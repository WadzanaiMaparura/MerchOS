/**
 * Component tests for the Seller login + MFA pages.
 *
 * Covers the three outcomes the login page must route correctly:
 *  - MFA challenge returned  -> navigate to /login/mfa
 *  - plain success           -> navigate to /dashboard
 *  - failure                 -> show the generic (non-enumerating) error
 * and the MFA page's complete-success (→ /dashboard) and error paths.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const loginMock = vi.fn();
const completeMfaMock = vi.fn();
vi.mock('@merch-os/auth', () => ({
  useAuth: () => ({ login: loginMock, completeMfa: completeMfaMock }),
}));

import LoginPage from '../../app/(auth)/login/page';
import SellerMfaPage from '../../app/(auth)/login/mfa/page';

beforeEach(() => {
  vi.clearAllMocks();
});

async function submitLogin(email = 'seller@example.com', password = 'Sup3rSecret!') {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Seller LoginPage', () => {
  it('navigates to /login/mfa when login returns an MFA challenge', async () => {
    loginMock.mockResolvedValue({ challengeType: 'TOTP', session: 'seller@example.com' });
    render(<LoginPage />);

    await submitLogin();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login/mfa'));
    expect(pushMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('navigates to /dashboard on a plain (no-MFA) success', async () => {
    loginMock.mockResolvedValue(undefined);
    render(<LoginPage />);

    await submitLogin();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows a generic error and does not navigate when login fails', async () => {
    loginMock.mockRejectedValue(new Error('Auth UserPool not configured'));
    render(<LoginPage />);

    await submitLogin();

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/invalid email or password/i)
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('does not reveal whether the email exists (non-enumerating message)', async () => {
    loginMock.mockRejectedValue(new Error('UserNotFoundException'));
    render(<LoginPage />);

    await submitLogin('ghost@example.com');

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alertText = screen.getByRole('alert').textContent ?? '';
    expect(alertText).not.toMatch(/not found/i);
    expect(alertText).not.toMatch(/exist/i);
    expect(alertText).toMatch(/invalid email or password/i);
  });
});

describe('Seller MFA page', () => {
  it('completes MFA and redirects to /dashboard', async () => {
    completeMfaMock.mockResolvedValue(undefined);
    render(<SellerMfaPage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(completeMfaMock).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows an error and stays on the page when the code is rejected', async () => {
    completeMfaMock.mockRejectedValue(new Error('CodeMismatchException'));
    render(<SellerMfaPage />);

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/invalid or expired/i)
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
