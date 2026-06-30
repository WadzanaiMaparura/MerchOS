/**
 * Authentication and session types for the MerchOS frontend.
 */

import { SellerRole } from './common';

/** Authenticated seller user information extracted from the session. */
export interface AuthUser {
  userId: string;
  email: string;
  tenantId: string;
  role: SellerRole;
  givenName?: string;
  familyName?: string;
}

/** Current authentication state. */
export interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
}

/** MFA challenge result returned when login requires a second factor. */
export interface MfaChallengeResult {
  challengeType: 'TOTP' | 'SMS';
  session: string;
}

/** Auth context value exposed to consuming components. */
export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<MfaChallengeResult | void>;
  completeMfa: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string>; // returns new access token
}
