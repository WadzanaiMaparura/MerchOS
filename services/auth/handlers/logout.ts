/**
 * Logout Lambda handler for POST /auth/logout.
 *
 * Calls Cognito GlobalSignOut to invalidate all tokens for the authenticated
 * user, then emits an auth.session.revoked event to EventBridge. This is a
 * protected endpoint — the JWT authorizer validates the token before this
 * handler executes.
 *
 * Requirements: FR-12.1, FR-12.2, FR-12.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  GlobalSignOutCommand,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';

import { logoutSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogoutEvent extends APIGatewayProxyEventV2 {
  body: {
    global?: boolean;
  };
}

interface JwtClaims {
  sub: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core logout handler logic.
 *
 * 1. Extracts access token from Authorization header
 * 2. Calls Cognito GlobalSignOut to invalidate all tokens (FR-12.1)
 * 3. Emits auth.session.revoked event (FR-12.4)
 * 4. Returns success response
 *
 * On NotAuthorizedException: returns 401 (token already invalid)
 */
async function baseHandler(event: LogoutEvent): Promise<APIGatewayProxyResultV2> {
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

  // Extract userId from JWT authorizer claims
  const requestContext = event.requestContext as Record<string, unknown>;
  const authorizer = requestContext['authorizer'] as Record<string, unknown> | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as JwtClaims | undefined;
  const userId = claims?.['sub'] as string | undefined;

  if (!userId) {
    logger.error('No userId (sub) found in JWT claims');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Invalid session' },
      }),
    };
  }

  const cognitoClient = getCognitoClient();

  try {
    // GlobalSignOut invalidates ALL refresh tokens and access tokens for the user (FR-12.1)
    const command = new GlobalSignOutCommand({
      AccessToken: accessToken,
    });

    await cognitoClient.send(command);

    logger.info('Global sign-out successful', { userId });

    // Emit auth.session.revoked event (FR-12.4)
    await emitAuthEvent({
      detailType: 'auth.session.revoked',
      detail: {
        userId,
        reason: 'user_logout',
        timestamp: new Date().toISOString(),
      },
    });

    logger.info('Session revoked event emitted', { userId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    // NotAuthorizedException — token already invalid or revoked
    if (error instanceof NotAuthorizedException) {
      logger.warn('Logout failed — token already invalid', { userId });
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'TOKEN_INVALID',
            message: 'Token has already been invalidated',
          },
        }),
      };
    }

    // Unexpected errors
    logger.error('Unexpected logout error', {
      userId,
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
    schema: logoutSchema,
    source: 'body',
  }),
);
