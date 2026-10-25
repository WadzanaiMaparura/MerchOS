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

import { cognitoSignUp, cognitoConfirmSignUp } from '../cognito';

describe('cognitoSignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signUpMock.mockResolvedValue({ isSignUpComplete: false, userId: 'user-123' });
  });

  it('sends only the standard `email` attribute to Cognito (no undefined custom attributes)', async () => {
    await cognitoSignUp({
      email: 'seller@example.com',
      password: 'Sup3rSecret!pw12',
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
    });

    expect(result).toEqual({ isSignUpComplete: true, userId: 'user-456' });
  });

  it('passes registrationId to Amplify as options.clientMetadata.registrationId', async () => {
    await cognitoSignUp({
      email: 'seller@example.com',
      password: 'Sup3rSecret!pw12',
      registrationId: 'reg-abc',
    });

    const arg = signUpMock.mock.calls[0][0] as {
      options: {
        userAttributes: Record<string, string>;
        clientMetadata?: Record<string, string>;
      };
    };
    expect(arg.options.clientMetadata).toEqual({ registrationId: 'reg-abc' });
    // Profile fields must never become Cognito user attributes.
    expect(Object.keys(arg.options.userAttributes)).toEqual(['email']);
  });

  it('omits clientMetadata entirely when no registrationId is given', async () => {
    await cognitoSignUp({ email: 'seller@example.com', password: 'Sup3rSecret!pw12' });

    const arg = signUpMock.mock.calls[0][0] as {
      options: { clientMetadata?: Record<string, string> };
    };
    expect(arg.options.clientMetadata).toBeUndefined();
  });
});

describe('cognitoConfirmSignUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmSignUpMock.mockResolvedValue({ isSignUpComplete: true });
  });

  it('passes registrationId to Amplify as options.clientMetadata.registrationId', async () => {
    await cognitoConfirmSignUp('seller@example.com', '123456', 'reg-abc');

    expect(confirmSignUpMock).toHaveBeenCalledTimes(1);
    const arg = confirmSignUpMock.mock.calls[0][0] as {
      username: string;
      confirmationCode: string;
      options?: { clientMetadata?: Record<string, string> };
    };
    expect(arg.username).toBe('seller@example.com');
    expect(arg.confirmationCode).toBe('123456');
    expect(arg.options?.clientMetadata).toEqual({ registrationId: 'reg-abc' });
  });

  it('uses the SAME registrationId as the sign-up call (round-trip)', async () => {
    const regId = 'reg-roundtrip-xyz';
    await cognitoSignUp({ email: 'a@b.com', password: 'Sup3rSecret!pw12', registrationId: regId });
    await cognitoConfirmSignUp('a@b.com', '000000', regId);

    const signUpArg = signUpMock.mock.calls[0][0] as {
      options: { clientMetadata?: Record<string, string> };
    };
    const confirmArg = confirmSignUpMock.mock.calls[0][0] as {
      options?: { clientMetadata?: Record<string, string> };
    };
    expect(signUpArg.options.clientMetadata?.registrationId).toBe(regId);
    expect(confirmArg.options?.clientMetadata?.registrationId).toBe(regId);
  });

  it('omits clientMetadata when no registrationId is given', async () => {
    await cognitoConfirmSignUp('seller@example.com', '123456');
    const arg = confirmSignUpMock.mock.calls[0][0] as {
      options?: { clientMetadata?: Record<string, string> };
    };
    expect(arg.options).toBeUndefined();
  });
});
