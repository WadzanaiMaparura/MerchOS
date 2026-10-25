/**
 * Cognito configuration and helpers for MerchOS tenant pool authentication.
 * Uses Amplify Auth v6 with SRP + PKCE flow.
 */

// Configure and call Amplify Auth exclusively through the aggregated
// `aws-amplify` package. `aws-amplify` (Amplify.configure) and
// `aws-amplify/auth` (signIn/signUp/etc.) are guaranteed by Amplify to share
// the SAME internal @aws-amplify/core singleton. Importing the scoped
// @aws-amplify/core and @aws-amplify/auth packages directly can bind two
// separate Core module instances under a bundler (Next.js + transpilePackages),
// so Amplify.configure() writes to one instance while signIn() reads an empty
// one — surfacing as "AuthUserPoolException: Auth UserPool not configured."
// Routing everything through the aggregate package eliminates that split.
import { Amplify } from 'aws-amplify';
import { signUp as amplifySignUp, confirmSignUp as amplifyConfirmSignUp } from 'aws-amplify/auth';

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
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: {
          oauth: {
            domain: config.domain,
            scopes: ['openid', 'email', 'profile'],
            redirectSignIn: [config.redirectSignIn],
            redirectSignOut: [config.redirectSignOut],
            responseType: 'code', // PKCE flow
          },
        },
      },
    },
  });
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
export async function cognitoSignUp({ email, password, organisationName, contactEmail }: SignUpParams): Promise<{ isSignUpComplete: boolean; userId?: string }> {
  const result = await amplifySignUp({
    username: email,
    password,
    options: {
      userAttributes: {
        email,
        'custom:organisationName': organisationName,
        'custom:contactEmail': contactEmail,
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
