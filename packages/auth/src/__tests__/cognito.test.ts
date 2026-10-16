import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Amplify Auth module so no real network/Cognito call is made.
const signUpMock = vi.fn();
const confirmSignUpMock = vi.fn();

vi.mock('@aws-amplify/auth', () => ({
  signUp: (...args: unknown[]) => signUpMock(...args),
  confirmSignUp: (...args: unknown[]) => confirmSignUpMock(...args),
}));

// Mock the @aws-amplify/core singleton's Amplify.configure to avoid real
// side effects and to assert the configuration shape used for SRP sign-in.
const configureMock = vi.fn();
vi.mock('@aws-amplify/core', () => ({
  Amplify: { configure: (...args: unknown[]) => configureMock(...args) },
}));

import { cognitoSignUp, configureCognitoAuth } from '../cognito';

describe('cognitoSignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signUpMock.mockResolvedValue({ isSignUpComplete: false, userId: 'user-123' });
  });

  it('sends only the standard `email` attribute to Cognito (no undefined custom attributes)', async () => {
    await cognitoSignUp({
      email: 'seller@example.com',
      password: 'Sup3rSecret!pw12',
      organisationName: 'Acme Trading Co',
      contactEmail: 'contact@example.com',
    });

    expect(signUpMock).toHaveBeenCalledTimes(1);

    const arg = signUpMock.mock.calls[0][0] as {
      username: string;
      password: string;
      options: { userAttributes: Record<string, string> };
    };

    const userAttributes = arg.options.userAttributes;

    // The ONLY attribute that may be sent is the standard `email`.
    expect(Object.keys(userAttributes)).toEqual(['email']);
    expect(userAttributes.email).toBe('seller@example.com');

    // Explicitly assert the previously-failing custom attributes are gone.
    expect(userAttributes).not.toHaveProperty('custom:organisationName');
    expect(userAttributes).not.toHaveProperty('custom:contactEmail');

    // Username and password are still forwarded.
    expect(arg.username).toBe('seller@example.com');
    expect(arg.password).toBe('Sup3rSecret!pw12');
  });

  it('returns the Amplify sign-up result', async () => {
    signUpMock.mockResolvedValue({ isSignUpComplete: true, userId: 'user-456' });

    const result = await cognitoSignUp({
      email: 'seller2@example.com',
      password: 'An0ther!pass_word',
      organisationName: 'Org',
      contactEmail: 'c@example.com',
    });

    expect(result).toEqual({ isSignUpComplete: true, userId: 'user-456' });
  });
});

describe('configureCognitoAuth (SRP login regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configures Cognito with username/password SRP enabled (not OAuth-only)', () => {
    configureCognitoAuth({
      userPoolId: 'eu-west-1_pool',
      userPoolClientId: 'client123',
      domain: 'merchos.auth.eu-west-1.amazoncognito.com',
      redirectSignIn: 'https://merchos.co.za/callback',
      redirectSignOut: 'https://merchos.co.za/login',
    });

    expect(configureMock).toHaveBeenCalledTimes(1);
    const cfg = configureMock.mock.calls[0][0] as {
      Auth: { Cognito: Record<string, unknown> };
    };
    const cognito = cfg.Auth.Cognito as {
      userPoolId: string;
      userPoolClientId: string;
      signUpVerificationMethod: string;
      loginWith: { username?: boolean; oauth?: Record<string, unknown> };
    };

    expect(cognito.userPoolId).toBe('eu-west-1_pool');
    expect(cognito.userPoolClientId).toBe('client123');
    // Username/password SRP sign-in must be enabled — the missing piece that
    // left RespondToAuthChallenge unable to complete in production.
    expect(cognito.loginWith.username).toBe(true);
    expect(cognito.signUpVerificationMethod).toBe('code');
    // OAuth block present only when a domain is configured.
    expect(cognito.loginWith.oauth).toBeDefined();
    expect((cognito.loginWith.oauth as Record<string, unknown>)['domain']).toBe(
      'merchos.auth.eu-west-1.amazoncognito.com',
    );
  });

  it('omits the OAuth block entirely when no domain is configured (invalid empty-domain oauth must not break SRP)', () => {
    configureCognitoAuth({
      userPoolId: 'eu-west-1_pool',
      userPoolClientId: 'client123',
      domain: '',
      redirectSignIn: 'https://merchos.co.za/callback',
      redirectSignOut: 'https://merchos.co.za/login',
    });

    const cfg = configureMock.mock.calls[0][0] as {
      Auth: { Cognito: { loginWith: { username?: boolean; oauth?: unknown } } };
    };
    expect(cfg.Auth.Cognito.loginWith.username).toBe(true);
    expect(cfg.Auth.Cognito.loginWith.oauth).toBeUndefined();
  });
});
