/**
 * Forgot Password Lambda handler for POST /auth/forgot-password.
 *
 * Initiates the password reset flow by calling Cognito ForgotPassword.
 * ALWAYS returns 200 with a generic message regardless of whether the
 * email exists — this prevents user enumeration attacks.
 *
 * Rate limited to 3 requests per email per hour to prevent abuse.
 *
 * UNAUTHENTICATED endpoint — no JWT authorizer.
 *
 * Requirements: FR-7.1, FR-7.3
 */

import middy from '@middy/core';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';

import { forgotPasswordSchema } from '../schemas';
import { getCognitoClient } from '../utils/cognito-client';
import { inputValidationMiddleware } from '../../shared/middleware/input-validation';
import { rateLimitMiddleware } from '../../shared/middleware/rate-limit';
import { logger } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ForgotPasswordEvent extends APIGatewayProxyEventV2 {
  body: {
    email: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUCCESS_MESSAGE = 'If an account exists, a reset code has been sent.';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core forgot-password handler logic.
 *
 * 1. Calls Cognito ForgotPassword with the provided email
 * 2. ALWAYS returns 200 with generic message (prevents user enumeration)
 * 3. Catches ALL Cognito errors and still returns 200
 */
async function baseHandler(event: ForgotPasswordEvent): Promise<APIGatewayProxyResultV2> {
  const { email } = event.body;

  const clientId = process.env['COGNITO_SELLER_CLIENT_ID'];

  if (!clientId) {
    logger.error('Missing required environment variable COGNITO_SELLER_CLIENT_ID');
    // Still return 200 to avoid leaking configuration state
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: SUCCESS_MESSAGE }),
    };
  }

  const cognitoClient = getCognitoClient();

  try {
    const command = new ForgotPasswordCommand({
      ClientId: clientId,
      Username: email,
    });

    await cognitoClient.send(command);

    logger.info('Forgot password code sent', { email });
  } catch (error) {
    // Catch ALL errors — never reveal whether the email exists (FR-7.3)
    logger.warn('Forgot password request failed (suppressed)', {
      email,
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  // ALWAYS return 200 with the same message regardless of outcome
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: SUCCESS_MESSAGE }),
  };
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

/**
 * Rate limit identifier: extract email from parsed body for per-email throttling.
 * Forgot password is rate limited to 3 requests per email per hour.
 */
function extractEmailIdentifier(event: Record<string, unknown>): string {
  const body = event['body'] as Record<string, unknown> | undefined;
  const email = body?.['email'] as string | undefined;
  return email ? `EMAIL#FORGOT#${email}` : 'EMAIL#FORGOT#unknown';
}

export const handler = middy(baseHandler)
  .use(
    rateLimitMiddleware({
      maxRequests: 3,
      windowSeconds: 3600, // 1 hour
      identifierFn: extractEmailIdentifier,
    }),
  )
  .use(
    inputValidationMiddleware({
      schema: forgotPasswordSchema,
      source: 'body',
    }),
  );
