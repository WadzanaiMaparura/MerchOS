import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

const confirmMock = vi.fn();
vi.mock('@merch-os/auth', () => ({
  cognitoConfirmSignUp: (...args: unknown[]) => confirmMock(...args),
}));

import VerifyPage from '@/app/(auth)/verify/page';

async function enterCodeAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/verification code/i), '123456');
  await user.click(screen.getByRole('button', { name: /verify email/i }));
}

describe('Verify page — registrationId handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockResolvedValue({ isSignUpComplete: true });
  });

  it('passes the SAME registrationId from the URL into cognitoConfirmSignUp', async () => {
    searchParams = new URLSearchParams({ email: 'ada@example.com', registrationId: 'reg-xyz' });
    render(<VerifyPage />);
    await enterCodeAndSubmit();

    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock).toHaveBeenCalledWith('ada@example.com', '123456', 'reg-xyz');
  });

  it('does NOT confirm (and shows an error) when registrationId is missing', async () => {
    searchParams = new URLSearchParams({ email: 'ada@example.com' }); // no registrationId
    render(<VerifyPage />);
    await enterCodeAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/registration link is incomplete/i);
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
