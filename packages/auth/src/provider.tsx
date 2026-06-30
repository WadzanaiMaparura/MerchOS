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
} from '@aws-amplify/auth';
import type { AuthContextValue, AuthUser, MfaChallengeResult } from '@merch-os/types';
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
      }
      pendingSignInRef.current = null;
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

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated,
      isLoading,
      accessToken,
      login,
      completeMfa,
      logout,
      refreshSession,
    }),
    [user, isAuthenticated, isLoading, accessToken, login, completeMfa, logout, refreshSession]
  );

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}
