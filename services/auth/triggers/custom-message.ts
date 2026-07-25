/**
 * Cognito CustomMessage Lambda trigger for MerchOS.
 *
 * Provides branded HTML email templates for:
 * - CustomMessage_SignUp: Email verification with 6-digit code
 * - CustomMessage_ForgotPassword: Password reset email
 * - CustomMessage_AdminCreateUser: Invitation welcome email
 *
 * Requirements: FR-7.2, FR-8.2
 */

import type { CustomMessageTriggerEvent } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = new Logger({ serviceName: 'merch-os-custom-message' });

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------

/**
 * Base HTML email wrapper with MerchOS branding.
 */
function brandedEmailTemplate(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif; background-color: #f4f7fa;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
    <tr>
      <td style="background-color: #2563eb; padding: 24px 32px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">MerchOS</h1>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        ${bodyContent}
      </td>
    </tr>
    <tr>
      <td style="padding: 16px 32px; background-color: #f8fafc; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8;">
          &copy; ${new Date().getFullYear()} MerchOS. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Verification email template for new sign-ups.
 */
function verificationEmailTemplate(): string {
  const body = `
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px;">Verify your email</h2>
    <p style="margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.6;">
      Welcome to MerchOS! Please use the verification code below to confirm your email address.
    </p>
    <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: 4px; color: #1e293b;">{####}</span>
    </div>
    <p style="margin: 0 0 8px; color: #475569; font-size: 14px; line-height: 1.6;">
      This code will expire in 24 hours.
    </p>
    <p style="margin: 0; color: #94a3b8; font-size: 12px;">
      If you didn't create a MerchOS account, you can safely ignore this email.
    </p>`;

  return brandedEmailTemplate('Verify your email - MerchOS', body);
}

/**
 * Password reset email template.
 */
function forgotPasswordEmailTemplate(): string {
  const body = `
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px;">Reset your password</h2>
    <p style="margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.6;">
      We received a request to reset your MerchOS password. Use the code below to set a new password.
    </p>
    <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-size: 32px; font-weight: 700; letter-spacing: 4px; color: #1e293b;">{####}</span>
    </div>
    <p style="margin: 0 0 8px; color: #475569; font-size: 14px; line-height: 1.6;">
      This code will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
    </p>
    <p style="margin: 0; color: #94a3b8; font-size: 12px;">
      For security, never share this code with anyone.
    </p>`;

  return brandedEmailTemplate('Reset your password - MerchOS', body);
}

/**
 * Invitation email template for admin-created users.
 */
function invitationEmailTemplate(): string {
  const body = `
    <h2 style="margin: 0 0 16px; color: #1e293b; font-size: 20px;">You've been invited to MerchOS</h2>
    <p style="margin: 0 0 16px; color: #475569; font-size: 14px; line-height: 1.6;">
      You've been invited to join a team on MerchOS. Use the temporary password below to sign in and set up your account.
    </p>
    <div style="background-color: #f1f5f9; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <p style="margin: 0 0 8px; color: #64748b; font-size: 12px;">Your username</p>
      <p style="margin: 0 0 16px; color: #1e293b; font-size: 16px; font-weight: 600;">{username}</p>
      <p style="margin: 0 0 8px; color: #64748b; font-size: 12px;">Temporary password</p>
      <span style="font-size: 18px; font-weight: 700; color: #1e293b;">{####}</span>
    </div>
    <p style="margin: 0 0 8px; color: #475569; font-size: 14px; line-height: 1.6;">
      You'll be asked to set a new password when you first sign in.
    </p>
    <p style="margin: 0; color: #94a3b8; font-size: 12px;">
      This invitation expires in 7 days.
    </p>`;

  return brandedEmailTemplate("You're invited to MerchOS", body);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Cognito CustomMessage trigger handler.
 *
 * Intercepts email messages sent by Cognito and replaces them with
 * branded HTML templates. Handles sign-up verification, password reset,
 * and admin-created user (invitation) messages.
 */
export async function handler(
  event: CustomMessageTriggerEvent,
): Promise<CustomMessageTriggerEvent> {
  const triggerSource = event.triggerSource;
  const email = event.request.userAttributes['email'] ?? event.userName;

  logger.info('CustomMessage trigger invoked', {
    triggerSource,
    email,
  });

  try {
    switch (triggerSource) {
      case 'CustomMessage_SignUp':
        event.response.emailSubject = 'Verify your email - MerchOS';
        event.response.emailMessage = verificationEmailTemplate();
        break;

      case 'CustomMessage_ForgotPassword':
        event.response.emailSubject = 'Reset your password - MerchOS';
        event.response.emailMessage = forgotPasswordEmailTemplate();
        break;

      case 'CustomMessage_AdminCreateUser':
        event.response.emailSubject = "You've been invited to MerchOS";
        event.response.emailMessage = invitationEmailTemplate();
        break;

      default:
        logger.info('Unhandled trigger source, using default message', {
          triggerSource,
        });
        break;
    }
  } catch (error) {
    // Log error but don't block message sending — return event as-is
    logger.error('Error in CustomMessage trigger', {
      error: error instanceof Error ? error.message : String(error),
      triggerSource,
      email,
    });
  }

  return event;
}
