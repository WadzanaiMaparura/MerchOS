/**
 * Component tests for the Admin MFA enrollment page.
 *
 * Covers the real TOTP enrollment flow:
 *  - on mount, setUpTotp runs and the QR code + manual secret are shown
 *  - a valid code calls verifyTotp and redirects to /login to re-authenticate
 *  - an invalid code shows an error and does not redirect
 *  - a setup failure (e.g. no active session) shows a recoverable error
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
}));

const setUpTotpMock = vi.fn();
const verifyTotpMock = vi.fn();
vi.mock('@merch-os/auth', () => ({
  useAuth: () => ({ setUpTotp: setUpTotpMock, verifyTotp: verifyTotpMock }),
}));

// Render the QR as a simple marker exposing its value, so we can assert the
// setup URI is passed through without depending on SVG internals.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="qr" data-value={value} />,
}));

import AdminMfaSetupPage from '../../app/(auth)/mfa/setup/page';

const SETUP = {
  sharedSecret: 'JBSWY3DPEHPK3PXP',
  setupUri: 'otpauth://totp/MerchOS:admin@merchos.io?secret=JBSWY3DPEHPK3PXP&issuer=MerchOS',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Admin MFA enrollment page', () => {
  it('runs setUpTotp on mount and renders the QR + manual secret', async () => {
    setUpTotpMock.mockResolvedValue(SETUP);
    render(<AdminMfaSetupPage />);

    await waitFor(() => expect(screen.getByTestId('qr')).toBeTruthy());
    expect(setUpTotpMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('qr').getAttribute('data-value')).toBe(SETUP.setupUri);
    // Manual-entry secret is shown for the "can't scan" path.
    expect(screen.getByText(SETUP.sharedSecret)).toBeTruthy();
  });

  it('verifies a valid code and redirects to /login', async () => {
    setUpTotpMock.mockResolvedValue(SETUP);
    verifyTotpMock.mockResolvedValue(undefined);
    render(<AdminMfaSetupPage />);

    await waitFor(() => expect(screen.getByTestId('qr')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and enable/i }));

    await waitFor(() => expect(verifyTotpMock).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('shows an error and does not redirect when the code is rejected', async () => {
    setUpTotpMock.mockResolvedValue(SETUP);
    verifyTotpMock.mockRejectedValue(new Error('CodeMismatchException'));
    render(<AdminMfaSetupPage />);

    await waitFor(() => expect(screen.getByTestId('qr')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /verify and enable/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/invalid or expired/i)
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows a recoverable error when setup cannot start (no session)', async () => {
    setUpTotpMock.mockRejectedValue(new Error('No active session'));
    render(<AdminMfaSetupPage />);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/could not start two-factor setup/i)
    );
    // No QR is rendered in the failure state.
    expect(screen.queryByTestId('qr')).toBeNull();
  });
});
