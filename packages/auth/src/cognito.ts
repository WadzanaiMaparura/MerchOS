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
    // Enable username/password sign-in (SRP) in addition to any OAuth flow.
    loginWith: {
      username: true,
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
  organisationName: string;
  contactEmail: string;
}

/**
 * Register a new seller account via Cognito.
 * Creates the account and triggers email verification.
 */
export async function cognitoSignUp({ email, password }: SignUpParams): Promise<{ isSignUpComplete: boolean; userId?: string }> {
  // NOTE: organisationName and contactEmail are intentionally NOT sent to
  // Cognito. The user pool schema only defines custom:tenantId and custom:role
  // (set by the PreSignUp trigger); custom:organisationName and
  // custom:contactEmail are not declared, so sending them makes Cognito reject
  // the sign-up ("Type for attribute {custom:contactEmail} could not be
  // determined"). The standard `email` attribute covers the contact email, and
  // the tenant record name is derived in the PostConfirmation trigger. The
  // SignUpParams signature is kept intact so the registration form is unchanged.
  const result = await amplifySignUp({
    username: email,
    password,
    options: {
      userAttributes: {
        email,
      },
    },
  });

  return {
    isSignUpComplete: result.isSignUpComplete,
    userId: result.userId,
  };
}

/**
 * Confirm email verification code after registration.
 */
export async function cognitoConfirmSignUp(email: string, code: string): Promise<{ isSignUpComplete: boolean }> {
  const result = await amplifyConfirmSignUp({
    username: email,
    confirmationCode: code,
  });

  return {
    isSignUpComplete: result.isSignUpComplete,
  };
}
