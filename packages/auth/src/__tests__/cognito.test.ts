import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Amplify Auth module so no real network/Cognito call is made.
const signUpMock = vi.fn();
const confirmSignUpMock = vi.fn();

vi.mock('@aws-amplify/auth', () => ({
  signUp: (...args: unknown[]) => signUpMock(...args),
  confirmSignUp: (...args: unknown[]) => confirmSignUpMock(...args),
}));

// Mock the core module to avoid Amplify.configure side effects on import.
vi.mock('@aws-amplify/core', () => ({
  Amplify: { configure: vi.fn() },
}));

import { cognitoSignUp } from '../cognito';

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
