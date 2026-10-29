'use client';

/**
 * AuthProvider — React context provider managing authentication state.
 * Wraps the app and provides login, logout, refreshSession, and completeMfa
 * methods via the AuthContextValue interface.
 */

import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  signIn,
  signOut,
  fetchAuthSession,
  confirmSignIn,
  setUpTOTP,
  verifyTOTPSetup,
  updateMFAPreference,
  getCurrentUser,
} from 'aws-amplify/auth';
import type { AuthContextValue, AuthUser, MfaChallengeResult, TotpSetupDetails } from '@merch-os/types';
import type { SellerRole } from '@merch-os/types';

export const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

/** Maximum time allowed for a silent token refresh (ms). */
const REFRESH_TIMEOUT_MS = 3000;

/**
 * Extract AuthUser from Cognito session JWT claims.
 */
function extractUserFromToken(idTokenPayload: Record<string, unknown>): AuthUser {
  return {
    userId: (idTokenPayload['sub'] as string) ?? '',
    email: (idTokenPayload['email'] as string) ?? '',
    tenantId: (idTokenPayload['custom:tenantId'] as string) ?? '',
    role: (idTokenPayload['custom:role'] as SellerRole) ?? 'viewer',
    givenName: idTokenPayload['given_name'] as string | undefined,
    familyName: idTokenPayload['family_name'] as string | undefined,
  };
}

/**
 * Clears all stored session data from the browser.
 */
function clearSessionData(): void {
  if (typeof window === 'undefined') return;
  // Clear Amplify-related storage
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('CognitoIdentityServiceProvider') || key.startsWith('amplify'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  // Also clear session storage
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && (key.startsWith('CognitoIdentityServiceProvider') || key.startsWith('amplify'))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => sessionStorage.removeItem(key));
}

/**
 * Redirects to the login page.
 */
function redirectToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

