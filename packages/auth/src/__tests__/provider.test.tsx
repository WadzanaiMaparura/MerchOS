/**
 * Unit tests for AuthProvider's login / completeMfa flows.
 *
 * These exercise the branching in provider.tsx against a mocked
 * `aws-amplify/auth` so we cover: the TOTP challenge path, the SMS challenge
 * path, direct sign-in (no MFA), and completing an MFA challenge — including
 * that a successful sign-in hydrates the user/token/authenticated state from
 * the id-token claims.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// ─── Mock aws-amplify/auth ───────────────────────────────────────────────────

const signInMock = vi.fn();
const confirmSignInMock = vi.fn();
const signOutMock = vi.fn();
const fetchAuthSessionMock = vi.fn();

vi.mock('aws-amplify/auth', () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
  confirmSignIn: (...args: unknown[]) => confirmSignInMock(...args),
  signOut: (...args: unknown[]) => signOutMock(...args),
  fetchAuthSession: (...args: unknown[]) => fetchAuthSessionMock(...args),
}));

import { AuthProvider } from '../provider';
import { useAuth } from '../hooks';
import type { MfaChallengeResult } from '@merch-os/types';

// ─── Test harness ────────────────────────────────────────────────────────────

/**
 * A tiny consumer that drives the context methods via buttons and renders the
 * resulting auth state so assertions can read it from the DOM.
 */
function Harness({ onLoginResult }: { onLoginResult?: (r: MfaChallengeResult | void) => void }) {
  const { login, completeMfa, user, isAuthenticated, accessToken } = useAuth();
  return (
    <div>
      <button onClick={async () => onLoginResult?.(await login('seller@example.com', 'pw'))}>
        login
      </button>
      <button onClick={() => completeMfa('123456')}>completeMfa</button>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <span data-testid="email">{user?.email ?? ''}</span>
      <span data-testid="token">{accessToken ?? ''}</span>
    </div>
  );
}

function sessionWith(claims: Record<string, unknown>, token = 'access-tkn') {
  return {
    tokens: {
      idToken: { payload: claims },
      accessToken: { toString: () => token },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing session on mount (loadSession resolves to no tokens).
  fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });
});

async function renderHarness(onLoginResult?: (r: MfaChallengeResult | void) => void) {
  render(
    <AuthProvider>
      <Harness onLoginResult={onLoginResult} />
    </AuthProvider>
  );
  // Let the mount-time loadSession() effect settle.
  await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('false'));
}

describe('AuthProvider.login', () => {
  it('returns a TOTP challenge when Cognito requires one', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' },
    });

    let result: MfaChallengeResult | void | 'unset' = 'unset';
    await renderHarness((r) => (result = r));
    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() => expect(result).toBeTruthy());
    expect(result).toEqual({ challengeType: 'TOTP', session: 'seller@example.com' });
    // Not signed in yet — still awaiting the second factor.
    expect(screen.getByTestId('authed').textContent).toBe('false');
  });

  it('returns an SMS challenge when Cognito requires one', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_SMS_CODE' },
    });

    let result: MfaChallengeResult | void | 'unset' = 'unset';
    await renderHarness((r) => (result = r));
    await act(async () => {
      screen.getByText('login').click();
    });

    await waitFor(() => expect(result).toBeTruthy());
    expect(result).toEqual({ challengeType: 'SMS', session: 'seller@example.com' });
  });

  it('completes sign-in with no MFA and hydrates user + token from claims', async () => {
    signInMock.mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' },
    });
    fetchAuthSessionMock.mockResolvedValue(
      sessionWith(
        { sub: 'u-1', email: 'seller@example.com', 'custom:tenantId': 't-1', 'custom:role': 'editor' },
        'tok-abc'
      )
    );

    let result: MfaChallengeResult | void = { challengeType: 'TOTP', session: 'x' };
    await renderHarness((r) => (result = r));
    await act(async () => {
      screen.getByText('login').click();
    });

    // No challenge returned for a completed sign-in.
    await waitFor(() => expect(result).toBeUndefined());
    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('true'));
    expect(screen.getByTestId('email').textContent).toBe('seller@example.com');
    expect(screen.getByTestId('token').textContent).toBe('tok-abc');
  });

  it('propagates invalid-credential errors from signIn', async () => {
    signInMock.mockRejectedValue(new Error('NotAuthorizedException'));

    // Capture the context's login fn so we can await its rejection directly.
    let loginFn: ((e: string, p: string) => Promise<unknown>) | undefined;
    function Capture() {
      const { login } = useAuth();
      loginFn = login;
      return null;
    }
    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>
    );
    await waitFor(() => expect(loginFn).toBeTypeOf('function'));

    await expect(loginFn!('seller@example.com', 'wrong')).rejects.toThrow('NotAuthorizedException');
    expect(signInMock).toHaveBeenCalledTimes(1);
  });
});

describe('AuthProvider.completeMfa', () => {
  it('establishes the session when the code is accepted', async () => {
    confirmSignInMock.mockResolvedValue({ isSignedIn: true });
    fetchAuthSessionMock.mockResolvedValue(
      sessionWith(
        { sub: 'u-2', email: 'mfa@example.com', 'custom:tenantId': 't-2', 'custom:role': 'admin' },
        'tok-mfa'
      )
    );

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('completeMfa').click();
    });

    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('true'));
    expect(confirmSignInMock).toHaveBeenCalledWith({ challengeResponse: '123456' });
    expect(screen.getByTestId('email').textContent).toBe('mfa@example.com');
    expect(screen.getByTestId('token').textContent).toBe('tok-mfa');
  });

  it('does not authenticate when confirmSignIn reports not signed in', async () => {
    confirmSignInMock.mockResolvedValue({ isSignedIn: false });

    render(
      <AuthProvider>
        <Harness />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('authed').textContent).toBe('false'));

    await act(async () => {
      screen.getByText('completeMfa').click();
    });

    // Still unauthenticated; no session fetch for user hydration beyond mount.
    expect(screen.getByTestId('authed').textContent).toBe('false');
  });
});
