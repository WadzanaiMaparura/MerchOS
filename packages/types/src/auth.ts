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

/**
 * Details needed to enroll a TOTP authenticator app, returned when a user
 * begins MFA setup.
 */
export interface TotpSetupDetails {
  /** Base32 shared secret, for manual ("can't scan the code") entry. */
  sharedSecret: string;
  /**
   * otpauth:// URI encoding issuer, account and secret — render this as a QR
   * code for the authenticator app to scan.
   */
  setupUri: string;
}

/** Auth context value exposed to consuming components. */
export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<MfaChallengeResult | void>;
  completeMfa: (code: string) => Promise<void>;
  /**
   * Begin TOTP enrollment for the currently signed-in user. Returns the shared
   * secret and an otpauth:// setup URI for QR rendering. Requires an active
   * session (the user must have completed password auth).
   */
  setUpTotp: () => Promise<TotpSetupDetails>;
  /**
   * Complete TOTP enrollment by verifying a code from the authenticator app,
   * then mark TOTP as the preferred second factor. Rejects on an invalid code.
   */
  verifyTotp: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string>; // returns new access token
}
