/**
 * Cognito configuration and helpers for MerchOS tenant pool authentication.
 * Uses @aws-amplify/auth v6 with SRP + PKCE flow.
 */

// Configure via @aws-amplify/core's shared Amplify singleton — the same
// singleton that @aws-amplify/auth's signIn/signUp read. (The aggregated
// `aws-amplify` package is only a convenience re-export of this singleton and
// is intentionally NOT used, to avoid pulling a second, version-mismatched
// copy of @aws-amplify/core into the bundle.)
import { Amplify } from '@aws-amplify/core';
import { signUp as amplifySignUp, confirmSignUp as amplifyConfirmSignUp } from '@aws-amplify/auth';

export interface CognitoConfig {
  userPoolId: string;
  userPoolClientId: string;
  domain: string;
  redirectSignIn: string;
  redirectSignOut: string;
}

/**
 * Default configuration sourced from environment variables.
 * These are injected at build time via Next.js environment variable support.
 */
export const defaultCognitoConfig: CognitoConfig = {
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
  userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
  domain: process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '',
  redirectSignIn: process.env.NEXT_PUBLIC_REDIRECT_SIGN_IN ?? 'http://localhost:3000/callback',
  redirectSignOut: process.env.NEXT_PUBLIC_REDIRECT_SIGN_OUT ?? 'http://localhost:3000/login',
};

/**
 * Configure Amplify Auth for the tenant user pool with PKCE.
 * Must be called once at app startup (e.g., in root layout or _app).
 */
export function configureCognitoAuth(config: CognitoConfig = defaultCognitoConfig): void {
  // Only declare the OAuth (hosted-UI) block when a domain is actually
  // configured. An oauth block with an empty `domain` is invalid and can
  // interfere with the username/password SRP flow the seller app relies on.
  const cognito: Record<string, unknown> = {
    userPoolId: config.userPoolId,
    userPoolClientId: config.userPoolClientId,
    // Sign-up email verification is code-based (matches the /verify flow).
    signUpVerificationMethod: 'code',
    // Enable EMAIL sign-in (SRP) to match the Cognito pool, which is configured
    // with signInAliases: { email: true } (see infrastructure/lib/auth-stack.ts),
    // and the login page accepts an email address. This is in addition to any
    // OAuth flow.
    loginWith: {
      email: true,
    } as Record<string, unknown>,
  };

  if (config.domain) {
    (cognito['loginWith'] as Record<string, unknown>)['oauth'] = {
      domain: config.domain,
      scopes: ['openid', 'email', 'profile'],
      redirectSignIn: [config.redirectSignIn],
      redirectSignOut: [config.redirectSignOut],
      responseType: 'code', // PKCE flow
    };
  }

  Amplify.configure({
    Auth: {
      Cognito: cognito,
    },
  } as Parameters<typeof Amplify.configure>[0]);
}

export interface SignUpParams {
  email: string;
  password: string;
  /**
   * Opaque, server-generated pending-registration id. Forwarded to Cognito as
   * clientMetadata so the PostConfirmation trigger can resolve the exact
   * pending-registration record (by id) and assign the trusted tenant/role.
   * It is NOT a user attribute and is never persisted on the Cognito user.
   */
  registrationId?: string;
}

/**
 * Register a new seller account via Cognito.
 * Creates the account and triggers email verification.
 *
 * Only the standard `email` attribute (plus password) is sent to Cognito. The
 * user pool schema defines just custom:tenantId and custom:role (set by the
 * triggers); any other custom attribute would be rejected.
 *
 * Additional registration details (full name, phone, organisation name,
 * marketing consent) are NOT sent here — they live in the server-side
 * pending-registration record. We pass only the opaque `registrationId` via
 * clientMetadata so PostConfirmation can correlate the verified identity with
 * that record.
 */
export async function cognitoSignUp({ email, password, registrationId }: SignUpParams): Promise<{ isSignUpComplete: boolean; userId?: string }> {
  const result = await amplifySignUp({
    username: email,
    password,
    options: {
      userAttributes: {
        email,
      },
      // clientMetadata is passed to the Lambda triggers; it is transient and
      // never stored as a user attribute.
      ...(registrationId ? { clientMetadata: { registrationId } } : {}),
    },
  });

  return {
    isSignUpComplete: result.isSignUpComplete,
    userId: result.userId,
  };
}

/**
 * Confirm email verification code after registration.
 *
 * The same `registrationId` supplied at sign-up is forwarded again via
 * clientMetadata so the PostConfirmation trigger (which runs on ConfirmSignUp)
 * can resolve the exact pending-registration record for the now-verified user.
 */
export async function cognitoConfirmSignUp(
  email: string,
  code: string,
  registrationId?: string,
): Promise<{ isSignUpComplete: boolean }> {
  const result = await amplifyConfirmSignUp({
    username: email,
    confirmationCode: code,
    ...(registrationId
      ? { options: { clientMetadata: { registrationId } } }
      : {}),
  });

  return {
    isSignUpComplete: result.isSignUpComplete,
  };
}
