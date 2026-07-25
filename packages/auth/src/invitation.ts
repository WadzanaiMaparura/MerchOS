/**
 * Invitation acceptance flow for MerchOS.
 * Handles the NEW_PASSWORD_REQUIRED challenge when an invited user
 * signs in with their temporary password for the first time.
 */

import { signIn, confirmSignIn } from '@aws-amplify/auth';

export interface AcceptInvitationParams {
  email: string;
  temporaryPassword: string;
  newPassword: string;
}

/**
 * Accept a tenant invitation by signing in with the temporary password
 * and completing the NEW_PASSWORD_REQUIRED challenge with a new password.
 *
 * Flow:
 * 1. Sign in with temporary credentials (triggers NEW_PASSWORD_REQUIRED)
 * 2. Submit new password via confirmSignIn
 */
export async function acceptInvitation(params: AcceptInvitationParams): Promise<{ isSuccess: boolean }> {
  const { email, temporaryPassword, newPassword } = params;

  try {
    const signInResult = await signIn({
      username: email,
      password: temporaryPassword,
    });

    // Expect the NEW_PASSWORD_REQUIRED challenge for invited users
    if (signInResult.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
      await confirmSignIn({ challengeResponse: newPassword });
      return { isSuccess: true };
    }

    // If already signed in without challenge (unexpected but valid)
    if (signInResult.isSignedIn) {
      return { isSuccess: true };
    }

    throw new Error('Unexpected sign-in step during invitation acceptance');
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unexpected sign-in step')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Failed to accept invitation';
    throw new Error(`Invitation acceptance failed: ${message}`);
  }
}
