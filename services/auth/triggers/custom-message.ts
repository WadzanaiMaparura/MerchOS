/**
 * Cognito CustomMessage Lambda trigger for MerchOS.
 *
 * Every message Cognito sends, in the plain MerchOS email layout (white page,
 * M logo, black text; see services/shared/email/plain-email.ts). Sent from
 * noreply@merchos.co.za (Auth stack), because these carry security codes.
 *
 * - CustomMessage_Authentication: sign-in code (email MFA / OTP)
 * - CustomMessage_SignUp / CustomMessage_ResendCode: email verification code
 * - CustomMessage_ForgotPassword: password reset code
 * - CustomMessage_UpdateUserAttribute / CustomMessage_VerifyUserAttribute:
 *   confirm a changed email address
 * - CustomMessage_AdminCreateUser: invitation with temporary password
 *
 * Cognito replaces {####} with the code (and {username} for invitations), so
 * both placeholders must appear in the message exactly once where needed.
 *
 * Requirements: FR-7.2, FR-8.2
 */

import type { CustomMessageTriggerEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SITE_URL, code, link, para, plainEmail, small } from '../../shared/email/plain-email';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = new Logger({ serviceName: 'merch-os-custom-message' });

/** Request time in South African time, shown so the reader can spot a request that wasn't theirs. */
function requestTimeSast(now: Date = new Date()): string {
  return now.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

/** Request time + what to do if it wasn't them. */
function securityNote(action: string): string {
  return (
    para(
      `If this was not you, you can ignore this email; nobody can ${action} without this code. Never share it with anyone, including MerchOS staff.`,
    ) + small(`Requested ${requestTimeSast()} (SAST).`)
  );
}

/** Sign-in code (email MFA). */
export function signInCodeEmailTemplate(): string {
  return plainEmail({
    preheader: 'Your MerchOS sign-in code is inside.',
    body:
      para('Hello') +
      para('Use this code to finish signing in to MerchOS:') +
      code('{####}') +
      para('It expires in 3 minutes.') +
      securityNote('sign in to your account'),
  });
}

/** Verification email for new sign-ups (and re-sent codes). */
export function verificationEmailTemplate(): string {
  return plainEmail({
    preheader: 'Confirm your email to start using MerchOS.',
    body:
      para('Hello') +
      para('Enter this code to confirm your email address and finish creating your MerchOS account:') +
      code('{####}') +
      para('It expires in 24 hours.') +
      securityNote('use this email address'),
  });
}

/** Confirm a changed email address. */
export function attributeVerificationEmailTemplate(): string {
  return plainEmail({
    preheader: 'Confirm your new MerchOS email address.',
    body:
      para('Hello') +
      para('Enter this code in MerchOS to confirm this is your new email address:') +
      code('{####}') +
      para('It expires in 24 hours.') +
      securityNote('change your email address'),
  });
}

/** Password reset email. */
export function forgotPasswordEmailTemplate(): string {
  return plainEmail({
    preheader: 'Your MerchOS password reset code.',
    body:
      para('Hello') +
      para('We received a request to reset your MerchOS password. Enter this code to choose a new one:') +
      code('{####}') +
      para('It expires in 1 hour.') +
      securityNote('reset your password'),
  });
}

/** Invitation email for admin-created users (temporary password). */
export function invitationEmailTemplate(): string {
  return plainEmail({
    preheader: 'Your MerchOS account is ready.',
    body:
      para('Hello') +
      para(
        `You have been given a MerchOS account. Sign in at ${link(SITE_URL, 'merchos.co.za')} with the details below; you will choose your own password straight away.`,
      ) +
      para('Username: <b>{username}</b>') +
      para('Temporary password:') +
      code('{####}') +
      para('This invitation expires in 7 days. If you were not expecting it, you can ignore this email.'),
  });
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Cognito CustomMessage trigger handler.
 *
 * Intercepts email messages sent by Cognito and replaces them with the MerchOS
 * templates. SMS messages are left untouched (the pool sends no SMS).
 */
export async function handler(
  event: CustomMessageTriggerEvent,
): Promise<CustomMessageTriggerEvent> {
  const triggerSource = event.triggerSource;

  logger.info('CustomMessage trigger invoked', { triggerSource });

  try {
    switch (triggerSource) {
      case 'CustomMessage_Authentication':
        event.response.emailSubject = 'Your MerchOS sign-in code';
        event.response.emailMessage = signInCodeEmailTemplate();
        break;

      case 'CustomMessage_SignUp':
      case 'CustomMessage_ResendCode':
        event.response.emailSubject = 'Verify your email for MerchOS';
        event.response.emailMessage = verificationEmailTemplate();
        break;

      case 'CustomMessage_ForgotPassword':
        event.response.emailSubject = 'Reset your MerchOS password';
        event.response.emailMessage = forgotPasswordEmailTemplate();
        break;

      case 'CustomMessage_UpdateUserAttribute':
      case 'CustomMessage_VerifyUserAttribute':
        event.response.emailSubject = 'Confirm your email for MerchOS';
        event.response.emailMessage = attributeVerificationEmailTemplate();
        break;

      case 'CustomMessage_AdminCreateUser':
        event.response.emailSubject = 'You have been invited to MerchOS';
        event.response.emailMessage = invitationEmailTemplate();
        break;

      default:
        logger.info('Unhandled trigger source, using default message', { triggerSource });
        break;
    }
  } catch (error) {
    // Log error but don't block message sending — return event as-is
    logger.error('Error in CustomMessage trigger', {
      error: error instanceof Error ? error.message : String(error),
      triggerSource,
    });
  }

  return event;
}
