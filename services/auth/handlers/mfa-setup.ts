/**
 * MFA Setup Lambda handler for POST /auth/mfa/setup.
 *
 * Implements a two-step TOTP MFA setup flow:
 * 1. Associate: Empty body → returns secret code for authenticator app QR code
 * 2. Verify: { verificationCode, session } → verifies TOTP and enables MFA
 *
 * This is a protected endpoint — user must be authenticated via JWT authorizer.
 *
 * Requirements: NFR-2 (Admin pool: TOTP MFA required)
 */

import middy from '@middy/core';
import { injectLambdaContext } from '@aws-lambda-powertools/logger/middleware';
import { captureLambdaHandler } from '@aws-lambda-powertools/tracer/middleware';
import { logMetrics } from '@aws-lambda-powertools/metrics/middleware';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  AdminSetUserMFAPreferenceCommand,
  InvalidParameterException,
  NotAuthorizedException,
  EnableSoftwareTokenMFAException,
  CodeMismatchException,
} from '@aws-sdk/client-cognito-identity-provider';

import { getCognitoClient } from '../utils/cognito-client';
import { logger, tracer, metrics } from '../../shared/middleware/powertools';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MfaSetupEvent extends APIGatewayProxyEventV2 {
  body: {
    verificationCode?: string;
    session?: string;
  } | null;
}

interface JwtClaims {
  sub: string;
  email?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Core MFA setup handler logic.
 *
 * Two flows based on request body content:
 * - No body or empty body: Associate a new TOTP software token (returns secretCode)
 * - Body with verificationCode + session: Verify TOTP code and enable MFA
 */
async function baseHandler(event: MfaSetupEvent): Promise<APIGatewayProxyResultV2> {
  const userPoolId = process.env['COGNITO_TENANT_POOL_ID'];

  if (!userPoolId) {
    logger.error('Missing COGNITO_TENANT_POOL_ID environment variable');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Service misconfigured' },
      }),
    };
  }

  // Extract userId from JWT claims (API Gateway JWT authorizer)
  const requestContext = event.requestContext as Record<string, unknown>;
  const authorizer = requestContext['authorizer'] as Record<string, unknown> | undefined;
  const jwt = authorizer?.['jwt'] as Record<string, unknown> | undefined;
  const claims = jwt?.['claims'] as JwtClaims | undefined;

  if (!claims?.sub) {
    logger.error('No JWT claims found in authorizer context');
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      }),
    };
  }

  const userId = claims.sub;

  // Parse the request body — determine which step we're in
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  const verificationCode = body?.verificationCode;
  const session = body?.session;

  const cognitoClient = getCognitoClient();

  // -------------------------------------------------------------------------
  // Step 2: Verify TOTP code and enable MFA
  // -------------------------------------------------------------------------
  if (verificationCode && session) {
    return handleVerifyAndEnable(cognitoClient, {
      userPoolId,
      userId,
      verificationCode,
      session,
    });
  }

  // -------------------------------------------------------------------------
  // Step 1: Associate software token — return secret for QR code
  // -------------------------------------------------------------------------
  return handleAssociate(cognitoClient, { userId });
}

// ---------------------------------------------------------------------------
// Step 1: Associate Software Token
// ---------------------------------------------------------------------------

interface AssociateParams {
  userId: string;
}

async function handleAssociate(
  cognitoClient: ReturnType<typeof getCognitoClient>,
  params: AssociateParams
): Promise<APIGatewayProxyResultV2> {
  const { userId } = params;

  try {
    const command = new AssociateSoftwareTokenCommand({
      // When called without a session, Cognito uses the access token context.
      // We pass no AccessToken here — the user's session drives it.
      // For admin-initiated flows we don't need AccessToken if we pass Session from a challenge.
    });

    const response = await cognitoClient.send(command);

    if (!response.SecretCode) {
      logger.error('Cognito did not return a secret code', { userId });
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to generate MFA secret' },
        }),
      };
    }

    logger.info('MFA secret code generated', { userId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secretCode: response.SecretCode,
        session: response.Session,
      }),
    };
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      logger.warn('Not authorized to associate software token', { userId });
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Not authorized to set up MFA' },
        }),
      };
    }

    logger.error('Failed to associate software token', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'Failed to initiate MFA setup' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Verify Software Token and Enable MFA
// ---------------------------------------------------------------------------

interface VerifyParams {
  userPoolId: string;
  userId: string;
  verificationCode: string;
  session: string;
}

async function handleVerifyAndEnable(
  cognitoClient: ReturnType<typeof getCognitoClient>,
  params: VerifyParams
): Promise<APIGatewayProxyResultV2> {
  const { userPoolId, userId, verificationCode, session } = params;

  try {
    // Verify the TOTP code with Cognito
    const verifyCommand = new VerifySoftwareTokenCommand({
      Session: session,
      UserCode: verificationCode,
      FriendlyDeviceName: 'MerchOS Authenticator',
    });

    const verifyResponse = await cognitoClient.send(verifyCommand);

    if (verifyResponse.Status !== 'SUCCESS') {
      logger.warn('TOTP verification failed', { userId, status: verifyResponse.Status });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'VERIFICATION_FAILED', message: 'Invalid verification code' },
        }),
      };
    }

    // Enable TOTP MFA as preferred for this user
    const mfaPreferenceCommand = new AdminSetUserMFAPreferenceCommand({
      UserPoolId: userPoolId,
      Username: userId,
      SoftwareTokenMfaSettings: {
        Enabled: true,
        PreferredMfa: true,
      },
    });

    await cognitoClient.send(mfaPreferenceCommand);

    logger.info('MFA enabled successfully', { userId });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        mfaEnabled: true,
      }),
    };
  } catch (error) {
    if (error instanceof CodeMismatchException) {
      logger.warn('Invalid TOTP code provided', { userId });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_CODE', message: 'Invalid verification code' },
        }),
      };
    }

    if (error instanceof EnableSoftwareTokenMFAException) {
      logger.warn('Failed to enable software token MFA', { userId });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'MFA_ENABLE_FAILED', message: 'Failed to enable MFA' },
        }),
      };
    }

    if (error instanceof NotAuthorizedException) {
      logger.warn('Not authorized to verify software token', { userId });
      return {
        statusCode: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'UNAUTHORIZED', message: 'Session expired, please restart MFA setup' },
        }),
      };
    }

    if (error instanceof InvalidParameterException) {
      logger.warn('Invalid parameter for MFA verification', { userId });
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: { code: 'INVALID_PARAMETER', message: 'Invalid session or verification code' },
        }),
      };
    }

    logger.error('Unexpected error during MFA verification', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred during MFA setup' },
      }),
    };
  }
}

// ---------------------------------------------------------------------------
// Middleware Stack
// ---------------------------------------------------------------------------

export const handler = middy(baseHandler)
  .use(injectLambdaContext(logger, { clearState: true }))
  .use(captureLambdaHandler(tracer))
  .use(logMetrics(metrics, { captureColdStartMetric: true }));
