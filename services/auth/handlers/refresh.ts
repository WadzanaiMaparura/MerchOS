/**
 * Refresh Token Lambda handler for POST /auth/refresh.
 *
 * Exchanges a valid refresh token for new access and ID tokens via Cognito
 * AdminInitiateAuth with REFRESH_TOKEN_AUTH flow. This is an unauthenticated
 * endpoint — the user is refreshing expired access tokens.
 *
 * Rate limited to 10 attempts per IP per minute to prevent abuse.
 *
 * Requirements: FR-11.2, FR-11.4
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminInitiateAuthCommand,
  NotAuthorizedException,
} from '@aws-sdk/client-cognito-identity-provider';

import { refreshSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RefreshEvent extends APIGatewayProxyEventV2 {
  body: {
    refreshToken: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core refresh handler logic.
 *
 * 1. Calls Cognito AdminInitiateAuth with REFRESH_TOKEN_AUTH flow
 * 2. On success: returns new access token, ID token, and expiresIn
 * 3. On NotAuthorizedException: returns 401 with REFRESH_TOKEN_EXPIRED code
 */
async function baseHandler(event: RefreshEvent): Promise<APIGatewayProxyResultV2> {
  const { refreshToken } = event.body;

  const userPoolId = process.env['COGNITO_TENANT_POOL_ID'];
  const clientId = process.env['COGNITO_SELLER_CLIENT_ID'];

  if (!userPoolId || !clientId) {
    logger.error('Missing required environment variables', {
      hasUserPoolId: !!userPoolId,
      hasClientId: !!clientId,
    });
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
    const command = new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const response = await cognitoClient.send(command);

    const authResult = response.AuthenticationResult;

    if (!authResult) {
      logger.error('Cognito returned no AuthenticationResult for refresh', {});
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Token refresh failed unexpectedly' },
        }),
      };
    }

    logger.info('Token refresh successful');

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: authResult.AccessToken,
        idToken: authResult.IdToken,
        expiresIn: authResult.ExpiresIn,
      }),
    };
  } catch (error) {
    // NotAuthorizedException — refresh token expired or revoked
    if (error instanceof NotAuthorizedException) {
      logger.warn('Token refresh failed — refresh token expired or revoked');
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            code: 'REFRESH_TOKEN_EXPIRED',
            message: 'Refresh token has expired or been revoked. Please log in again.',
          },
        }),
      };
    }

    // Unexpected errors
    logger.error('Unexpected token refresh error', {
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

/**
 * Rate limit identifier: extract source IP for pre-auth rate limiting.
 * Refresh requests are unauthenticated, so we throttle by IP address.
 */
function extractSourceIp(event: Record<string, unknown>): string {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const http = requestContext?.['http'] as Record<string, unknown> | undefined;
  const sourceIp = http?.['sourceIp'] as string | undefined;
  return sourceIp ? `IP#REFRESH#${sourceIp}` : 'IP#REFRESH#unknown';
}

export const handler = middy(baseHandler)
  .use(
    rateLimitMiddleware({
      maxRequests: 10,
      windowSeconds: 60, // 1 minute
      identifierFn: extractSourceIp,
    }),
  )
  .use(
    inputValidationMiddleware({
      schema: refreshSchema,
      source: 'body',
    }),
  );
