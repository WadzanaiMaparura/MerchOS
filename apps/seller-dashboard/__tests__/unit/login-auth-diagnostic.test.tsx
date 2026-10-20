// Focused tests for the TEMPORARY login auth diagnostic logging.
//
// Proves that when the auth `login` call throws, the login page:
//   1. Surfaces ONLY safe diagnostic fields (name, message, code) via a
//      console.error tagged with the "[MerchOS Auth Diagnostic]" prefix.
//   2. Preserves the existing generic, non-enumerating user-facing message.
//   3. Does NOT log sensitive material (password, email, tokens, SRP values,
//      challenge parameters, secret blocks) or the raw error object.
//
// These tests pin the diagnostic behavior added to reveal the hidden Amplify
// PASSWORD_VERIFIER exception without changing authentication behavior.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/navigation so the page can render/submit without a real router.
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Mock the auth module so we control exactly what `login` does.
const loginMock = vi.fn();
vi.mock('@merch-os/auth', () => ({
  useAuth: () => ({ login: loginMock }),
}));

import LoginPage from '@/app/(auth)/login/page';

const GENERIC_MESSAGE = 'Invalid email or password. Please try again.';
const DIAGNOSTIC_PREFIX = '[MerchOS Auth Diagnostic]';

const CREDENTIALS = {
  email: 'seller@example.com',
  password: 'Sup3rSecret!pw12',
};

async function submitLogin(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/email address/i), CREDENTIALS.email);
  await user.type(screen.getByLabelText(/password/i), CREDENTIALS.password);
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('Login page — temporary auth diagnostic logging', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('logs ONLY the safe diagnostic fields with the diagnostic prefix on auth failure', async () => {
    const authError = Object.assign(
      new Error('USER_ID_FOR_SRP was not found in challengeParameters'),
      { name: 'EmptyUserIdForSRPException', code: 'EmptyUserIdForSRPException' },
    );
    loginMock.mockRejectedValue(authError);

    const user = userEvent.setup();
    render(<LoginPage />);
    await submitLogin(user);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));

    const [prefix, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(prefix).toBe(DIAGNOSTIC_PREFIX);
    expect(payload).toEqual({
      name: 'EmptyUserIdForSRPException',
      message: 'USER_ID_FOR_SRP was not found in challengeParameters',
      code: 'EmptyUserIdForSRPException',
    });

    // The logged payload must contain ONLY the three safe keys.
    expect(Object.keys(payload).sort()).toEqual(['code', 'message', 'name']);
  });

  it('still shows the generic, non-enumerating message to the user on auth failure', async () => {
    loginMock.mockRejectedValue(
      Object.assign(new Error('boom'), { name: 'NotAuthorizedException' }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await submitLogin(user);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(GENERIC_MESSAGE);
    // Must not navigate away on failure.
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('omits fields that are absent on the error and never logs sensitive data', async () => {
    // Error with no `code` property — the diagnostic must not invent one, and
    // must never echo the credentials.
    loginMock.mockRejectedValue(
      Object.assign(new Error('Network Error'), { name: 'NetworkError' }),
    );

    const user = userEvent.setup();
    render(<LoginPage />);
    await submitLogin(user);

    await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));

    const [, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload).toEqual({
      name: 'NetworkError',
      message: 'Network Error',
      code: undefined,
    });

    // Nothing logged across ALL console.error calls may contain credentials.
    const serialized = JSON.stringify(errorSpy.mock.calls);
    expect(serialized).not.toContain(CREDENTIALS.password);
    expect(serialized).not.toContain(CREDENTIALS.email);
  });

  it('does NOT log a diagnostic on successful login', async () => {
    loginMock.mockResolvedValue(undefined);

    const user = userEvent.setup();
    render(<LoginPage />);
    await submitLogin(user);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));

    const diagnosticCalls = errorSpy.mock.calls.filter(
      (call) => call[0] === DIAGNOSTIC_PREFIX,
    );
    expect(diagnosticCalls).toHaveLength(0);
  });
});
