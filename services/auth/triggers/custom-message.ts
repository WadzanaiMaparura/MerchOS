/**
 * Cognito CustomMessage Lambda trigger for MerchOS.
 *
 * Branded HTML emails for every message Cognito sends:
 * - CustomMessage_Authentication: sign-in code (email MFA / OTP)
 * - CustomMessage_SignUp / CustomMessage_ResendCode: email verification code
 * - CustomMessage_ForgotPassword: password reset code
 * - CustomMessage_UpdateUserAttribute / CustomMessage_VerifyUserAttribute:
 *   confirm a changed email address
 * - CustomMessage_AdminCreateUser: invitation with temporary password
 *
 * Cognito replaces {####} with the code (and {username} for invitations), so
 * both placeholders must appear in the message exactly once where needed.
 * Layout uses tables + inline styles only, which is what email clients render
 * reliably (Gmail, Outlook, Apple Mail).
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
// Brand
// ---------------------------------------------------------------------------

const SITE = 'https://merchos.co.za';
const SUPPORT_EMAIL = 'info@merchos.co.za';
const BLUE = '#2563eb';
const BLUE_DARK = '#1e3a8a';
const INK = '#1e293b';
const MUTED = '#475569';
const FAINT = '#94a3b8';

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

/**
 * Base HTML email wrapper with MerchOS branding: blue header band with a dark
 * contact strip, white body, blue footer with links.
 */