export function AuthProvider({ children }: AuthProviderProps): React.ReactElement {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // Store the pending MFA sign-in session for completeMfa
  const pendingSignInRef = useRef<string | null>(null);

  /**
   * Attempt to load the existing session on mount.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const session = await fetchAuthSession();
        if (cancelled) return;

        const idToken = session.tokens?.idToken;
        const accessTkn = session.tokens?.accessToken;

        if (idToken && accessTkn) {
          const payload = idToken.payload as Record<string, unknown>;
          setUser(extractUserFromToken(payload));
          setAccessToken(accessTkn.toString());
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setAccessToken(null);
          setIsAuthenticated(false);
        }
      } catch {
        if (cancelled) return;
        setUser(null);
        setAccessToken(null);
        setIsAuthenticated(false);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSession();
    return () => { cancelled = true; };
  }, []);

  /**
   * Login using SRP + PKCE flow via Cognito.
   * Returns MfaChallengeResult if MFA is required, otherwise void on success.
   */
  const login = useCallback(async (email: string, password: string): Promise<MfaChallengeResult | void> => {
    // Amplify v6 rejects signIn() with UserAlreadyAuthenticatedException when a
    // user is already signed in (e.g. a prior successful sign-in whose redirect
    // didn't complete, or a stale session left in storage). This surfaced as a
    // misleading "Invalid email or password" on the second attempt. Clear any
    // existing session first so every login starts from a clean state.
    try {
      await getCurrentUser();
      // A user is already authenticated — sign them out before re-authenticating.
      await signOut();
    } catch {
      // getCurrentUser throws when nobody is signed in — the normal, expected
      // case. Nothing to clear; proceed to signIn.
    }

    const result = await signIn({
      username: email,
      password,
      options: {
        authFlowType: 'USER_SRP_AUTH',
      },
    });

    // Check if MFA challenge is required
    if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_TOTP_CODE') {
      pendingSignInRef.current = email;
      return {
        challengeType: 'TOTP',
        session: email,
      };
    }

    if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_SMS_CODE') {
      pendingSignInRef.current = email;
      return {
        challengeType: 'SMS',
        session: email,
      };
    }

    if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_EMAIL_CODE') {
      pendingSignInRef.current = email;
      return {
        challengeType: 'EMAIL',
        session: email,
      };
    }

    // Auth completed — load session
    if (result.isSignedIn) {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      const accessTkn = session.tokens?.accessToken;

      if (idToken && accessTkn) {
        const payload = idToken.payload as Record<string, unknown>;
        setUser(extractUserFromToken(payload));
        setAccessToken(accessTkn.toString());
        setIsAuthenticated(true);
      }
    }
  }, []);

  /**
   * Complete MFA challenge by submitting the code.
   */
  const completeMfa = useCallback(async (code: string): Promise<void> => {
    const result = await confirmSignIn({ challengeResponse: code });

    if (result.isSignedIn) {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      const accessTkn = session.tokens?.accessToken;

      if (idToken && accessTkn) {
        const payload = idToken.payload as Record<string, unknown>;
        setUser(extractUserFromToken(payload));
        setAccessToken(accessTkn.toString());
        setIsAuthenticated(true);
      } else {
        // confirmSignIn reported signed-in but no tokens were readable from the
        // session — surface this rather than silently resolving (which would
        // let the caller redirect to a protected route with no session).
        throw new Error('MFA confirmed but no session tokens were returned');
      }
      pendingSignInRef.current = null;
    } else {
      // Not signed in and Amplify did not throw — the challenge did not
      // complete. Surface it rather than resolving into a redirect loop.
      const step = result.nextStep?.signInStep ?? 'UNKNOWN';
      throw new Error(`MFA not completed (nextStep=${step})`);
    }
  }, []);

  /**
   * Logout — revoke session, clear tokens, redirect to login.
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await signOut({ global: true });
    } catch {
      // Even if revocation fails, clear local state
    }

    setUser(null);
    setAccessToken(null);
    setIsAuthenticated(false);
    clearSessionData();
    redirectToLogin();
  }, []);

  /**
   * Silently refresh the access token. Must complete within 3 seconds.
   * If refresh token is invalid/expired, clear session and redirect to login.
   */
  const refreshSession = useCallback(async (): Promise<string> => {
    const refreshPromise = (async () => {
      try {
        const session = await fetchAuthSession({ forceRefresh: true });
        const idToken = session.tokens?.idToken;
        const accessTkn = session.tokens?.accessToken;

        if (!accessTkn || !idToken) {
          throw new Error('No tokens returned from refresh');
        }

        const payload = idToken.payload as Record<string, unknown>;
        setUser(extractUserFromToken(payload));
        const newToken = accessTkn.toString();
        setAccessToken(newToken);
        setIsAuthenticated(true);
        return newToken;
      } catch {
        // Refresh token expired or invalid — clear session and redirect
        setUser(null);
        setAccessToken(null);
        setIsAuthenticated(false);
        clearSessionData();
        redirectToLogin();
        throw new Error('Session expired');
      }
    })();

    // Enforce 3 second timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Token refresh timed out')), REFRESH_TIMEOUT_MS);
    });

    return Promise.race([refreshPromise, timeoutPromise]);
  }, []);

  /**
   * Begin TOTP enrollment for the signed-in user.
   * Returns the base32 shared secret (manual entry) and an otpauth:// URI to
   * render as a QR code. Issuer is fixed to "MerchOS"; the account label uses
   * the user's email when known so the authenticator entry is identifiable.
   */
  const setUpTotp = useCallback(async (): Promise<TotpSetupDetails> => {
    const totpSetupDetails = await setUpTOTP();
    const accountName = user?.email ?? 'account';
    const setupUri = totpSetupDetails.getSetupUri('MerchOS', accountName);
    return {
      sharedSecret: totpSetupDetails.sharedSecret,
      setupUri: setupUri.toString(),
    };
  }, [user]);

  /**
   * Complete TOTP enrollment: verify the authenticator code, then mark TOTP as
   * the preferred second factor so subsequent logins challenge for it.
   * Rejects on an invalid/expired code.
   */
  const verifyTotp = useCallback(async (code: string): Promise<void> => {
    await verifyTOTPSetup({ code });
    await updateMFAPreference({ totp: 'PREFERRED' });
  }, []);

  /**
   * Enable email OTP as the signed-in user's preferred second factor.
   * The seller's email is already verified at registration, so there is no
   * QR/secret enrollment step — we simply set the Cognito MFA preference so
   * subsequent logins issue a CONFIRM_SIGN_IN_WITH_EMAIL_CODE challenge.
   */
  const enableEmailMfa = useCallback(async (): Promise<void> => {
    await updateMFAPreference({ email: 'PREFERRED' });
  }, []);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      accessToken,
      login,
      completeMfa,
      setUpTotp,
      verifyTotp,
      enableEmailMfa,
      logout,
      refreshSession,
    }),
    [user, isAuthenticated, isLoading, accessToken, login, completeMfa, setUpTotp, verifyTotp, enableEmailMfa, logout, refreshSession]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
