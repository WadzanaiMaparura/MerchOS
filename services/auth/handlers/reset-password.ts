/**
 * Reset Password Lambda handler for POST /auth/reset-password.
 *
 * Completes the password reset flow by calling Cognito ConfirmForgotPassword.
 * Validates the reset code and sets the new password. Emits an
 * auth.password.reset event on success.
 *
 * UNAUTHENTICATED endpoint — no JWT authorizer.
 *
 * Requirements: FR-7.1, FR-7.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ConfirmForgotPasswordCommand,
  CodeMismatchException,
  ExpiredCodeException,
  InvalidPasswordException,
  UserNotFoundException,
  LimitExceededException,
} from '@aws-sdk/client-cognito-identity-provider';

import { resetPasswordSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResetPasswordEvent extends APIGatewayProxyEventV2 {
  body: {
    email: string;
    code: string;
    newPassword: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core reset-password handler logic.
 *
 * 1. Calls Cognito ConfirmForgotPassword with email, code, and new password
 * 2. On success: returns { success: true } and emits auth.password.reset event
 * 3. On known errors: returns appropriate HTTP status with error code
 * 4. UserNotFoundException returns INVALID_CODE (don't reveal user existence)
 */
async function baseHandler(event: ResetPasswordEvent): Promise<APIGatewayProxyResultV2> {
  const { email, code, newPassword } = event.body;

  const clientId = process.env['COGNITO_SELLER_CLIENT_ID'];

  if (!clientId) {
    logger.error('Missing required environment variable COGNITO_SELLER_CLIENT_ID');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  const cognitoClient = getCognitoClient();

  try {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });

    await cognitoClient.send(command);

    logger.info('Password reset successful', { email });

    // Emit auth.password.reset event (fire-and-forget)
    emitAuthEvent({
      detailType: 'auth.password.reset',
      detail: {
        email,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.password.reset event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    // CodeMismatchException — invalid verification code
    if (error instanceof CodeMismatchException) {
      logger.warn('Password reset failed — invalid code', { email });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_CODE', message: 'The verification code is invalid' },
        }),
      };
    }

    // ExpiredCodeException — code has expired
    if (error instanceof ExpiredCodeException) {
      logger.warn('Password reset failed — code expired', { email });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'CODE_EXPIRED', message: 'The verification code has expired' },
        }),
      };
    }

    // InvalidPasswordException — password doesn't meet policy
    if (error instanceof InvalidPasswordException) {
      logger.warn('Password reset failed — weak password', { email });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'WEAK_PASSWORD', message: 'Password does not meet the required complexity' },
        }),
      };
    }

    // UserNotFoundException — don't reveal user existence, return same as invalid code
    if (error instanceof UserNotFoundException) {
      logger.warn('Password reset failed — user not found (masked)', { email });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_CODE', message: 'The verification code is invalid' },
        }),
      };
    }

    // LimitExceededException — too many attempts
    if (error instanceof LimitExceededException) {
      logger.warn('Password reset failed — rate limit exceeded', { email });
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please try again later.' },
        }),
      };
    }

    // Unexpected errors
    logger.error('Unexpected password reset error', {
      email,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler).use(
  inputValidationMiddleware({
    schema: resetPasswordSchema,
    source: 'body',
  }),
);
