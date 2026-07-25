/**
 * Verify Email Lambda handler for POST /auth/verify-email.
 *
 * Confirms a user's email address by calling Cognito ConfirmSignUp with the
 * verification code sent during registration. Emits an auth.user.verified
 * event on success.
 *
 * UNAUTHENTICATED endpoint — no JWT authorizer.
 *
 * Requirements: FR-8.1
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ConfirmSignUpCommand,
  CodeMismatchException,
  ExpiredCodeException,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';

import { verifyEmailSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerifyEmailEvent extends APIGatewayProxyEventV2 {
  body: {
    email: string;
    code: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core verify-email handler logic.
 *
 * 1. Calls Cognito ConfirmSignUp with email and verification code
 * 2. On success: returns { success: true, verified: true } and emits auth.user.verified event
 * 3. On known errors: returns appropriate HTTP status with error code
 */
async function baseHandler(event: VerifyEmailEvent): Promise<APIGatewayProxyResultV2> {
  const { email, code } = event.body;

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
    const command = new ConfirmSignUpCommand({
      ClientId: clientId,
      Username: email,
      ConfirmationCode: code,
    });

    await cognitoClient.send(command);

    logger.info('Email verification successful', { email });

    // Emit auth.user.verified event (fire-and-forget)
    emitAuthEvent({
      detailType: 'auth.user.verified',
      detail: {
        email,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.user.verified event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, verified: true }),
    };
  } catch (error) {
    // CodeMismatchException — invalid verification code
    if (error instanceof CodeMismatchException) {
      logger.warn('Email verification failed — invalid code', { email });
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
      logger.warn('Email verification failed — code expired', { email });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'CODE_EXPIRED', message: 'The verification code has expired' },
        }),
      };
    }

    // NotAuthorizedException — user already confirmed
    if (error instanceof NotAuthorizedException) {
      logger.warn('Email verification failed — already verified', { email });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'ALREADY_VERIFIED', message: 'This email has already been verified' },
        }),
      };
    }

    // Unexpected errors
    logger.error('Unexpected email verification error', {
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
    schema: verifyEmailSchema,
    source: 'body',
  }),
);
