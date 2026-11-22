import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const resetPasswordMock = vi.fn();
const confirmResetPasswordMock = vi.fn();
vi.mock('aws-amplify/auth', () => ({
  resetPassword: (...a: unknown[]) => resetPasswordMock(...a),
  confirmResetPassword: (...a: unknown[]) => confirmResetPasswordMock(...a),
}));

import AdminResetPasswordPage from '../../app/(auth)/reset-password/page';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Admin reset password', () => {
  it('sends a code, then saves the new password typed into fresh fields', async () => {
    resetPasswordMock.mockResolvedValue({});
    confirmResetPasswordMock.mockResolvedValue(undefined);
    render(<AdminResetPasswordPage />);

    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'Admin@MerchOS.co.za' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));
    await waitFor(() => expect(resetPasswordMock).toHaveBeenCalledWith({ username: 'admin@merchos.co.za' }));

    await screen.findByRole('heading', { name: /enter your reset code/i });
    const code = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    const pw = screen.getByLabelText(/^new password/i) as HTMLInputElement;
    const again = screen.getByLabelText(/confirm new password/i) as HTMLInputElement;
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.change(pw, { target: { value: 'Brand-New-Pass1' } });
    fireEvent.change(again, { target: { value: 'Brand-New-Pass1' } });
    // Regression guard: fields keep what is typed.
    expect(code.value).toBe('123456');
    expect(pw.value).toBe('Brand-New-Pass1');

    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    await waitFor(() =>
      expect(confirmResetPasswordMock).toHaveBeenCalledWith({
        username: 'admin@merchos.co.za',
        confirmationCode: '123456',
        newPassword: 'Brand-New-Pass1',
      }),
    );
    await screen.findByRole('heading', { name: /password updated/i });
  });

  it('explains a wrong code in plain words', async () => {
    resetPasswordMock.mockResolvedValue({});
    confirmResetPasswordMock.mockRejectedValue(Object.assign(new Error('x'), { name: 'CodeMismatchException' }));
    render(<AdminResetPasswordPage />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'admin@merchos.co.za' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset code/i }));
    await screen.findByRole('heading', { name: /enter your reset code/i });
    fireEvent.change(screen.getByLabelText(/6-digit code/i), { target: { value: '000000' } });
    fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'Brand-New-Pass1' } });
    fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'Brand-New-Pass1' } });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/code is not right/i);
  });
});
