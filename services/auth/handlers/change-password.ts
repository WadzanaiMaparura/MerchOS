/**
 * Change Password Lambda handler for POST /auth/change-password.
 *
 * Protected endpoint — the JWT authorizer validates the token before this
 * handler executes. Calls Cognito ChangePassword to update the authenticated
 * user's password.
 *
 * Requirements: FR-13.1 (change password for authenticated user)
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ChangePasswordCommand,
  NotAuthorizedException,
  InvalidPasswordException,
  LimitExceededException,
} from '@aws-sdk/client-cognito-identity-provider';

import { changePasswordSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChangePasswordEvent extends APIGatewayProxyEventV2 {
  body: {
    previousPassword: string;
    proposedPassword: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core change-password handler logic.
 *
 * 1. Extracts access token from Authorization header
 * 2. Calls Cognito ChangePasswordCommand with previous and proposed passwords
 * 3. Returns success response
 *
 * Error handling:
 * - NotAuthorizedException → 401 (current password is incorrect)
 * - InvalidPasswordException → 400 (new password doesn't meet requirements)
 * - LimitExceededException → 429 (too many attempts)
 */
async function baseHandler(event: ChangePasswordEvent): Promise<APIGatewayProxyResultV2> {
  // Extract access token from Authorization header (Bearer <token>)
  const authHeader = event.headers?.['authorization'] ?? event.headers?.['Authorization'];
  const accessToken = authHeader?.replace(/^Bearer\s+/i, '');

  if (!accessToken) {
    logger.error('No access token found in Authorization header');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Missing access token' },
      }),
    };
  }

  const { previousPassword, proposedPassword } = event.body;
  const cognitoClient = getCognitoClient();

  try {
    const command = new ChangePasswordCommand({
      PreviousPassword: previousPassword,
      ProposedPassword: proposedPassword,
      AccessToken: accessToken,
    });

    await cognitoClient.send(command);

    logger.info('Password changed successfully');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    // NotAuthorizedException — current password is incorrect
    if (error instanceof NotAuthorizedException) {
      logger.warn('Change password failed — incorrect current password');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'INCORRECT_PASSWORD',
            message: 'Current password is incorrect',
          },
        }),
      };
    }

    // InvalidPasswordException — new password doesn't meet requirements
    if (error instanceof InvalidPasswordException) {
      logger.warn('Change password failed — weak password');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'WEAK_PASSWORD',
            message: 'New password does not meet requirements',
          },
        }),
      };
    }

    // LimitExceededException — too many attempts
    if (error instanceof LimitExceededException) {
      logger.warn('Change password failed — rate limit exceeded');
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'RATE_LIMIT',
            message: 'Too many attempts',
          },
        }),
      };
    }

    // Unexpected errors
    logger.error('Unexpected change-password error', {
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
    schema: changePasswordSchema,
    source: 'body',
  }),
);