export function brandedEmailTemplate(title: string, bodyContent: string, preheader = ''): string {
  const link = (href: string, label: string) =>
    `<a href="${href}" style="color: #ffffff; text-decoration: none; font-weight: 600;">${label}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${title}</title>
  <!-- Brand font. Apple Mail / iOS load it; Gmail and Outlook use the fallbacks. -->
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin: 0; padding: 0; background-color: #eef2f7; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #eef2f7;">
    <tr>
      <td align="center" style="padding: 24px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
          <tr>
            <td style="background-color: ${BLUE}; padding: 24px 32px;">
              <p style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">MerchOS</p>
              <p style="margin: 4px 0 0; color: #dbeafe; font-size: 13px;">Marketplace ready listings for Takealot &amp; more</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${BLUE_DARK}; padding: 10px 32px; color: #dbeafe; font-size: 12px;">
              <span style="color: #fbbf24;">&#9679;</span>&nbsp; ${link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL)}
              &nbsp;&nbsp;&nbsp;<span style="color: #fbbf24;">&#9679;</span>&nbsp; ${link(SITE, 'merchos.co.za')}
            </td>
          </tr>
          <tr>
            <td style="padding: 32px; color: ${MUTED}; font-size: 14px; line-height: 1.6;">
              ${bodyContent}
              <p style="margin: 28px 0 0; color: ${MUTED}; font-size: 14px;">
                Questions? Contact us at
                <a href="mailto:${SUPPORT_EMAIL}" style="color: ${BLUE};">${SUPPORT_EMAIL}</a>.
              </p>
              <p style="margin: 16px 0 0; color: ${MUTED}; font-size: 14px;">Kind regards,<br>The MerchOS Team</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${BLUE_DARK}; padding: 18px 32px; text-align: center; font-size: 12px; line-height: 1.8;">
              ${link(`${SITE}/pricing`, 'PRICING')} &nbsp;|&nbsp;
              ${link(`${SITE}/contact?reason=training#training`, 'FREE TRAINING')} &nbsp;|&nbsp;
              ${link(`${SITE}/contact`, 'CONTACT')} &nbsp;|&nbsp;
              ${link(`${SITE}/privacy`, 'PRIVACY')}
            </td>
          </tr>
          <tr>
            <td style="background-color: ${BLUE}; padding: 12px 32px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #dbeafe;">&copy; ${new Date().getFullYear()} MerchOS. All rights reserved.</p>
            </td>
          </tr>
        </table>
        <p style="margin: 16px 0 0; font-size: 11px; color: ${FAINT};">You received this email because of activity on your MerchOS account.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Large, spaced code box (Cognito substitutes {####}). */
function codeBox(label: string, expiry: string): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; text-align: center;">
          <p style="margin: 0 0 8px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">${label}</p>
          <p style="margin: 0; color: ${INK}; font-size: 34px; font-weight: 700; letter-spacing: 8px; font-family: 'DM Sans', -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;">{####}</p>
          <p style="margin: 8px 0 0; color: #64748b; font-size: 12px;">${expiry}</p>
        </td>
      </tr>
    </table>`;
}

/** Request details + what to do if it wasn't them. */
function securityNote(action: string): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 8px 0 0; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;">
      <tr>
        <td style="padding: 12px 0; font-size: 13px; color: ${MUTED};">
          <strong style="color: ${INK};">Requested:</strong> ${requestTimeSast()} (SAST)
        </td>
      </tr>
    </table>
    <p style="margin: 16px 0 0; font-size: 13px; color: ${MUTED};">
      If this wasn't you, you can ignore this email; nobody can ${action} without this code.
      If you keep getting emails you didn't ask for, change your password and let us know.
    </p>
    <p style="margin: 8px 0 0; font-size: 13px; color: ${MUTED};">For your security, never share this code with anyone, including MerchOS staff.</p>`;
}

const heading = (text: string) =>
  `<h2 style="margin: 0 0 16px; color: ${INK}; font-size: 20px;">${text}</h2>`;
const para = (text: string) => `<p style="margin: 0 0 12px; color: ${MUTED}; font-size: 14px; line-height: 1.6;">${text}</p>`;

/** Sign-in code (email MFA). */
export function signInCodeEmailTemplate(): string {
  const body = `
    ${heading('Your sign-in code')}
    ${para('Hello,')}
    ${para('Use the code below to finish signing in to MerchOS.')}
    ${codeBox('Sign-in code', 'This code expires in 3 minutes.')}
    ${securityNote('sign in to your account')}`;
  return brandedEmailTemplate('Your MerchOS sign-in code', body, 'Your MerchOS sign-in code is inside.');
}

/** Verification email for new sign-ups (and re-sent codes). */
export function verificationEmailTemplate(): string {
  const body = `
    ${heading('Verify your email')}
    ${para('Welcome to MerchOS!')}
    ${para('Enter the code below to confirm your email address and finish creating your account.')}
    ${codeBox('Verification code', 'This code expires in 24 hours.')}
    ${securityNote('use this email address')}`;
  return brandedEmailTemplate('Verify your email - MerchOS', body, 'Confirm your email to start using MerchOS.');
}

/** Confirm a changed email address. */
export function attributeVerificationEmailTemplate(): string {
  const body = `
    ${heading('Confirm your new email address')}
    ${para('Hello,')}
    ${para('Enter the code below in MerchOS to confirm this is your new email address.')}
    ${codeBox('Verification code', 'This code expires in 24 hours.')}
    ${securityNote('change your email address')}`;
  return brandedEmailTemplate('Confirm your email - MerchOS', body, 'Confirm your new MerchOS email address.');
}

/** Password reset email. */
export function forgotPasswordEmailTemplate(): string {
  const body = `
    ${heading('Reset your password')}
    ${para('Hello,')}
    ${para('We received a request to reset your MerchOS password. Enter the code below to choose a new one.')}
    ${codeBox('Reset code', 'This code expires in 1 hour.')}
    ${securityNote('reset your password')}`;
  return brandedEmailTemplate('Reset your password - MerchOS', body, 'Your MerchOS password reset code.');
}

/** Invitation email for admin-created users (temporary password). */
export function invitationEmailTemplate(): string {
  const body = `
    ${heading("You've been invited to MerchOS")}
    ${para('Hello,')}
    ${para("You've been given a MerchOS account. Sign in with the details below; you'll choose your own password straight away.")}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; text-align: center;">
          <p style="margin: 0 0 6px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Username</p>
          <p style="margin: 0 0 16px; color: ${INK}; font-size: 16px; font-weight: 600;">{username}</p>
          <p style="margin: 0 0 6px; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Temporary password</p>
          <p style="margin: 0; color: ${INK}; font-size: 20px; font-weight: 700; font-family: 'SFMono-Regular', Consolas, 'Courier New', monospace;">{####}</p>
        </td>
      </tr>
    </table>
    ${para('This invitation expires in 7 days.')}
    <p style="margin: 8px 0 0; font-size: 13px; color: ${MUTED};">If you weren't expecting this, you can ignore this email.</p>`;
  return brandedEmailTemplate("You're invited to MerchOS", body, 'Your MerchOS account is ready.');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Cognito CustomMessage trigger handler.
 *
 * Intercepts email messages sent by Cognito and replaces them with branded
 * HTML templates. SMS messages are left untouched (the pool sends no SMS).
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
        event.response.emailSubject = 'Verify your email - MerchOS';
        event.response.emailMessage = verificationEmailTemplate();
        break;

      case 'CustomMessage_ForgotPassword':
        event.response.emailSubject = 'Reset your password - MerchOS';
        event.response.emailMessage = forgotPasswordEmailTemplate();
        break;

      case 'CustomMessage_UpdateUserAttribute':
      case 'CustomMessage_VerifyUserAttribute':
        event.response.emailSubject = 'Confirm your email - MerchOS';
        event.response.emailMessage = attributeVerificationEmailTemplate();
        break;

      case 'CustomMessage_AdminCreateUser':
        event.response.emailSubject = "You've been invited to MerchOS";
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
