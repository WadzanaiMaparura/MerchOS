/**
 * Login Lambda handler for POST /auth/login.
 *
 * Authenticates a user via Cognito AdminInitiateAuth with USER_PASSWORD_AUTH flow.
 * Returns JWT tokens on success or an MFA challenge session if MFA is enabled.
 *
 * Rate limited to 5 attempts per IP per 15-minute window to mitigate brute-force attacks.
 *
 * Requirements: FR-1, FR-2
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AdminInitiateAuthCommand,
  NotAuthorizedException,
  UserNotFoundException,
  UserNotConfirmedException,
  PasswordResetRequiredException,
} from '@aws-sdk/client-cognito-identity-provider';

import { loginSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { emitAuthEvent } from '../utils/event-emitter';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoginEvent extends APIGatewayProxyEventV2 {
  body: {
    email: string;
    password: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core login handler logic.
 *
 * 1. Calls Cognito AdminInitiateAuth with USER_PASSWORD_AUTH
 * 2. On success: returns token set and emits auth.session.created event
 * 3. On MFA challenge: returns challengeName and session for the client to complete
 * 4. On auth errors: returns appropriate HTTP status with error code
 */
async function baseHandler(event: LoginEvent): Promise<APIGatewayProxyResultV2> {
  const { email, password } = event.body;

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
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);

    // Handle MFA challenge responses
    if (response.ChallengeName) {
      const challengeMap: Record<string, string> = {
        SOFTWARE_TOKEN_MFA: 'TOTP',
        SMS_MFA: 'SMS',
      };

      const challengeName = challengeMap[response.ChallengeName];

      if (challengeName) {
        logger.info('MFA challenge issued', { email, challengeName });

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeName,
            session: response.Session,
          }),
        };
      }

      // Unknown challenge type — log and return generic error
      logger.error('Unexpected Cognito challenge', {
        challengeName: response.ChallengeName,
        email,
      });

      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Unexpected authentication challenge' },
        }),
      };
    }

    // Successful authentication — return tokens
    const authResult = response.AuthenticationResult;

    if (!authResult) {
      logger.error('Cognito returned no AuthenticationResult and no challenge', { email });
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Authentication failed unexpectedly' },
        }),
      };
    }

    logger.info('Login successful', { email });

    // Emit session created event (fire-and-forget)
    const sourceIp = event.requestContext?.http?.sourceIp ?? 'unknown';
    emitAuthEvent({
      detailType: 'auth.session.created',
      detail: {
        email,
        sourceIp,
        timestamp: new Date().toISOString(),
      },
    }).catch((err) => {
      logger.error('Failed to emit auth.session.created event', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: authResult.AccessToken,
        idToken: authResult.IdToken,
        refreshToken: authResult.RefreshToken,
        expiresIn: authResult.ExpiresIn,
      }),
    };
  } catch (error) {
    // NotAuthorizedException — invalid credentials
    if (error instanceof NotAuthorizedException) {
      logger.warn('Login failed — invalid credentials', { email });
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        }),
      };
    }

    // UserNotFoundException — don't reveal user existence
    if (error instanceof UserNotFoundException) {
      logger.warn('Login failed — user not found', { email });
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
        }),
      };
    }

    // UserNotConfirmedException — email not verified
    if (error instanceof UserNotConfirmedException) {
      logger.warn('Login failed — email not verified', { email });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address before logging in' },
        }),
      };
    }

    // PasswordResetRequiredException — admin-forced password reset
    if (error instanceof PasswordResetRequiredException) {
      logger.warn('Login failed — password reset required', { email });
      return {
        statusCode: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'PASSWORD_RESET_REQUIRED', message: 'You must reset your password before logging in' },
        }),
      };
    }

    // Unexpected errors
    logger.error('Unexpected login error', {
      error: error instanceof Error ? error.message : String(error),
      email,
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
 * Login requests are unauthenticated, so we throttle by IP address.
 */
function extractSourceIp(event: Record<string, unknown>): string {
  const requestContext = event['requestContext'] as Record<string, unknown> | undefined;
  const http = requestContext?.['http'] as Record<string, unknown> | undefined;
  const sourceIp = http?.['sourceIp'] as string | undefined;
  return sourceIp ? `IP#LOGIN#${sourceIp}` : 'IP#LOGIN#unknown';
}

export const handler = middy(baseHandler)
  .use(
    rateLimitMiddleware({
      maxRequests: 5,
      windowSeconds: 900, // 15 minutes
      identifierFn: extractSourceIp,
    }),
  )
  .use(
    inputValidationMiddleware({
      schema: loginSchema,
      source: 'body',
    }),
  );
