/**
 * Password reset flows using AWS Amplify Auth v6.
 * Provides forgotPassword and confirmResetPassword wrappers
 * with standardized error handling.
 */

import { resetPassword, confirmResetPassword } from '@aws-amplify/auth';

/**
 * Initiate a password reset flow by sending a verification code to the user's email.
 * Per FR-7.3, the response does not reveal whether the email exists.
 */
export async function requestPasswordReset(email: string): Promise<{ isSuccess: boolean }> {
  try {
    await resetPassword({ username: email });
    return { isSuccess: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initiate password reset';
    throw new Error(`Password reset request failed: ${message}`);
  }
}

/**
 * Confirm a password reset by submitting the verification code and new password.
 * The new password must meet the 12-character complexity policy (FR-7.4).
 */
export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string
): Promise<{ isSuccess: boolean }> {
  try {
    await confirmResetPassword({
      username: email,
      confirmationCode: code,
      newPassword,
    });
    return { isSuccess: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to confirm password reset';
    throw new Error(`Password reset confirmation failed: ${message}`);
  }
}
